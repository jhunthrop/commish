import type { Position } from "@/domain/player";
import type { Law } from "@/projections/laws/types";

/**
 * ROSTER FIT — Task 5: three pure client-side readings of how a candidate fits the roster you
 * are already building. Every sentence below is built only from the numbers passed in — no
 * fetching, no invented correlations, no estimating past what the inputs actually say.
 */

export interface ByeCollision {
  readonly week: number;
  readonly count: number;
  /** What drafting the candidate would bring the total to — "he'd make it four." */
  readonly wouldMake: number;
}

/**
 * `candidateId` and each entry of `rosterIds` are keys into `byeWeeks` — in the room's real
 * data that map is `RoomState.byeWeeks`, NFL team code to bye week (`use-draft-room.ts`), so in
 * practice these are NFL team codes (the caller resolves a player id to his team before calling,
 * which keeps this module free of any `Player`/`playersById` dependency). Two rostered players on
 * the same team naturally appear twice in `rosterIds` and both count.
 *
 * Returns null when the candidate's own bye week is unknown, or when nobody currently on the
 * roster shares it — a clean roster says nothing, it does not report a collision of zero.
 */
export function byeCollisionFor(
  candidateId: string,
  byeWeeks: ReadonlyMap<string, number>,
  rosterIds: readonly string[],
): ByeCollision | null {
  const week = byeWeeks.get(candidateId);
  if (week === undefined) return null;

  const count = rosterIds.filter((id) => byeWeeks.get(id) === week).length;
  if (count === 0) return null;

  return { week, count, wouldMake: count + 1 };
}

/** Picks past the current pick a candidate's ADP must sit before the reach guard speaks up. */
export const REACH_THRESHOLD_PICKS = 12;

export interface ReachInput {
  /** The market's average draft position for the candidate, or null when the feed has none. */
  readonly candidateAdp: number | null;
  readonly currentPick: number;
  /**
   * Pre-computed odds (0-1) that the candidate lasts to your next turn — from `survivalProbability`
   * (`@/projections/decide/survival`), computed by the caller. This module never calls it: keeping
   * `reachSentence` a function of plain numbers is what keeps it pure and trivially testable, and
   * the caller already has the board and pick numbers `survivalProbability` needs. `null` when the
   * odds are not available (the brief: never estimate one inline).
   */
  readonly makeItBack: number | null;
}

/**
 * Null unless the market has the candidate going at least `REACH_THRESHOLD_PICKS` past the
 * current pick — reaching for someone the market says is not going anywhere yet is exactly the
 * moment this guard exists to speak up about. The second sentence is omitted entirely, never
 * replaced with a guess, when `makeItBack` is unknown.
 */
export function reachSentence(input: ReachInput): string | null {
  const { candidateAdp, currentPick, makeItBack } = input;
  if (candidateAdp === null) return null;

  const gap = candidateAdp - currentPick;
  if (gap < REACH_THRESHOLD_PICKS) return null;

  const picksFromNow = Math.round(gap);
  const lead = `The market has him going about ${picksFromNow} picks from now.`;
  if (makeItBack === null) return lead;

  return `${lead} Our sims make it ${formatOdds(makeItBack)} he is still here at your next turn.`;
}

function formatOdds(probability: number): string {
  return `${Math.round(probability * 100)}%`;
}

export interface StackCandidate {
  readonly playerId: string;
  readonly name: string;
  readonly position: Position;
  readonly nflTeam: string;
}

const PASS_CATCHER_POSITIONS: ReadonlySet<Position> = new Set(["WR", "TE"]);

/**
 * True when a law's own plain-words claim states a correlation between a quarterback and one of
 * his pass-catchers — the only shape of law a stack suggestion is allowed to ride on.
 *
 * AS OF THIS WRITING (2026-09-05) NO LAW IN THE REGISTRY MATCHES THIS. The six tribal claims
 * (`src/projections/laws/populations.ts`) measure single-player, within-season effects only:
 * a workload cliff, an age curve, a teammate target-share CANNIBALIZATION (a negative effect
 * between teammates, the opposite of a stack), a play-caller fingerprint, target-share
 * persistence, and touchdown regression. None of them pair a quarterback with a teammate's
 * positive correlation, and the `Law` shape itself (`position: "QB" | "RB" | "WR" | "TE" | "all"`,
 * one position per law) has no field for a cross-position pairing at all. `stackNoteFor` checks
 * the live payload rather than hard-coding `false`, so nothing here needs to change the day a
 * stacking law is discovered and measured — until then every call returns null, honestly.
 */
function isStackCorrelationLaw(law: Law): boolean {
  const claim = law.claim.toLowerCase();
  const mentionsQuarterback = claim.includes("quarterback");
  const mentionsPassCatcher =
    claim.includes("wide receiver") || claim.includes("tight end") || claim.includes("pass-catcher") || claim.includes("pass catcher");
  return mentionsQuarterback && mentionsPassCatcher;
}

function isPassCatcher(position: Position): boolean {
  return PASS_CATCHER_POSITIONS.has(position);
}

/** The roster teammate, if any, that pairs with `candidate` under a QB+pass-catcher stack. */
function findStackTeammate(candidate: StackCandidate, roster: readonly StackCandidate[]): StackCandidate | null {
  const candidateIsQb = candidate.position === "QB";
  const candidateIsPassCatcher = isPassCatcher(candidate.position);
  if (!candidateIsQb && !candidateIsPassCatcher) return null;

  return (
    roster.find((teammate) => {
      if (teammate.nflTeam !== candidate.nflTeam) return false;
      if (candidateIsQb) return isPassCatcher(teammate.position);
      return teammate.position === "QB";
    }) ?? null
  );
}

/**
 * A stack note only where a law in the payload actually supports the QB+pass-catcher correlation
 * AND the roster already holds the matching half of the pair on the same NFL team. Absent either
 * condition, this returns null — never an invented suggestion (see `isStackCorrelationLaw`'s
 * docblock for why that is the honest answer today).
 */
export function stackNoteFor(candidate: StackCandidate, roster: readonly StackCandidate[], laws: readonly Law[]): string | null {
  const stackLaw = laws.find(isStackCorrelationLaw);
  if (stackLaw === undefined) return null;

  const teammate = findStackTeammate(candidate, roster);
  if (teammate === null) return null;

  // `stackLaw.claim` is server-authored registry content, appended verbatim rather than
  // reworded here (this module states numbers and facts, never rewrites someone else's claim
  // text). No real law matches `isStackCorrelationLaw` today, so this branch is unreachable in
  // production; a future stacking law's own claim should itself follow the copy rules, the same
  // bar every other registry claim (`populations.ts`'s `LAW_ENTRIES`) is already held to.
  return `${candidate.name} stacks with your ${teammate.name} on ${candidate.nflTeam}. ${stackLaw.claim}`;
}
