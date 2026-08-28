import type { Position } from "@/domain/player";
import type { StatComparison } from "@/components/ui";
import type { MatchupDetail } from "../contract";
import { LEAGUE_ROOM_CONFIG } from "../config";

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
 * Percentile RANK with ties split down the middle: (how many the value beats, plus half of the
 * ones it equals) over the whole population. The value is a member of its own population, so the
 * best number in a set of twelve lands at ~0.96 rather than at 1.0 — "top of this week" and
 * "perfect" are different claims and the ramp should not conflate them. Twelve identical numbers
 * all land at 0.5, which is the honest answer: nothing separates them.
 *
 * An empty population answers 0.5 rather than `NaN`. `comparisonWithin` below is what actually
 * refuses a set too small to rank inside; this function's only job is to never hand `Stat` a
 * number that would tint on a divide-by-zero.
 */
export function percentileWithin(values: readonly number[], value: number): number {
  if (values.length === 0) return 0.5;
  let below = 0;
  let equal = 0;
  for (const other of values) {
    if (other < value) below += 1;
    else if (other === value) equal += 1;
  }
  return (below + equal / 2) / values.length;
}

/** Which end of the ramp the biggest number belongs on. Points for is `higher-is-better`; points
 *  against is the standings' one column where the biggest number is the worst one. */
export type HeatDirection = "higher-is-better" | "lower-is-better";

/**
 * A stated comparison, or `undefined` when there is nothing honest to state.
 *
 * `undefined` in three cases, and every one of them is a refusal rather than a fallback:
 * the value is not a real number, the population is smaller than
 * `LEAGUE_ROOM_CONFIG.heatMinPopulation`, or the population is empty. A percentile across three
 * scored quarterbacks is arithmetic dressed as a fact, and `Stat` renders an uncompared number as
 * ordinary ink — so refusing costs a tint and buys the claim being true.
 *
 * `population` is the caller's sentence, and for `lower-is-better` it must be phrased in the
 * direction the ramp reads ("teams by fewest points allowed"), because the sentence `Stat` speaks
 * out loud is built from it verbatim.
 */
export function comparisonWithin(
  values: readonly number[],
  value: number,
  population: string,
  direction: HeatDirection = "higher-is-better",
): StatComparison | undefined {
  if (!Number.isFinite(value)) return undefined;
  if (values.length < LEAGUE_ROOM_CONFIG.heatMinPopulation) return undefined;
  const rank = percentileWithin(values, value);
  return { percentile: direction === "lower-is-better" ? 1 - rank : rank, population };
}

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
