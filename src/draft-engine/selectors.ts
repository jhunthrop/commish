import type { DraftPoolEntry, DraftStatus } from "@/domain/draft";
import type { DraftFormat } from "@/domain/league";
import type { RosterSlot, RosterSlotConfig } from "@/domain/roster";
import { auctionOf, rosterFor, totalRosterSlots, type AuctionState, type CompletedPick, type DraftState } from "./state";
import { snakeTeamForPick } from "./order";
import { assignSlot } from "./slotting";
import { AUCTION_CONFIG, type ClockTier } from "./config";
import { MS_PER_SECOND, clockTierFor, nextTighteningAfter, type Tightening } from "./clock-schedule";

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

/**
 * The autopick policy, stated once: the highest-ranked undrafted player this team can
 * legally roster. Ranking is `state.pool`'s order — an explicit input snapshotted at
 * START_DRAFT, never an ambient lookup — so the same log always autopicks the same player.
 */
export function bestAvailableFor(state: DraftState, teamId: string): DraftPoolEntry | null {
  const roster = rosterFor(state, teamId);
  for (const entry of availablePool(state)) {
    if (assignSlot({ position: entry.position, roster, slotConfig: state.config.slotConfig }).ok) return entry;
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

export function currentDeadline(state: DraftState): string | null {
  const turn = currentTurnClock(state);
  if (turn === null) return null;
  return new Date(Date.parse(turn.startedAt) + turn.seconds * MS_PER_SECOND).toISOString();
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
