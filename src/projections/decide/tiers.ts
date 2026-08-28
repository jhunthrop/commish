/**
 * WHERE A POSITION FALLS OFF, measured rather than drawn.
 *
 * The engine spec's layer 6 says it plainly: "a cliff is where the gap exceeds the overlap, not
 * a hand-drawn line." We have no per-player overlap to compare against yet - nothing in the
 * model emits a distribution (see `outlook.ts`) - so the comparison set is the position's own
 * adjacent gaps. A cliff is a gap several times the typical gap between neighbours at that
 * position. That is a stated comparison against a real population, which is the bar the fun-pass
 * spec's magnitude rule sets for any judged number, and it is what a hand-placed tier line is
 * not.
 *
 * Tiers are consumed by the draft recommendation, where the useful question is never "which tier
 * is he in" but "how many men are left before the drop, and how big is the drop".
 */

/**
 * How many times the typical neighbour gap a gap must be before it counts as a cliff.
 *
 * Chosen, not fitted: below about two, ordinary lumpiness in any ranked list reads as a cliff and
 * every position ends up with eight tiers, which tells a manager nothing. There is no held-out
 * measurement that could fit this today, and quoting a fitted-looking number would be a claim we
 * cannot support.
 */
export const CLIFF_MULTIPLE = 2.5;

/**
 * Below this many players a "typical gap" is not a population, it is two numbers. Short pools get
 * one tier and no cliffs, which is the honest answer rather than a confident one.
 */
export const MIN_POOL_FOR_TIERS = 5;

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

/**
 * Tier index per player, 0-based, for one position's values sorted DESCENDING.
 *
 * The typical gap is the MEDIAN of the adjacent gaps rather than the mean, because the cliffs
 * themselves are in the sample: a mean is dragged upward by the very gaps it is meant to
 * identify, and on a pool with one huge break the mean rules that break ordinary.
 */
export function tiersOf(valuesDescending: readonly number[]): readonly number[] {
  if (valuesDescending.length < MIN_POOL_FOR_TIERS) return valuesDescending.map(() => 0);
  const gaps = valuesDescending.slice(1).map((value, index) => valuesDescending[index]! - value);
  const typical = median(gaps);
  // A PLATEAU WITH BREAKS IN IT. When most neighbours are identical the median gap is zero, and
  // "several times zero" would rule out every break including a hundred-point one. The honest
  // reading of a typical gap of nothing is that ANY gap separates tiers, so the threshold falls
  // to the smallest positive number. A pool that is identical the whole way down has no positive
  // gap at all and correctly stays one tier.
  const threshold = typical > 0 ? CLIFF_MULTIPLE * typical : Number.MIN_VALUE;
  let tier = 0;
  const tiers = [0];
  for (const gap of gaps) {
    if (gap >= threshold) tier += 1;
    tiers.push(tier);
  }
  return tiers;
}

export interface TierStanding {
  readonly tier: number;
  /** Including him: how many men at this position are left before the drop. */
  readonly playersLeftInTier: number;
  /** How far the position falls after this tier is gone. Zero when he is in the last tier. */
  readonly dropToNextTier: number;
}

/** Where one player stands in his position's tier structure, at the moment the board was taken. */
export function tierStanding(valuesDescending: readonly number[], index: number): TierStanding {
  const tiers = tiersOf(valuesDescending);
  const tier = tiers[index];
  if (tier === undefined) {
    throw new Error(`No player sits at index ${index} in a pool of ${valuesDescending.length}.`);
  }
  const lastOfTier = tiers.lastIndexOf(tier);
  const firstOfNext = tiers.indexOf(tier + 1);
  return {
    tier,
    playersLeftInTier: lastOfTier - index + 1,
    dropToNextTier: firstOfNext === -1 ? 0 : valuesDescending[lastOfTier]! - valuesDescending[firstOfNext]!,
  };
}
