import type { DraftPoolEntry, DraftStatus } from "@/domain/draft";
import type { DraftFormat } from "@/domain/league";
import type { Position } from "@/domain/player";
import type { RosterSlot, RosterSlotConfig, RosterSlotType } from "@/domain/roster";
import { auctionOf, rosterFor, totalPickCount, totalRosterSlots, type AuctionState, type CompletedPick, type DraftState } from "./state";
import { snakeTeamForPick } from "./order";
import { assignSlot, type SlotAssignment } from "./slotting";
import { deferredLateRoundPosition, needMultiplier, rankWeight } from "./scoring";
import { candidateRoleReader } from "./roster-need";
import { AUCTION_CONFIG, DRAFT_VIEW_CONFIG, type ClockTier, type DraftAutopickPolicy, type PauseWindow } from "./config";
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
 * Whether ANY team currently owes a pick (Task 5) — a plain existence check over `owedPicks`,
 * which is never allowed to hold an empty array for a key (`redeemOwedPick`'s own invariant,
 * `apply-pick.ts`), so key-presence alone answers it.
 */
export function hasOwedPicks(state: DraftState): boolean {
  return Object.keys(state.owedPicks).length > 0;
}

/**
 * The team whose owed pick is FIRST in line, or null when nobody owes one — Task 5's answer to
 * "how do multiple owed picks order": whichever pick number was missed earliest, across every
 * team, wins, because pick numbers are unique and monotonic across the whole draft. This is
 * the CATCH-UP turn's own "on the clock", walked in `draftOrder` for a deterministic scan.
 */
export function catchUpTeamId(state: DraftState): string | null {
  let bestTeam: string | null = null;
  let bestPick = Infinity;
  for (const teamId of state.draftOrder) {
    const first = state.owedPicks[teamId]?.[0];
    if (first !== undefined && first < bestPick) {
      bestPick = first;
      bestTeam = teamId;
    }
  }
  return bestTeam;
}

/**
 * Whose turn it is. Snake: the team on the clock, or — once every normal round has run
 * (`state.pickNumber` past `totalPickCount`) and a pick is still owed — the CATCH-UP arm:
 * whichever team is first in line for their owed pick (Task 5; `advanceSnake`, `snake.ts`, is
 * what puts the state into this range in the first place, and only when a pick is actually
 * owed). Auction: the team due to nominate — null while a lot is live, because during bidding
 * the clock belongs to everyone.
 */
export function teamOnClock(state: DraftState): string | null {
  if (state.phase !== "in_progress") return null;
  const auction = auctionOf(state);
  if (auction === null) {
    return state.pickNumber <= totalPickCount(state) ? snakeTeamForPick(state.draftOrder, state.pickNumber) : catchUpTeamId(state);
  }
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
 * The pieces both autopick-flavored selectors below share: the team's roster, the undrafted
 * pool, and the first LEGAL queued entry (the manager's own recorded intent, which beats any
 * heuristic in both of them). Computed once — `availablePool` already derives the drafted set
 * internally, so a queued entry's availability is checked against the pool it produces rather
 * than a second, separately-computed drafted-ids set.
 */
/**
 * Whether the room's own hand may take this player (the roster-status gate, 2026-09-08). A pool
 * entry the served board had off an active roster at START_DRAFT carries `excludedFromAutopick`
 * and is skipped by the clock's autopick, the auction's auto-nomination and the practice bots
 * alike; a manager's own click is not this function's business. Absent means eligible, so every
 * log written before the mark existed replays as it was picked.
 */
export function autopickEligible(entry: DraftPoolEntry): boolean {
  return entry.excludedFromAutopick !== true;
}

function autopickContext(state: DraftState, teamId: string): {
  readonly roster: readonly RosterSlot[];
  readonly available: readonly DraftPoolEntry[];
  /** Where the candidate would land on this roster, the engine's one legality oracle. */
  readonly assignmentFor: (entry: DraftPoolEntry) => SlotAssignment;
  readonly canFill: (entry: DraftPoolEntry) => boolean;
  readonly queuedFirst: DraftPoolEntry | null;
} {
  const roster = rosterFor(state, teamId);
  // The gate binds the QUEUE path too: a queued player the board has off an active roster is
  // still never the room's pick for a manager, however he got onto the list.
  const available = availablePool(state).filter(autopickEligible);
  const availableIds = new Set(available.map((entry) => entry.playerId));
  const assignmentFor = (entry: DraftPoolEntry): SlotAssignment => assignSlot({ position: entry.position, roster, slotConfig: state.config.slotConfig });
  const canFill = (entry: DraftPoolEntry): boolean => assignmentFor(entry).ok;
  const queuedFirst = queuedEntriesFor(state, teamId).find((entry) => availableIds.has(entry.playerId) && canFill(entry)) ?? null;
  return { roster, available, assignmentFor, canFill, queuedFirst };
}

/**
 * How awake the need term is for this team: 0 on its first pick, scaling linearly to 1 once
 * its OWN roster (never the global pick number, so owed catch-up picks score sanely) is
 * `policy.rampFullAtRosterFraction` full. See the config's docblock and the spec
 * (`docs/superpowers/specs/2026-09-03-autopick-design.md`) for why linear. The policy is the
 * DRAFT'S OWN snapshot (`state.config.autopick`), never the module constant — the caller below
 * enforces that by construction.
 */
function needRamp(rosterLength: number, state: DraftState, policy: DraftAutopickPolicy): number {
  const fullAt = policy.rampFullAtRosterFraction * totalRosterSlots(state.config.slotConfig);
  // A zero-slot config (nothing is ever legal, so the roster is forever empty) would make the
  // division 0/0 = NaN; ramp 0 keeps every multiplier a defined number instead.
  if (fullAt <= 0) return 0;
  return Math.min(1, rosterLength / fullAt);
}

/**
 * How many of `teamId`'s own drafted players sit at each position — the join `surplusDamp`
 * needs (`NeedMultiplierOptions.rosteredAtPosition`, `scoring.ts`) and the one place it's
 * possible: `roster` (this team's filled `RosterSlot`s) only knows SLOT LABELS ("BENCH", not
 * "QB"), and `state.pool` is the only thing that knows every drafted player's true position.
 * Cross-referencing them here — instead of inside `scoring.ts` — is what keeps that module a
 * pure function of caller-supplied numbers, never of engine state.
 */
function rosteredCountsByPosition(roster: readonly RosterSlot[], pool: readonly DraftPoolEntry[]): ReadonlyMap<Position, number> {
  const positionOf = new Map(pool.map((entry) => [entry.playerId, entry.position]));
  const counts = new Map<Position, number>();
  for (const filled of roster) {
    const position = filled.playerId === null ? undefined : positionOf.get(filled.playerId);
    if (position !== undefined) counts.set(position, (counts.get(position) ?? 0) + 1);
  }
  return counts;
}

/**
 * The clock-expiry autopick policy, stated once — what `reduceSnakeExpiry` and
 * `reduceCatchUpExpiry` (`snake.ts`) fire when a real manager's clock runs out.
 *
 * Order of preference: the team's own ranked queue (first entry it can still legally roster
 * and nobody has taken — the manager's recorded intent, which beats any heuristic outright),
 * then a DETERMINISTIC argmax over every legal available player, scored
 * `rankWeight(legalIndex) × needMultiplier(position)` with the need term ramped by the team's
 * own draft progress (`needRamp` above). On a team's first pick the ramp is exactly 0, every
 * multiplier is exactly 1, and the argmax degenerates to plain board order — the pre-upgrade
 * behavior, provably. No RNG anywhere: `state.pool`, the roster AND the scoring policy are
 * explicit inputs carried in the action log (`config.autopick`, snapshotted at START_DRAFT —
 * this function never reads `AUTOPICK_CONFIG` itself, so a later retune can never change what
 * an already-persisted TIMER_EXPIRE picked), and equal scores resolve to the earlier board
 * index (the strict `>` below), so the same log always autopicks the same player —
 * non-negotiable in a money room. A config with NO snapshot is a log from before the upgrade:
 * it replays under the policy its expiries were actually derived with, the plain board-order
 * fallback (the F3 discipline — absent means the OLD behavior, never today's tunables).
 * Legality is `assignSlot`'s alone, so the endgame forcing (bench full ⇒ only unfilled
 * starters legal) is inherited, never restated.
 */
export function bestAvailableFor(state: DraftState, teamId: string): DraftPoolEntry | null {
  const { roster, available, assignmentFor, canFill, queuedFirst } = autopickContext(state, teamId);
  if (queuedFirst !== null) return queuedFirst;

  const policy = state.config.autopick ?? null;
  if (policy === null) return available.find(canFill) ?? null;

  const ramp = needRamp(roster.length, state, policy);
  const scorer = policy.rosterCeilings === undefined ? surplusDampScorer(state, roster, policy, ramp) : rosterCeilingScorer(state, roster, policy, ramp);
  const best: Record<CandidateBucket, { entry: DraftPoolEntry | null; score: number }> = {
    now: { entry: null, score: -Infinity },
    deferred: { entry: null, score: -Infinity },
    capped: { entry: null, score: -Infinity },
  };
  let legalIndex = 0;
  for (const entry of available) {
    const assignment = assignmentFor(entry);
    if (!assignment.ok) continue;
    const { need, bucket } = scorer(entry, assignment.slot);
    const score = rankWeight(legalIndex, policy.temperature) * need;
    // `legalIndex` advances for EVERY legal candidate, deferred or capped or not, so the board rank
    // a candidate is scored at never depends on his bucket: a deferred kicker sitting at legal
    // index 40 is still at 40 when the deferral lifts, and everyone below him is untouched.
    legalIndex += 1;
    if (score > best[bucket].score) best[bucket] = { entry, score };
  }
  // Deferring and capping are preferences; refusing to pick never is, and a null here would
  // stall a real room's clock. A board that is nothing but kickers, or nothing but a third
  // quarterback, still returns a pick.
  return best.now.entry ?? best.deferred.entry ?? best.capped.entry;
}

/**
 * Where a legal candidate sits for the argmax: `now` competes outright, `deferred` is taken only
 * when nothing competes (the late-round kicker and defence, the backup quarterback while a starter
 * is open), `capped` only when nothing else is legal at all (a body over the position's ceiling).
 */
type CandidateBucket = "now" | "deferred" | "capped";

interface CandidateNeed {
  readonly need: number;
  readonly bucket: CandidateBucket;
}

type CandidateScorer = (entry: DraftPoolEntry, landsIn: RosterSlotType) => CandidateNeed;

/**
 * The surplus-damp scoring (snapshots from 2026-09-03 through 2026-09-11): `needMultiplier` over
 * dedicated starters, compounding per extra body when the snapshot carries `surplusDamp`. Kept
 * byte for byte for every log that was made under it.
 */
function surplusDampScorer(state: DraftState, roster: readonly RosterSlot[], policy: DraftAutopickPolicy, ramp: number): CandidateScorer {
  const baseNeedOptions = {
    openSlotBoost: ramp * policy.needPerOpenStartingSlot,
    filledDamp: 1 - ramp * (1 - policy.startersFilledDamp),
    // Ramped the identical way `filledDamp` above is — see `NeedMultiplierOptions.surplusDamp`
    // (`scoring.ts`) and `DraftAutopickPolicy.surplusDamp` (`config.ts`) — so a team's very
    // first pick still degenerates to exactly board order (every dial neutral at ramp 0), and a
    // barely-awake ramp doesn't let this dial alone override what `filledDamp`'s own gentle
    // warm-up already guarantees. Undefined stays undefined: a config with no `surplusDamp` at
    // all (pre-fix snapshot) must never gain one from ramping arithmetic.
    surplusDamp: policy.surplusDamp === undefined ? undefined : 1 - ramp * (1 - policy.surplusDamp),
  };
  // Only computed when a snapshot actually carries `surplusDamp` — a pre-fix log skips this join
  // entirely, exactly as cheap as before the fix existed.
  const rosteredCounts = policy.surplusDamp === undefined ? null : rosteredCountsByPosition(roster, state.pool);
  return (entry) => {
    const needOptions = rosteredCounts === null ? baseNeedOptions : { ...baseNeedOptions, rosteredAtPosition: rosteredCounts.get(entry.position) ?? 0 };
    const deferred = deferredLateRoundPosition(entry.position, roster, state.config.slotConfig, policy.lateRoundOnlyRoundsFromEnd);
    return { need: needMultiplier(entry.position, roster, state.config.slotConfig, needOptions), bucket: deferred ? "deferred" : "now" };
  };
}

/**
 * The roster-need scoring (snapshots from 2026-09-12, `DraftAutopickPolicy.rosterCeilings`; the
 * whole rule is `roster-need.ts`'s docblock). A candidate who would start is warm per open
 * starting slot he could fill, the flex included; one who would sit is cooled to the bench damp,
 * and cooled again by `surplusDamp` for every body already SITTING at his position (a bench body,
 * never a flex starter, which is the count the surplus-damp scoring got wrong); a body over his
 * position's ceiling is capped; a backup at a backup-only position waits for the starters. Every
 * dial is ramped by the team's own progress exactly as before, so a first pick is still plain
 * board order.
 */
function rosterCeilingScorer(state: DraftState, roster: readonly RosterSlot[], policy: DraftAutopickPolicy, ramp: number): CandidateScorer {
  const slotConfig = state.config.slotConfig;
  const openSlotBoost = ramp * policy.needPerOpenStartingSlot;
  const benchDamp = 1 - ramp * (1 - policy.startersFilledDamp);
  const depthDamp = 1 - ramp * (1 - (policy.surplusDamp ?? 1));
  // The one role reader the practice bots and the advisor classify by too (`roster-need.ts`).
  const roleOf = candidateRoleReader(roster, slotConfig, state.pool, policy.rosterCeilings!);
  return (entry, landsIn) => {
    const role = roleOf(entry.position, landsIn);
    const need = role.starts ? 1 + openSlotBoost * role.openStartingSlots : benchDamp * depthDamp ** role.benchBodies;
    if (role.capped) return { need, bucket: "capped" };
    const deferred = role.waitsForStarters || deferredLateRoundPosition(entry.position, roster, slotConfig, policy.lateRoundOnlyRoundsFromEnd);
    return { need, bucket: deferred ? "deferred" : "now" };
  };
}

/**
 * The auto-NOMINATION policy — what `reduceAuctionExpiry` (`auction.ts`) puts up when the
 * nominating team stalls: the team's own ranked queue first, then plain board order.
 * Byte-identical to the policy both formats shared before the autopick above became
 * need-aware, ON PURPOSE: nomination is "which player do I put up for the whole room to bid
 * on", not "which player do I add to my roster", and a need-aware nomination would put up
 * exactly the players the stalled team needs — inviting the room to bid up its own shopping
 * list. Auction economics do not change by accident; see the spec's per-caller table.
 */
export function bestNominationFor(state: DraftState, teamId: string): DraftPoolEntry | null {
  const { available, canFill, queuedFirst } = autopickContext(state, teamId);
  if (queuedFirst !== null) return queuedFirst;
  return available.find(canFill) ?? null;
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
  /**
   * teamId → the pick numbers that team currently owes (Task 5), the identical shape
   * `DraftState.owedPicks` carries — so the room can render an owed pick as pending and tell
   * the owing manager they can still make it, without a second lookup. Optional for the same
   * reason `pausedUntil` is: this engine's own test suite predates Task 5 and hand-builds
   * plenty of `DraftClockView` literals that never set it; `draftClockView` below always sets
   * it explicitly, one way or the other, so no real payload this engine produces ever omits it.
   */
  readonly owedPicks?: Readonly<Record<string, readonly number[]>>;
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
    owedPicks: state.owedPicks,
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
