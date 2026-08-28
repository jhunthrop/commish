import { Z_NINETIETH } from "./normal";

/**
 * FLOOR AND CEILING, AND WHERE THEY ARE ALLOWED TO COME FROM.
 *
 * The engine spec's layer 3 says component projections are produced "as distributions, which is
 * what makes floor and ceiling free later instead of a bolted-on guess". They are not, yet.
 * Nothing in `src/projections/**` exports a per-player variance, quantile or interval: the whole
 * prediction surface is point estimates (`PredictedOpportunity`, `PlayerRates`, `StatLine`), and
 * the only dispersion the engine publishes is `ScoreCard`'s error over a cohort after the fact.
 *
 * SO THE DECISION LAYER TAKES A DISTRIBUTION AS AN ARGUMENT AND NEVER MANUFACTURES ONE. Deriving
 * a spread around somebody else's mean would be predicting, in the one layer that is forbidden to
 * predict, and it would be invisible to both scoreboards that could catch it being wrong. When
 * layer 3 emits distributions, callers pass those instead and nothing here changes.
 *
 * `realizedDispersion` is the one thing this module computes, and it is NOT a prediction: it is
 * the spread of what a player has ALREADY DONE, week to week. It reads outcomes, never
 * projections, and it adjusts no projected stat. It is the honest stopgap a caller can use to
 * build a distribution around a mean the model gave it, and it should be retired the day layer 3
 * has its own.
 */

/**
 * A projection's shape, stated at fixed quantiles so a floor from one caller means the same as a
 * floor from another. The tenth and ninetieth percentiles rather than the extremes: a "ceiling"
 * that happens one week in fifty is a number nobody can plan around.
 */
export interface ProjectionDistribution {
  /** Tenth percentile. */
  readonly floor: number;
  /** Fiftieth percentile, and the number a point projection already gives you. */
  readonly median: number;
  /** Ninetieth percentile. */
  readonly ceiling: number;
}

/** Fewer weeks than this and a spread is two numbers arguing, not a measurement. */
export const MIN_WEEKS_FOR_DISPERSION = 4;

function assertOrdered({ floor, median, ceiling }: ProjectionDistribution): void {
  if (!(floor <= median && median <= ceiling)) {
    throw new Error(`A distribution runs floor to ceiling; got ${floor}, ${median}, ${ceiling}.`);
  }
}

/**
 * The spread implied by a stated floor and ceiling, on the normal assumption the rest of this
 * layer already makes. Read off the ninety-to-ten span rather than either half alone, so a
 * skewed pair does not report two different spreads depending on which end you ask.
 */
export function standardDeviationOf(distribution: ProjectionDistribution): number {
  assertOrdered(distribution);
  return (distribution.ceiling - distribution.floor) / (2 * Z_NINETIETH);
}

/** The inverse: a symmetric distribution around a mean the caller already has. */
export function outlookAround(median: number, standardDeviation: number): ProjectionDistribution {
  if (!(standardDeviation >= 0) || !Number.isFinite(standardDeviation)) {
    throw new Error(`An outlook needs a finite, non-negative spread; got ${standardDeviation}.`);
  }
  return {
    floor: median - Z_NINETIETH * standardDeviation,
    median,
    ceiling: median + Z_NINETIETH * standardDeviation,
  };
}

/**
 * How much a player's WEEKLY SCORES have varied. Outcomes only, never projections.
 *
 * The sample standard deviation, with the Bessel correction, because these are the weeks he
 * happened to play rather than every week he could have. `null` below `MIN_WEEKS_FOR_DISPERSION`,
 * and callers must read that as "unknown" rather than "steady": a rookie with two games is the
 * least predictable player on the board, and reporting his spread as zero would rank him as the
 * safest.
 */
export function realizedDispersion(weeklyPoints: readonly number[]): number | null {
  if (weeklyPoints.length < MIN_WEEKS_FOR_DISPERSION) return null;
  for (const points of weeklyPoints) {
    if (!Number.isFinite(points)) {
      throw new Error("A realized dispersion was handed a non-finite weekly score.");
    }
  }
  const mean = weeklyPoints.reduce((sum, points) => sum + points, 0) / weeklyPoints.length;
  const squares = weeklyPoints.reduce((sum, points) => sum + (points - mean) ** 2, 0);
  return Math.sqrt(squares / (weeklyPoints.length - 1));
}
