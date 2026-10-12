import type { Position } from "@research/domain/player";
import type { CompletedPick } from "@/draft-engine";
import type { Verdict } from "../lib/verdict";
import { DRAFT_ROOM_CONFIG } from "./config";
import type { PickReview } from "./pick-review";

/**
 * THE DEBRIEF'S ARITHMETIC (the mock-drafts workflow pass, 2026-09-03) — every aggregate the
 * rebuilt debrief and the lobby's learning column state, derived from the SAME facts the verdict
 * machinery already computes (`reviewPicks`, `../state/pick-review`; `verdictFor`,
 * `../lib/verdict`). Nothing here judges a pick twice: a count is a count OF those verdicts, so
 * the page can never say "3 reaches" over a lane that shows four.
 *
 * Pure on purpose, and imported from BOTH sides of the wire: the debrief page derives these in
 * the browser from the room's own snapshot, and `@/mock-draft-service/debrief` derives the very
 * same numbers server-side for the lobby's learning column — one derivation, two callers, the
 * only way the two surfaces can never disagree about the same finished draft.
 */

/** A pick's facts beside the verdict those facts earn — the pair every consumer below reads. */
export interface JudgedReview {
  readonly review: PickReview;
  readonly verdict: Verdict;
}

export interface DebriefCounts {
  readonly total: number;
  /** Picks that took the board's own best player still available (`bestAvailableDelta === 0`) —
   *  strictly overall, never the softer within-position zero, so "9 of 15 were the board's best
   *  available" claims exactly what it says. */
  readonly bestAvailable: number;
  /** Picks with `DRAFT_ROOM_CONFIG.debrief.reachRankedHigher` or more players ranked higher
   *  still on the board — the debrief's own stated definition of a reach, printed beside the
   *  number wherever it renders. */
  readonly reaches: number;
}

export function debriefCounts(reviews: readonly PickReview[]): DebriefCounts {
  const threshold = DRAFT_ROOM_CONFIG.debrief.reachRankedHigher;
  return {
    total: reviews.length,
    bestAvailable: reviews.filter((review) => review.bestAvailableDelta === 0).length,
    reaches: reviews.filter((review) => review.bestAvailableDelta >= threshold).length,
  };
}

/** "9 of 15" — the fraction the learning column's history rows carry. */
export function bestAvailableFraction(counts: DebriefCounts): string {
  return `${counts.bestAvailable} of ${counts.total}`;
}

/** "1.08" — global pick number as round.slot, zero-padded the way every board reads one. */
export function formatPickSlot(pickNumber: number, teamCount: number): string {
  if (teamCount < 1) return String(pickNumber);
  const round = Math.ceil(pickNumber / teamCount);
  const slot = pickNumber - (round - 1) * teamCount;
  return `${round}.${String(slot).padStart(2, "0")}`;
}

/**
 * The round a team FIRST took each position in, from the draft's own log. `positionOf` is
 * injected as a lookup (playerId → position) rather than a `Player[]` so the server caller can
 * hand the same map it already built — and so a pick whose player is unknown contributes
 * nothing rather than a fabricated position.
 */
export function firstRoundByPosition(
  picks: readonly CompletedPick[],
  positionOf: ReadonlyMap<string, Position>,
  teamId: string,
): ReadonlyMap<Position, number> {
  const first = new Map<Position, number>();
  for (const pick of [...picks].sort((a, b) => a.pickNumber - b.pickNumber)) {
    if (pick.teamId !== teamId) continue;
    const position = positionOf.get(pick.playerId);
    if (position === undefined || first.has(position)) continue;
    first.set(position, pick.round);
  }
  return first;
}

/**
 * The "room's average TE round" clause's own honesty gate (the canvas laws: *"the 'room
 * average' round facts render only if bot pick logs support them, else the clause drops"*).
 * Every seat's first round at `position`, excluding `excludeTeamId` (the caller's own seat —
 * the clause compares the caller TO the room). Returns null unless EVERY other seat took the
 * position at least once: an average over a room where some seats never drafted a kicker is a
 * different, mushier fact than the sentence claims, so the clause drops instead.
 */
export function roomAverageFirstRound(
  picks: readonly CompletedPick[],
  positionOf: ReadonlyMap<string, Position>,
  draftOrder: readonly string[],
  position: Position,
  excludeTeamId: string,
): number | null {
  const others = draftOrder.filter((teamId) => teamId !== excludeTeamId);
  if (others.length === 0) return null;
  const rounds: number[] = [];
  for (const teamId of others) {
    const round = firstRoundByPosition(picks, positionOf, teamId).get(position);
    if (round === undefined) return null;
    rounds.push(round);
  }
  return Math.round(rounds.reduce((sum, round) => sum + round, 0) / rounds.length);
}

/**
 * How the caller's early rounds leaned: picks per position through
 * `DRAFT_ROOM_CONFIG.debrief.shapeRounds`, plus the leader — the position taken most, ties
 * broken by whoever reached the count first in pick order (the earlier lean is the truer one).
 * Null leader when the team made no early picks at all.
 */
export interface PositionShape {
  readonly counts: ReadonlyMap<Position, number>;
  readonly leader: { readonly position: Position; readonly count: number } | null;
}

export function positionShape(
  picks: readonly CompletedPick[],
  positionOf: ReadonlyMap<string, Position>,
  teamId: string,
): PositionShape {
  const throughRound = DRAFT_ROOM_CONFIG.debrief.shapeRounds;
  const counts = new Map<Position, number>();
  let leader: { position: Position; count: number } | null = null;
  for (const pick of [...picks].sort((a, b) => a.pickNumber - b.pickNumber)) {
    if (pick.teamId !== teamId || pick.round > throughRound) continue;
    const position = positionOf.get(pick.playerId);
    if (position === undefined) continue;
    const count = (counts.get(position) ?? 0) + 1;
    counts.set(position, count);
    if (leader === null || count > leader.count) leader = { position, count };
  }
  return { counts, leader };
}

/**
 * The bye-stacking observation's honesty gate: the most-shared bye week among the given roster,
 * named only when at least `DRAFT_ROOM_CONFIG.debrief.byeStackMin` rostered players share it —
 * two teammates sharing a bye is every roster ever, and calling it stacking would be invented
 * psychology. `byeWeeks` is the REAL schedule read (`byeWeeksByTeam`,
 * `@research/reference/nfl-schedule`), carried to the room on `DraftPlayersBody.byeWeeks`; a
 * player whose team the schedule has no bye for contributes nothing.
 */
export function byeStackWeek(
  nflTeams: readonly string[],
  byeWeeks: ReadonlyMap<string, number>,
): { readonly week: number; readonly count: number } | null {
  const counts = new Map<number, number>();
  for (const team of nflTeams) {
    const week = byeWeeks.get(team);
    if (week === undefined) continue;
    counts.set(week, (counts.get(week) ?? 0) + 1);
  }
  let stacked: { week: number; count: number } | null = null;
  for (const [week, count] of counts) {
    if (count < DRAFT_ROOM_CONFIG.debrief.byeStackMin) continue;
    if (stacked === null || count > stacked.count || (count === stacked.count && week < stacked.week)) {
      stacked = { week, count };
    }
  }
  return stacked;
}

/**
 * The two picks worth a named row on the lobby's learning column: the single pick that beat the
 * board by most (the biggest positive slip — absent for a manager who never beat it, an honest
 * silence rather than a "best" that was merely least bad), and the worst reach (the most
 * players ranked higher at the moment of the pick, only when it clears the reach threshold).
 */
export interface NotableReviews {
  readonly best: JudgedReview | null;
  readonly worstReach: JudgedReview | null;
}

export function notableReviews(judged: readonly JudgedReview[]): NotableReviews {
  const best = judged.reduce<JudgedReview | null>(
    (leader, entry) =>
      entry.verdict.slip > 0 && (leader === null || entry.verdict.slip > leader.verdict.slip) ? entry : leader,
    null,
  );
  const threshold = DRAFT_ROOM_CONFIG.debrief.reachRankedHigher;
  const worstReach = judged.reduce<JudgedReview | null>(
    (leader, entry) =>
      entry.review.bestAvailableDelta >= threshold &&
      (leader === null || entry.review.bestAvailableDelta > leader.review.bestAvailableDelta)
        ? entry
        : leader,
    null,
  );
  return { best, worstReach };
}

/**
 * ACROSS YOUR LAST MOCKS — the habits card's whole input, one row per completed mock. Only ever
 * built from stored results (the canvas laws: *"only states patterns computable from stored
 * results … no invented psychology"*).
 */
export interface MockHabitFacts {
  /** The round this mock's first tight end went in, or null when the mock never drafted one. */
  readonly firstTeRound: number | null;
  /** Whether every pick in the first two rounds took the board's own best available. */
  readonly earlyBestAvailable: boolean;
}

export interface MockHabits {
  readonly mockCount: number;
  /** Present only when EVERY summarized mock drafted a tight end — a pattern over some of the
   *  mocks is not the pattern the sentence claims. Rounds in mock order, newest first. */
  readonly firstTeRounds: readonly number[] | null;
  /** How many of the mocks opened with two best-available rounds. */
  readonly earlyBestAvailableCount: number;
}

/** Null under two completed mocks — one data point is an anecdote, not a habit. */
export function mockHabits(facts: readonly MockHabitFacts[]): MockHabits | null {
  if (facts.length < 2) return null;
  const teRounds = facts.map((fact) => fact.firstTeRound);
  return {
    mockCount: facts.length,
    firstTeRounds: teRounds.every((round): round is number => round !== null) ? teRounds : null,
    earlyBestAvailableCount: facts.filter((fact) => fact.earlyBestAvailable).length,
  };
}

/** `MockHabitFacts.earlyBestAvailable`, derived: every review in rounds one and two took the
 *  board's best. A team with no picks in those rounds (a commissioner, a broken log) reads
 *  false rather than a vacuous true. */
export function earlyRoundsBestAvailable(reviews: readonly PickReview[], teamCount: number): boolean {
  const early = reviews.filter((review) => review.pickNumber <= teamCount * 2);
  return early.length > 0 && early.every((review) => review.bestAvailableDelta === 0);
}
