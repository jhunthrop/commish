import type { Position } from "@/domain/player";
import type { Law } from "@/projections/laws/types";
import { oddsPhrase } from "./odds-phrase";

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
  const lead = `Drafters are taking him about ${picksFromNow} picks from now.`;
  if (makeItBack === null) return lead;

  // ONE ODDS VOICE (final review finding 7): the shared `oddsPhrase` — the same quarter-rounded
  // phrasing `drawer-assistant-tab.tsx` and `reasonSentence` already speak in — rather than this
  // module's own raw percent. `reachSentence` stays unmounted this branch (deferral recorded in
  // the ledger), but its own copy no longer disagrees with the rest of the product's one voice.
  return `${lead} Our sims make it ${oddsPhrase(makeItBack)} he is still here at your next turn.`;
}

export interface StackCandidate {
  readonly playerId: string;
  readonly name: string;
  readonly position: Position;
  readonly nflTeam: string;
}

/**
 * Which pass-catcher position(s) a law's own claim actually names — the SPECIFIC position(s) the
 * measured correlation is about, not "any pass-catcher" once any pass-catcher word appears
 * anywhere in the text. A claim naming "wide receiver" but not "tight end" is a WR-only
 * correlation; a TE rostered alongside the QB is not evidence of anything that claim measured.
 * A claim using the generic "pass-catcher"/"pass catcher" wording without naming either position
 * specifically is read as covering both, since that is what the word itself means. A claim
 * naming both positions individually covers both for the same reason. Empty means the claim
 * names no pass-catcher position at all, so it cannot be a stacking law regardless of whether it
 * mentions a quarterback.
 */
function passCatcherPositionsNamedIn(claim: string): ReadonlySet<Position> {
  const lower = claim.toLowerCase();
  const named = new Set<Position>();
  if (lower.includes("wide receiver")) named.add("WR");
  if (lower.includes("tight end")) named.add("TE");
  if (named.size === 0 && (lower.includes("pass-catcher") || lower.includes("pass catcher"))) {
    named.add("WR");
    named.add("TE");
  }
  return named;
}

/**
 * True when a law's own plain-words claim states a correlation between a quarterback and a
 * specifically-named pass-catcher position — the only shape of law a stack suggestion is allowed
 * to ride on.
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
  return law.claim.toLowerCase().includes("quarterback") && passCatcherPositionsNamedIn(law.claim).size > 0;
}

/**
 * The roster teammate, if any, that pairs with `candidate` under a stack whose pass-catcher half
 * is restricted to `passCatcherPositions` — the positions the law's OWN claim actually named
 * (`passCatcherPositionsNamedIn`), so a TE-specific law can never be satisfied by a rostered WR
 * and vice versa.
 */
function findStackTeammate(
  candidate: StackCandidate,
  roster: readonly StackCandidate[],
  passCatcherPositions: ReadonlySet<Position>,
): StackCandidate | null {
  const candidateIsQb = candidate.position === "QB";
  const candidateIsNamedPassCatcher = passCatcherPositions.has(candidate.position);
  if (!candidateIsQb && !candidateIsNamedPassCatcher) return null;

  return (
    roster.find((teammate) => {
      if (teammate.nflTeam !== candidate.nflTeam) return false;
      if (candidateIsQb) return passCatcherPositions.has(teammate.position);
      return teammate.position === "QB";
    }) ?? null
  );
}

/**
 * A stack note only where a law in the payload actually supports the QB+pass-catcher correlation
 * AND the roster already holds the matching half of the pair, at the SPECIFIC pass-catcher
 * position that law's claim names, on the same NFL team. Checks every stacking law in the payload
 * (not just the first one found) so a TE-specific law sitting before a WR-specific one, say,
 * cannot shadow a real WR match. Absent a matching law-plus-teammate pair, this returns null —
 * never an invented suggestion, and never a law's claim stitched onto a position it never
 * measured (see `isStackCorrelationLaw`'s docblock for why no real law matches today).
 */
export function stackNoteFor(candidate: StackCandidate, roster: readonly StackCandidate[], laws: readonly Law[]): string | null {
  for (const law of laws) {
    if (!isStackCorrelationLaw(law)) continue;

    const teammate = findStackTeammate(candidate, roster, passCatcherPositionsNamedIn(law.claim));
    if (teammate === null) continue;

    // `law.claim` is server-authored registry content, appended verbatim rather than reworded
    // here (this module states numbers and facts, never rewrites someone else's claim text). No
    // real law matches `isStackCorrelationLaw` today, so this branch is unreachable in
    // production; a future stacking law's own claim should itself follow the copy rules, the
    // same bar every other registry claim (`populations.ts`'s `LAW_ENTRIES`) is already held to.
    return `${candidate.name} stacks with your ${teammate.name} on ${candidate.nflTeam}. ${law.claim}`;
  }

  return null;
}
