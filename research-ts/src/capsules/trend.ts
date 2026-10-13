/**
 * YEAR-OVER-YEAR TREND METRICS, PURE (color v2, Task 2) — one year-over-year delta, its own
 * materiality read, and the population spread the materiality bar is measured against.
 * `collect.ts`'s own `yearOverYearTrendsFor` (folded into `usageTouchesAndTrendFactsFor`) is the
 * only caller: it gathers each quantity's own two-season population, per position, and this module
 * turns a (recent, prior) value pair plus that population into an honest `TrendMetric`.
 *
 * THE MATERIALITY THRESHOLD, DOCUMENTED (never eyeballed): a delta is material when its own
 * magnitude clears `TREND_MATERIALITY_STDDEV_FRACTION` of the quantity's own population standard
 * deviation, at that position, pooled across BOTH of the two seasons the trend measures (a player
 * contributes one data point per season he has a real reading in, so up to two). Half a standard
 * deviation is the smallest shift most working analyses treat as more than seasonal noise — the
 * same boundary Cohen's own "small effect" convention draws — so this is a fixed, named fraction
 * of a real, measured spread rather than a number tuned to make any one player's trend look good.
 * A population with no measurable spread (fewer than two readings, or every reading identical)
 * gates every delta closed rather than open: with nothing to compare the movement against, calling
 * it material would be a guess dressed as a threshold.
 */
export const TREND_MATERIALITY_STDDEV_FRACTION = 0.5;

export interface TrendMetric {
  readonly priorSeason: number;
  readonly priorValue: number;
  readonly recentSeason: number;
  readonly recentValue: number;
  readonly delta: number;
  /** Whether `|delta|` clears `TREND_MATERIALITY_STDDEV_FRACTION` of the pooled population's own
   *  standard deviation — see this module's own docblock. Only a material trend is ever serialized
   *  as its own sentence (`render.ts`); an immaterial one still carries its own real numbers
   *  (never fabricated), simply not narrated as a trend. */
  readonly material: boolean;
}

/** Population standard deviation (denominator N, never the N-1 sample correction): `values` is
 *  the WHOLE pooled population actually on file for one quantity at one position across the two
 *  seasons in question, never a sample standing in for a wider population, so there is nothing
 *  for the textbook correction to estimate. */
export function populationStdDev(values: readonly number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

/** One quantity's year-over-year read for one player. `null` whenever EITHER season's own value
 *  is `null` — "absent seasons = absent fact" (color v2, Task 2's own rule): a trend needs both
 *  ends of the comparison, and half a comparison is not an honest fact to state. */
export function buildTrendMetric(priorSeason: number, priorValue: number | null, recentSeason: number, recentValue: number | null, pooledPopulation: readonly number[]): TrendMetric | null {
  if (priorValue === null || recentValue === null) return null;
  const delta = recentValue - priorValue;
  const stdDev = populationStdDev(pooledPopulation);
  const material = stdDev > 0 && Math.abs(delta) >= TREND_MATERIALITY_STDDEV_FRACTION * stdDev;
  return { priorSeason, priorValue, recentSeason, recentValue, delta, material };
}
