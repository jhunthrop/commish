import type { Position } from "@research/domain/player";
import type { StatComparison } from "@/components/ui";
import { comparisonWithin } from "@/components/ui";
import type { MatchupDetail } from "../contract";

/**
 * THE COMPARISON SETS THE SEASON SURFACES HAVE.
 *
 * Rule 1's magnitude amendment (`docs/design/2026-08-27-fun-pass-spec.md`, founder-approved
 * 2026-08-27) permits heat colour "only where the comparison is genuine and stated — a percentile
 * within a defined population, never a designer's feeling about whether 14.2 is a good number."
 * `Stat` enforces the second half by refusing to tint without a `StatComparison`; this module is
 * the first half, and it is deliberately the only place in the league room that builds one.
 *
 * Everything here is pure and reads nothing new: the matchup page already holds every starter in
 * the week (`MatchupWeekBody.matchups`), and the standings table already holds every team's
 * points. A heat map that needed a new query would be a different feature; this one is the same
 * information given a shape that carries meaning.
 */

/** The population names, in the words a manager would use — `Stat` speaks them in a sentence
 *  ("Top 8% of starting quarterbacks this week."), so they are noun phrases, never labels. */
export const POSITION_POPULATION: Readonly<Record<Position, string>> = {
  QB: "starting quarterbacks this week",
  RB: "starting running backs this week",
  WR: "starting wide receivers this week",
  TE: "starting tight ends this week",
  K: "starting kickers this week",
  DEF: "starting defenses this week",
};

/**
 * The ranking arithmetic and its refusal now live one layer down, in `@/components/ui/magnitude`,
 * because `Table` judges a column with the same two functions and a UI primitive cannot reach into
 * a room. Re-exported rather than re-implemented: this module stays the address the season
 * surfaces already import from, and there is still exactly one percentile in the product.
 */
export { percentileWithin, comparisonWithin, type HeatDirection } from "@/components/ui";

/**
 * Every point total a STARTER put on the board this week, pooled by position, across both sides
 * of every matchup in the week.
 *
 * Starters only: a bench player scored for nobody, and pooling them would rank a manager's real
 * lineup against players who never counted. `points === null` is left out for the same reason the
 * roster table renders it as a dash rather than a zero — "has not played" and "played and scored
 * nothing" are different facts (`MatchupLineupEntry.points`'s own docblock), and folding the first
 * into the second would drag every real score up the ramp on a Sunday morning.
 */
export function startedPointsByPosition(matchups: readonly MatchupDetail[]): ReadonlyMap<Position, readonly number[]> {
  const pool = new Map<Position, number[]>();
  for (const matchup of matchups) {
    for (const side of [matchup.home, matchup.away]) {
      for (const starter of side.starters) {
        if (starter.position === null || starter.points === null) continue;
        const existing = pool.get(starter.position);
        if (existing === undefined) pool.set(starter.position, [starter.points]);
        else existing.push(starter.points);
      }
    }
  }
  return pool;
}

/**
 * One starter's line against the players who share their job this week. A tight end is not
 * compared against a quarterback: the whole reason 14.2 is a good number or a bad one is which
 * position produced it, and a pool that mixed them would rank every kicker last for being a
 * kicker.
 */
export function starterComparison(
  byPosition: ReadonlyMap<Position, readonly number[]>,
  position: Position | null,
  points: number | null,
): StatComparison | undefined {
  if (position === null || points === null) return undefined;
  const values = byPosition.get(position);
  if (values === undefined) return undefined;
  return comparisonWithin(values, points, POSITION_POPULATION[position]);
}
