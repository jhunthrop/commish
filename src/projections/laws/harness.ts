/**
 * THE LAW MEASUREMENT HARNESS — matched-baseline difference-in-differences, seeded and pure.
 *
 * Every football "law" competes with a null hypothesis nobody states out loud: regression to the
 * mean. A workhorse back's numbers falling off a cliff at 30 looks like aging until you notice ANY
 * player who scored that many points last season tends to score fewer next season, age or no age.
 * Comparing a condition group's raw before/after change would just be measuring regression, dressed
 * up as a law.
 *
 * The fix is a matched control: for every condition player-season, find an "otherwise similar"
 * player-season (same `matchKey`, usually points/game) that did NOT meet the law's condition, and
 * take the difference of their year-over-year changes. Shared regression cancels in that subtraction
 * because both sides regress by roughly the same amount; what survives is the effect attributable to
 * the condition itself. This is a paired, matched difference-in-differences design — not a
 * regression, not a raw before/after — and the bootstrap below resamples PAIRS, not individual
 * points, to keep that pairing intact under resampling.
 *
 * Bootstrap draws are seeded (mulberry32, from `BOOTSTRAP.seed`) rather than `Math.random`, so the
 * measurement — and therefore the verdict — is byte-identical across runs. A law's grade must not
 * depend on when you happened to run the harness.
 */

import { BOOTSTRAP, HELD_OUT_SEASONS, MEASURE_SEASONS } from "./config";
import type { LawMeasurement, LawVerdict, PlayerSeasonPoint } from "./types";

/** One condition player-season paired with its matched control. */
export interface MatchedPair {
  readonly condition: PlayerSeasonPoint;
  readonly control: PlayerSeasonPoint;
}

const SEASONS_LABEL = `${MEASURE_SEASONS.from}-${MEASURE_SEASONS.to}, held out ${HELD_OUT_SEASONS[0]}-${HELD_OUT_SEASONS[HELD_OUT_SEASONS.length - 1]}`;

/**
 * mulberry32 — a small, fast, seedable PRNG. Chosen over `Math.random` for the one property that
 * matters here: given the same seed, it produces the same sequence forever, on every machine. That
 * determinism is the whole point of pinning `BOOTSTRAP.seed` in config.
 */
function mulberry32(seed: number): () => number {
  let state = seed;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Greedy nearest-neighbor matching without replacement, within a caliper.
 *
 * Points where the player didn't return the following season (`nextPointsPerGame === null`) are
 * dropped from BOTH pools before matching — survivorship is a matched property here. The harness
 * measures decline among players who came back, not a mix of decline and attrition, and any law
 * built on this must say so in its claim copy.
 *
 * Condition rows are visited in descending `matchKey` order (arbitrary but fixed, so results don't
 * depend on input order) and each greedily claims the closest still-unused control within the
 * caliper. A condition row with no control inside the caliper is dropped, which is exactly the
 * "reduced sample" the brief calls out — matching failure is not an error, it's information.
 */
export function matchedPairs(
  points: readonly PlayerSeasonPoint[],
  caliper: number,
): readonly MatchedPair[] {
  const returners = points.filter((point) => point.nextPointsPerGame !== null);
  const conditionRows = returners
    .filter((point) => point.condition)
    .slice()
    .sort((a, b) => b.matchKey - a.matchKey);
  const controlPool = returners.filter((point) => !point.condition);
  const claimed = new Set<number>();

  const pairs: MatchedPair[] = [];
  for (const condition of conditionRows) {
    let bestIndex = -1;
    let bestDistance = Infinity;
    for (let i = 0; i < controlPool.length; i += 1) {
      if (claimed.has(i)) continue;
      const distance = Math.abs(controlPool[i]!.matchKey - condition.matchKey);
      if (distance <= caliper && distance < bestDistance) {
        bestDistance = distance;
        bestIndex = i;
      }
    }
    if (bestIndex !== -1) {
      claimed.add(bestIndex);
      pairs.push({ condition, control: controlPool[bestIndex]! });
    }
  }

  return pairs;
}

function yearOverYearChange(point: PlayerSeasonPoint): number {
  // Matching already guarantees `nextPointsPerGame` is non-null for every paired point.
  return point.nextPointsPerGame! - point.pointsPerGame;
}

function pairDifference(pair: MatchedPair): number {
  return yearOverYearChange(pair.condition) - yearOverYearChange(pair.control);
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** Linear-interpolated percentile of an ascending-sorted sample. */
function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 1) return sorted[0]!;
  const rank = p * (sorted.length - 1);
  const lower = Math.floor(rank);
  const upper = Math.ceil(rank);
  if (lower === upper) return sorted[lower]!;
  const weight = rank - lower;
  return sorted[lower]! * (1 - weight) + sorted[upper]! * weight;
}

/**
 * Bootstraps the 95% CI by resampling PAIRS with replacement — never individual points, which
 * would break the condition/control coupling the matching just built. `BOOTSTRAP.resamples` draws,
 * each of `pairs.length` pairs, mean difference per draw, then the 2.5th/97.5th percentile of the
 * resulting distribution.
 */
function bootstrapCi(pairs: readonly MatchedPair[], differences: readonly number[]): readonly [number, number] {
  const random = mulberry32(BOOTSTRAP.seed);
  const resampleMeans: number[] = [];
  for (let resample = 0; resample < BOOTSTRAP.resamples; resample += 1) {
    let total = 0;
    for (let i = 0; i < pairs.length; i += 1) {
      const index = Math.floor(random() * pairs.length);
      total += differences[index]!;
    }
    resampleMeans.push(total / pairs.length);
  }
  resampleMeans.sort((a, b) => a - b);
  return [percentile(resampleMeans, 0.025), percentile(resampleMeans, 0.975)];
}

/**
 * The measured effect of a matched population: mean paired difference-in-differences, with a
 * seeded-bootstrap 95% CI. An empty `pairs` list produces a zero-sample, zero-width measurement
 * rather than `NaN` — callers (verdicts, the registry) should treat `sample === 0` as "no evidence,"
 * not attempt to interpret the effect number.
 */
export function measureEffect(pairs: readonly MatchedPair[]): LawMeasurement {
  if (pairs.length === 0) {
    return { effect: 0, ci: [0, 0], sample: 0, seasons: SEASONS_LABEL };
  }

  const differences = pairs.map(pairDifference);
  const effect = mean(differences);
  const ci = bootstrapCi(pairs, differences);

  return { effect, ci, sample: pairs.length, seasons: SEASONS_LABEL };
}

/**
 * Confirmed requires BOTH a CI that excludes zero AND a sign matching what the law claimed —
 * either alone is not enough. A tight CI around the wrong sign is confidently wrong, not confirmed;
 * a correct-sign point estimate with a CI spanning zero is a hint, not evidence. That middle case is
 * "weak" — real enough to keep testing, not real enough to gate a model feature on.
 */
export function verdictFor(measurement: LawMeasurement, expectedSign: -1 | 1): LawVerdict {
  const [low, high] = measurement.ci;
  const ciExcludesZero = low > 0 === high > 0 && low !== 0 && high !== 0;
  const signMatches = Math.sign(measurement.effect) === expectedSign;

  if (ciExcludesZero && signMatches) return "confirmed";
  if (signMatches) return "weak";
  return "debunked";
}
