import type { DraftPoolEntry, DraftStatus } from "@/domain/draft";
import type { DraftFormat } from "@/domain/league";
import type { RosterSlot, RosterSlotConfig } from "@/domain/roster";
import { auctionOf, rosterFor, totalPickCount, totalRosterSlots, type AuctionState, type CompletedPick, type DraftState } from "./state";
import { snakeTeamForPick } from "./order";
import { assignSlot } from "./slotting";
import { AUCTION_CONFIG, DRAFT_VIEW_CONFIG, type ClockTier, type PauseWindow } from "./config";
import { MS_PER_SECOND, clockTierFor, nextTighteningAfter, type Tightening } from "./clock-schedule";
import { deadlineAfter, pausedUntil as pauseWindowEndAt } from "./pause";
import { queuedEntriesFor } from "./queue";

export function draftedPlayerIds(state: DraftState): ReadonlySet<string> {
  return new Set(state.picks.map((p) => p.playerId));
}

/** The undrafted pool, still in ranking order. */
export function availablePool(state: DraftState): readonly DraftPoolEntry[] {
  const drafted = draftedPlayerIds(state);
  return state.pool.filter((p) => !drafted.has(p.playerId));
}

export function openSlotCount(state: DraftState, teamId: string): number {
  return totalRosterSlots(state.config.slotConfig) - rosterFor(state, teamId).length;
}

export function isComplete(state: DraftState): boolean {
  return state.phase === "complete";
}

export function remainingBudget(state: DraftState, teamId: string): number {
  return state.budgets[teamId] ?? 0;
}

export function minBidFor(state: DraftState): number {
  const auction = auctionOf(state);
  if (auction === null || auction.lot === null) return AUCTION_CONFIG.minBid;
  return auction.lot.highBid + AUCTION_CONFIG.bidIncrement;
}

/**
 * The most this team may commit right now: their budget less $1 held back for every other
 * roster spot they still have to fill. Guarantees a team with an open slot can always afford
 * the minimum bid, which is what stops auto-nomination from deadlocking.
 */
export function maxBidFor(state: DraftState, teamId: string): number {
  const open = openSlotCount(state, teamId);
  if (open <= 0) return 0;
  // Clamped at zero: a team the draft has never seen has an `openSlotCount` (every roster
  // slot, since it has no filled ones) but no budget entry, so the unclamped formula would
  // go negative. Real participants never hit the clamp — the START-time budget-per-slot
  // check keeps their true max bid at or above zero.
  return Math.max(0, remainingBudget(state, teamId) - (open - 1) * AUCTION_CONFIG.reservePerOpenSlot);
}

/**
 * Whose turn it is. Snake: the team on the clock. Auction: the team due to nominate —
 * null while a lot is live, because during bidding the clock belongs to everyone.
 */
export function teamOnClock(state: DraftState): string | null {
  if (state.phase !== "in_progress") return null;
  const auction = auctionOf(state);
  if (auction === null) return snakeTeamForPick(state.draftOrder, state.pickNumber);
  return auction.lot === null ? auction.nominatingTeamId : null;
}

/** Next team in nomination order after `afterTeamId`, skipping full rosters. Null when nobody can nominate. */
export function nextNominator(state: DraftState, afterTeamId: string): string | null {
  const order = state.draftOrder;
  const start = order.indexOf(afterTeamId);
  const rotated = [...order.slice(start + 1), ...order.slice(0, start + 1)];
  return rotated.find((teamId) => openSlotCount(state, teamId) > 0) ?? null;
}

/**
 * The next `count` teams due to act, current turn first — the answer to "when am I up?",
 * computed once here rather than restated as serpentine arithmetic in a browser.
 *
 * Neither format grows a second walk. Snake replays the engine's own `snakeTeamForPick`
 * forward, stopping at `totalPickCount` (the same ceiling `advanceSnake` completes the draft
 * at); a snake draft never skips a team, because every team owns exactly the same number of
 * roster spots and therefore fills its last one on the last round. Auction chains
 * `nextNominator`, which already skips full rosters, and cycles once the rotation comes back
 * around — an auction's order repeats, so a 12-deep lookahead in an 8-team league legitimately
 * names some teams twice.
 *
 * While a lot is open there is no team "on the clock" (`teamOnClock` is null by design: the
 * clock belongs to every bidder), so the walk starts with the team due to nominate AFTER the
 * one whose lot is live. It is computed against the rosters as they stand, so if the lot's
 * winner fills their last spot the list shifts by one — the next event's clock carries the
 * corrected list, which is why `upcoming` rides every payload rather than being fetched.
 */
export function upcomingOnClock(state: DraftState, count: number): readonly string[] {
  if (state.phase !== "in_progress") return [];
  const auction = auctionOf(state);
  return auction === null ? upcomingSnake(state, count) : upcomingNominators(state, auction, count);
}

function upcomingSnake(state: DraftState, count: number): readonly string[] {
  const lastPick = totalPickCount(state);
  const upcoming: string[] = [];
  for (let pickNumber = state.pickNumber; pickNumber <= lastPick && upcoming.length < count; pickNumber++) {
    upcoming.push(snakeTeamForPick(state.draftOrder, pickNumber));
  }
  return upcoming;
}

function upcomingNominators(state: DraftState, auction: AuctionState, count: number): readonly string[] {
  const upcoming: string[] = [];
  let team = auction.lot === null ? auction.nominatingTeamId : nextNominator(state, auction.lot.nominatedByTeamId);
  while (team !== null && upcoming.length < count) {
    upcoming.push(team);
    team = nextNominator(state, team);
  }
  return upcoming;
}

/** The ranked autopick queue this team stored, or an empty list. */
export function queueFor(state: DraftState, teamId: string): readonly string[] {
  return state.queues[teamId] ?? [];
}

/**
 * The autopick policy, stated once, for BOTH formats — `reduceSnakeExpiry` and
 * `reduceAuctionExpiry` each call exactly this, so the moderator's queue plugs into the one
 * existing path rather than adding a second.
 *
 * Order of preference: the team's own ranked queue (first entry it can still legally roster
 * and nobody has taken), then `state.pool`'s ranking. Both are explicit inputs carried in
 * the action log, never an ambient lookup, so the same log always autopicks the same player.
 */
export function bestAvailableFor(state: DraftState, teamId: string): DraftPoolEntry | null {
  const roster = rosterFor(state, teamId);
  // Computed once: `availablePool` already derives the drafted set internally, so a queued
  // entry's availability is checked against the pool it produces rather than a second,
  // separately-computed drafted-ids set.
  const available = availablePool(state);
  const availableIds = new Set(available.map((entry) => entry.playerId));
  const canRoster = (entry: DraftPoolEntry): boolean =>
    availableIds.has(entry.playerId) &&
    assignSlot({ position: entry.position, roster, slotConfig: state.config.slotConfig }).ok;

  for (const entry of queuedEntriesFor(state, teamId)) {
    if (canRoster(entry)) return entry;
  }
  for (const entry of available) {
    if (canRoster(entry)) return entry;
  }
  return null;
}

/** The tier in force for the turn that's currently running, or null when no turn is running. */
export function currentTier(state: DraftState): ClockTier | null {
  if (state.phase !== "in_progress" || state.turnStartedAt === null) return null;
  return clockTierFor(state.turnStartedAt, state.config.kickoffAt, state.config.clockSchedule);
}

/** Seconds allowed for the current turn: the tier's pick clock, or the shorter live bid window. */
export function currentClockSeconds(state: DraftState): number | null {
  const tier = currentTier(state);
  if (tier === null) return null;
  const auction = auctionOf(state);
  if (auction !== null && auction.lot !== null) return Math.min(tier.pickSeconds, AUCTION_CONFIG.bidWindowSeconds);
  return tier.pickSeconds;
}

/**
 * Bundles the two values `currentDeadline` needs from one combined check, so it narrows
 * `turnStartedAt` exactly once instead of re-checking it after `currentClockSeconds` has
 * already implied it's non-null.
 */
function currentTurnClock(state: DraftState): { readonly seconds: number; readonly startedAt: string } | null {
  const startedAt = state.turnStartedAt;
  const seconds = currentClockSeconds(state);
  if (startedAt === null || seconds === null) return null;
  return { seconds, startedAt };
}

/**
 * `config.pauseWindow`, but only when the CURRENT tier is slow enough for it to apply — the
 * 90-second (and 10-minute) floor a draft runs at near kickoff never freezes, so a deploy's
 * freeze window is simply not consulted for those turns at all. Null (no config'd window, or a
 * tier too fast for it) means every caller below skips the pause arithmetic entirely, which is
 * also what keeps `currentDeadline` a plain, un-extended addition for the common case: no
 * window configured, no `deadlineAfter` call, no behavior change from before this task.
 */
function effectivePauseWindow(state: DraftState): PauseWindow | null {
  const window = state.config.pauseWindow ?? null;
  const tier = currentTier(state);
  if (window === null || tier === null) return null;
  return tier.pickSeconds >= window.appliesAtOrAbovePickSeconds ? window : null;
}

export function currentDeadline(state: DraftState): string | null {
  const turn = currentTurnClock(state);
  if (turn === null) return null;
  const window = effectivePauseWindow(state);
  if (window === null) return new Date(Date.parse(turn.startedAt) + turn.seconds * MS_PER_SECOND).toISOString();
  return deadlineAfter(turn.startedAt, turn.seconds, window);
}

/**
 * When the moderator should speak up on the current turn: `thresholdPct` of the way from
 * `turnStartedAt` to the deadline. The percentage is an INPUT (the service's
 * `DRAFT_NUDGE_CONFIG.thresholdPct`) so the engine stays free of service configuration and
 * of any ambient clock. Null whenever no turn is running.
 *
 * Routed through the SAME `deadlineAfter` fixpoint `currentDeadline` uses, over the
 * threshold's own share of the clock rather than the full length — a flat `thresholdPct` of an
 * UN-paused clock could still land inside the freeze even though `currentDeadline` itself lands
 * safely past it, which would mean the moderator speaking up in the middle of the night. This is
 * what keeps `draft-service/nudge.ts` correct without it ever reading `pauseWindow` itself: both
 * `dueAt` and `deadlineAt` it reads are already pushed past the freeze by the time it sees them.
 */
export function nudgeDeadline(state: DraftState, thresholdPct: number): string | null {
  const turn = currentTurnClock(state);
  if (turn === null) return null;
  const thresholdSeconds = turn.seconds * (thresholdPct / 100);
  const window = effectivePauseWindow(state);
  if (window === null) return new Date(Date.parse(turn.startedAt) + thresholdSeconds * MS_PER_SECOND).toISOString();
  return deadlineAfter(turn.startedAt, thresholdSeconds, window);
}

/**
 * The instant picks resume, if the CURRENT turn started while the freeze was already running —
 * null otherwise, including while no turn is running at all. Purely a function of
 * `turnStartedAt` (never an ambient "now": the engine reads no clock of its own), which is
 * exactly right for what emits it: `draftClockView` is recomputed fresh the moment a turn
 * starts, so `turnStartedAt` IS "now" at the instant this field is produced, and it rides every
 * `draft.*` payload from there — the same freshness model `deadlineAt` already uses.
 */
function pausedUntilFor(state: DraftState): string | null {
  if (state.turnStartedAt === null) return null;
  const window = effectivePauseWindow(state);
  return window === null ? null : pauseWindowEndAt(state.turnStartedAt, window);
}

/**
 * Whether the room is frozen at `atIso` — the current turn's tier qualifies for the freeze AND
 * `atIso` itself falls inside an occurrence of it. This is what `draft-service/nudge.ts` calls
 * against the ticker's live "now": `currentDeadline`/`nudgeDeadline` each push their OWN instant
 * past the freeze, but the open interval BETWEEN an extended due time and an extended deadline
 * still spans the freeze itself (a due time that already sits at the window's open, for
 * instance, never moves at all), so a range check against those two alone is not enough — the
 * moderator needs a direct answer to "is right now inside the freeze," which is exactly this.
 * A plain selector like every other function in this file: it reads state and a caller-supplied
 * instant, decides nothing, and applies no action, so nothing here can ever change what a
 * replay decides — the reducer-purity ruling (`pause.ts`'s own docblock) is about `reduce.ts`,
 * `snake.ts`, `auction.ts` and `apply-pick.ts` never reading `pauseWindow`, and this file was
 * always the one place that does.
 */
export function isPaused(state: DraftState, atIso: string): boolean {
  const window = effectivePauseWindow(state);
  return window !== null && pauseWindowEndAt(atIso, window) !== null;
}

/** When the clock next tightens and to what — null before/after the draft, or on the final tier. */
export function nextTightening(state: DraftState): Tightening | null {
  if (state.phase !== "in_progress" || state.turnStartedAt === null) return null;
  return nextTighteningAfter(state.turnStartedAt, state.config.kickoffAt, state.config.clockSchedule);
}

/** The clock-and-turn slice every draft event and the full view both carry. */
export interface DraftClockView {
  readonly phase: DraftStatus;
  readonly sequence: number;
  readonly pickNumber: number;
  readonly onClockTeamId: string | null;
  readonly deadlineAt: string | null;
  readonly clockSeconds: number | null;
  readonly nextTightening: Tightening | null;
  /**
   * The next `DRAFT_VIEW_CONFIG.upcomingCount` teams due to act, current turn first. Rides
   * every event payload so a client can answer "when am I up?" with an index lookup instead
   * of a turn-order rule of its own.
   */
  readonly upcoming: readonly string[];
  /**
   * When picks resume, if the current turn started during the overnight freeze — null the rest
   * of the time. Optional so a hand-built `DraftClockView` elsewhere in this codebase's own test
   * suite (predating Task 4) still type-checks without it; `draftClockView` below always sets it
   * explicitly, one way or the other, so no real payload this engine produces ever omits it.
   */
  readonly pausedUntil?: string | null;
}

/**
 * Everything about "whose turn, until when, and what changes next", in one object. Both
 * `draftStateView` and every `draft.*` event payload embed exactly this, so a client that has
 * applied an event knows the new deadline and tier without re-deriving either.
 */
export function draftClockView(state: DraftState): DraftClockView {
  return {
    phase: state.phase,
    sequence: state.sequence,
    pickNumber: state.pickNumber,
    onClockTeamId: teamOnClock(state),
    deadlineAt: currentDeadline(state),
    clockSeconds: currentClockSeconds(state),
    nextTightening: nextTightening(state),
    upcoming: upcomingOnClock(state, DRAFT_VIEW_CONFIG.upcomingCount),
    pausedUntil: pausedUntilFor(state),
  };
}

/**
 * Every team's current ceiling. Computed here, once, because the budget-reserve rule
 * (invariant 4 in `docs/draft-engine.md`) must exist in exactly one place — a client that
 * re-derived it would drift the moment the config changed.
 */
export function maxBidsFor(state: DraftState): Readonly<Record<string, number>> {
  if (auctionOf(state) === null) return {};
  return Object.fromEntries(state.draftOrder.map((teamId) => [teamId, maxBidFor(state, teamId)]));
}

/** The one serialization of a draft: what `GET /api/drafts/:id` returns and Plan C renders. */
export interface DraftStateView extends DraftClockView {
  readonly draftId: string;
  readonly leagueId: string;
  readonly format: DraftFormat;
  /** The league's roster shape — what lets the UI draw the empty slots, not just the filled ones. */
  readonly slotConfig: readonly RosterSlotConfig[];
  readonly draftOrder: readonly string[];
  readonly picks: readonly CompletedPick[];
  readonly rosters: Readonly<Record<string, readonly RosterSlot[]>>;
  readonly budgets: Readonly<Record<string, number>>;
  readonly auction: AuctionState | null;
  readonly availablePlayerIds: readonly string[];
  /**
   * Lowest legal next bid; null for a snake draft, and for an auction draft that hasn't
   * started yet (`auctionOf` is null until `START_DRAFT`, since `state.auction` itself is
   * null before then).
   */
  readonly minBid: number | null;
  /**
   * teamId → highest legal bid right now. Empty for a snake draft, and for an auction draft
   * that hasn't started yet (`auctionOf` is null until `START_DRAFT`, since `state.auction`
   * itself is null before then).
   */
  readonly maxBids: Readonly<Record<string, number>>;
}

export function draftStateView(state: DraftState): DraftStateView {
  return {
    ...draftClockView(state),
    draftId: state.config.draftId,
    leagueId: state.config.leagueId,
    format: state.config.format,
    slotConfig: state.config.slotConfig,
    draftOrder: state.draftOrder,
    picks: state.picks,
    rosters: state.rosters,
    budgets: state.budgets,
    auction: state.auction,
    availablePlayerIds: availablePool(state).map((p) => p.playerId),
    minBid: auctionOf(state) === null ? null : minBidFor(state),
    maxBids: maxBidsFor(state),
  };
}
