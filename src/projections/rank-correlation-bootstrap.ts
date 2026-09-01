import { mulberry32 } from "./laws/harness";
import { spearman, type Observation } from "./metrics";

/**
 * A BOOTSTRAP 95% INTERVAL ON THE DIFFERENCE BETWEEN TWO RANK CORRELATIONS OF THE SAME PLAYERS —
 * Task 11's own mechanical reading of "beyond noise" (ledger Ruling P3): the starter-band clause of
 * the plan's bar ("never lose a starter band beyond noise") is satisfied only when a band where the
 * blend's rank correlation trails a benchmark's own is NOT one where this interval excludes zero in
 * the benchmark's favour. A point estimate alone cannot say that; a small band (a starter band can
 * run to a few dozen players) makes two rank correlations that "look" different indistinguishable
 * from resampling noise more often than a reader expects.
 *
 * THE DESIGN MIRRORS `laws/harness.ts`'s OWN BOOTSTRAP, on purpose — same seeded PRNG
 * (`mulberry32`), same percentile-CI construction, same reason for both: a verdict this document
 * prints must not depend on when the script happened to run. It resamples PLAYERS (with
 * replacement), not points, because a rank correlation's unit of observation is the player — his
 * predicted-vs-actual pair under EACH arm, kept together across the resample so the paired
 * comparison stays valid (`primary` and `baseline` are resampled at the SAME drawn index every
 * time, never independently).
 */

/** One player, scored by both arms being compared against the same outcome. */
export interface RankCorrelationDifferenceRow {
  /** The arm under test — the blend, in every comparison this document reports. */
  readonly primary: number;
  /** The arm it is measured against — ADP, ECR, naive, the raw model, or the law-ablated blend. */
  readonly baseline: number;
  readonly actual: number;
}

export interface BootstrapDifferenceOptions {
  readonly seed: number;
  /** Matches `laws/harness.ts`'s own `BOOTSTRAP.resamples` default. */
  readonly resamples?: number;
}

export interface BootstrapDifferenceResult {
  /** `null` exactly when `spearman` itself would be — too few rows, or no variance on one side. */
  readonly primaryRho: number | null;
  readonly baselineRho: number | null;
  /** `primaryRho - baselineRho` on the FULL sample, never a mean of resampled differences. */
  readonly difference: number | null;
  /** The resample distribution's 2.5th/97.5th percentile of `primaryRho - baselineRho`. `null` when
   *  `difference` itself is `null`, or every resample came back degenerate (see `resamplesUsed`). */
  readonly ci: readonly [number, number] | null;
  /** `true` when the interval excludes zero — the difference is real at 95%, not noise. `null` when
   *  `ci` is `null`. Ruling P3's own "beyond noise" test: FALSE (or `null`) means a reader must not
   *  claim the band is lost or won on this comparison. */
  readonly beyondNoise: boolean | null;
  /** How many of the requested resamples produced a scoreable pair on both arms — a resample where
   *  either side has zero variance (every drawn player tied) is skipped, not coerced into a fake
   *  zero, following `metrics.ts`'s own `spearman` discipline. */
  readonly resamplesUsed: number;
}

const DEFAULT_RESAMPLES = 1000;

/** Linear-interpolated percentile of an ascending-sorted sample — identical construction to
 *  `laws/harness.ts`'s own private `percentile`, duplicated rather than imported because that one is
 *  module-private there and this bootstrap's population (a difference of two correlations, not a
 *  matched-pair effect) is a distinct enough statistic to not share a name with it. */
function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 1) return sorted[0]!;
  const index = p * (sorted.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower]!;
  const weight = index - lower;
  return sorted[lower]! * (1 - weight) + sorted[upper]! * weight;
}

function rhoOf(rows: readonly RankCorrelationDifferenceRow[], side: "primary" | "baseline"): number | null {
  return spearman(rows.map((row): Observation => ({ predicted: row[side], actual: row.actual })));
}

/**
 * `rows.length` resamples of `rows`, drawn with replacement from a `mulberry32` stream seeded by
 * `options.seed`, each contributing `primaryRho - baselineRho` on that draw to the resample
 * distribution the interval is read off. Determinism is total: the same rows, in the same order,
 * with the same seed, produce byte-identical output every time — a re-run of this document's own
 * generating script must reproduce every number in it.
 */
export function bootstrapRankCorrelationDifference(
  rows: readonly RankCorrelationDifferenceRow[],
  { seed, resamples = DEFAULT_RESAMPLES }: BootstrapDifferenceOptions,
): BootstrapDifferenceResult {
  const primaryRho = rhoOf(rows, "primary");
  const baselineRho = rhoOf(rows, "baseline");
  if (primaryRho === null || baselineRho === null) {
    return { primaryRho, baselineRho, difference: null, ci: null, beyondNoise: null, resamplesUsed: 0 };
  }
  const difference = primaryRho - baselineRho;

  const random = mulberry32(seed);
  const draws: number[] = [];
  for (let resample = 0; resample < resamples; resample += 1) {
    const primaryObs: Observation[] = [];
    const baselineObs: Observation[] = [];
    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[Math.floor(random() * rows.length)]!;
      primaryObs.push({ predicted: row.primary, actual: row.actual });
      baselineObs.push({ predicted: row.baseline, actual: row.actual });
    }
    const primarySample = spearman(primaryObs);
    const baselineSample = spearman(baselineObs);
    if (primarySample === null || baselineSample === null) continue;
    draws.push(primarySample - baselineSample);
  }

  if (draws.length === 0) {
    return { primaryRho, baselineRho, difference, ci: null, beyondNoise: null, resamplesUsed: 0 };
  }

  const sorted = [...draws].sort((a, b) => a - b);
  const ci: readonly [number, number] = [percentile(sorted, 0.025), percentile(sorted, 0.975)];
  const beyondNoise = ci[0] > 0 || ci[1] < 0;
  return { primaryRho, baselineRho, difference, ci, beyondNoise, resamplesUsed: draws.length };
}
