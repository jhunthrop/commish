import { UI_CONFIG } from "./config";
import type { StatComparison } from "./stat";

/**
 * THE ARITHMETIC BEHIND A TINT, and the refusal that keeps it honest.
 *
 * This is `src/league-room/lib/population.ts`'s generic half, lifted to the primitive layer on
 * 2026-08-28 when `Table` learned to judge a column (`table.tsx`'s JUDGED COLUMNS docblock). The
 * league room built the first two comparison sets in the product, so the ranking maths was
 * reasonably born there; the moment a `Table` in the DRAFT room needed the same maths, keeping it
 * in `src/league-room` would have meant either a second copy or a UI primitive importing a room —
 * and `src/components/**` importing `src/league-room/**` is backwards in this codebase's layering
 * whether or not a lint rule happens to catch it that day.
 *
 * The league room's own module still owns the parts that are genuinely ITS: the position
 * population sentences, the week's starter pool, and the standings' two named sets. It re-exports
 * these two functions so its callers and its tests do not care where the arithmetic moved to.
 */

/** Which end of the ramp the biggest number belongs on. Points for is `higher-is-better`; points
 *  against is the standings' one column where the biggest number is the worst one. */
export type HeatDirection = "higher-is-better" | "lower-is-better";

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

/**
 * A stated comparison, or `undefined` when there is nothing honest to state.
 *
 * `undefined` in three cases, and every one of them is a refusal rather than a fallback:
 * the value is not a real number, the population is smaller than
 * `UI_CONFIG.stat.minPopulation`, or the population is empty. A percentile across three
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
  if (values.length < UI_CONFIG.stat.minPopulation) return undefined;
  const rank = percentileWithin(values, value);
  return { percentile: direction === "lower-is-better" ? 1 - rank : rank, population };
}
