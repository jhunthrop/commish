import { chipEligibleLaws } from "./registry";
import type { Law } from "./types";

/**
 * THE PRICING-ADMISSION GATE (fit-round Task 3, deliverable A) — which confirmed laws are allowed to
 * MOVE A PLAYER'S PRICE, as opposed to which laws are confirmed.
 *
 * THE DISTINCTION THIS FILE EXISTS TO KEEP. "Confirmed" is a MEASUREMENT statement: the discovery
 * pipeline's own Benjamini-Hochberg screen on the train window plus full-window replication with
 * every fold agreeing in sign (`discovery/measure.ts`, `registry.ts`'s `verdictForDiscoveredLaw`).
 * Nothing in this file touches it. `/player-laws`, the registry, `board-reasons.ts`'s reason list and
 * `chipEligibleLaws` all keep showing exactly what was measured, unchanged, because a measurement we
 * no longer trust enough to bet on is still a measurement we made and must keep displaying honestly.
 *
 * PRICING ADMISSION IS A POLICY on top of that measurement, and the policy is Task 2's own vigilance
 * record: nine of the ninety confirmations were SELF-MARKED SUSPECT by the measurement round that
 * produced them, each for a named, checked reason, and a law nobody could separate from an artifact
 * has no business spending a fantasy manager's draft pick. The list below carries each id WITH its
 * reason, so the gate is auditable at the seam rather than being a bare id list somebody has to go
 * find the argument for.
 *
 * THE COST IF THIS POLICY IS WRONG IS BOUNDED, which is why it is safe to apply now: the blend's own
 * fit grid contains the incumbent in every dimension, so a wrong admission policy simply scores worse
 * on train than the alternative and never ships.
 *
 * WHAT THIS GATE IS NOT. It is not a second verdict, not a re-measurement, and not a filter on
 * `registry()` itself. It composes ON TOP of `chipEligibleLaws` (`registry.ts`) — every law this gate
 * admits is a law a client-facing chip may cite, never the other way round — so the two seams can
 * never disagree about whether a law exists, only about whether it may spend points.
 */

/** One suspect law: the id the gate refuses, and the one-line reason from Task 2's vigilance record. */
export interface SuspectLaw {
  readonly id: string;
  readonly reason: string;
}

/**
 * THE NINE, verbatim from Task 2's report section 3c ("Summary of what is marked suspect: 9 of 90")
 * and the founder-level ruling that followed it (`progress.md`, Task 2's ruling and close-out):
 * the pricing-eligible set is the 90 confirmed MINUS these.
 *
 * The two correlated CLUSTERS that report also names — the 40-law touchdown/goal-line family and the
 * 33-law age/experience family — are deliberately NOT here. They are not suspect; they are
 * REDUNDANT, and redundancy is handled where it belongs, in the blend's own law-channel grid
 * dimensions (`market/law-clusters.ts`'s dedup and the per-player law-channel cap), never by
 * refusing to price them.
 */
export const SUSPECT_LAWS: readonly SuspectLaw[] = [
  {
    id: "threshold:RB:snapShare:q20",
    reason:
      "Fullback-driven: with the 565 crosswalk-restored player-seasons removed the effect collapses from +1.037 to +0.130 with a CI spanning zero — a statement about part-time fullbacks, not about running backs (Task 2, vigilance A).",
  },
  {
    id: "and:WR:threshold:WR:incomingCoachTenureSeasons:q70+threshold:WR:touchdownPointsShare:q70",
    reason:
      "Era sign flip: old decade +0.245 (n=44) against 2013-2023 -1.061 (n=343), the only sign disagreement among the 40 laws with enough pairs in both eras (Task 2, vigilance B).",
  },
  {
    id: "delta:RB:pointsPerGame:q30:rose_into",
    reason: "Match-key trajectory family: pointsPerGame IS the match key, and the family's sign pattern is exactly what pure mean reversion produces (Task 2, vigilance D).",
  },
  {
    id: "delta:RB:pointsPerGame:q70:fell_out_of",
    reason: "Match-key trajectory family: pointsPerGame IS the match key, and the family's sign pattern is exactly what pure mean reversion produces (Task 2, vigilance D).",
  },
  {
    id: "delta:TE:pointsPerGame:q80:fell_out_of",
    reason: "Match-key trajectory family: pointsPerGame IS the match key, and the family's sign pattern is exactly what pure mean reversion produces (Task 2, vigilance D).",
  },
  {
    id: "delta:WR:pointsPerGame:q20:fell_out_of",
    reason: "Match-key trajectory family: pointsPerGame IS the match key, and the family's sign pattern is exactly what pure mean reversion produces (Task 2, vigilance D).",
  },
  {
    id: "delta:WR:pointsPerGame:q70:rose_into",
    reason: "Match-key trajectory family: pointsPerGame IS the match key, and the family's sign pattern is exactly what pure mean reversion produces (Task 2, vigilance D).",
  },
  {
    id: "delta:WR:pointsPerGame:q80:fell_out_of",
    reason: "Match-key trajectory family: pointsPerGame IS the match key, and the family's sign pattern is exactly what pure mean reversion produces (Task 2, vigilance D).",
  },
  {
    id: "delta:WR:pointsPerGame:q90:fell_out_of",
    reason: "Match-key trajectory family: pointsPerGame IS the match key, and the family's sign pattern is exactly what pure mean reversion produces (Task 2, vigilance D).",
  },
];

/** The nine ids, as a set — the gate's own membership test. */
export const SUSPECT_LAW_IDS: ReadonlySet<string> = new Set(SUSPECT_LAWS.map((suspect) => suspect.id));

/**
 * THE LAWS A PRICE MAY BE MOVED BY — `chipEligibleLaws` minus the suspects, and nothing else.
 *
 * Built by COMPOSITION with the chip seam rather than by re-deriving "which laws count" a second
 * time, so the two can never drift into two different definitions of an admissible law. The subset
 * relation is deliberate and tested: everything pricing admits, a chip may cite.
 */
export function pricingEligibleLaws(laws: readonly Law[]): readonly Law[] {
  return chipEligibleLaws(laws).filter((law) => !SUSPECT_LAW_IDS.has(law.id));
}

/** `pricingEligibleLaws` as ids — the membership test `market/blend.ts` actually needs, built once
 *  per blend rather than per candidate. */
export function pricingEligibleLawIds(laws: readonly Law[]): ReadonlySet<string> {
  return new Set(pricingEligibleLaws(laws).map((law) => law.id));
}
