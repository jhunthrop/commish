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

import { BOOTSTRAP } from "./config";
import type { LawMeasurement, LawVerdict, PlayerSeasonPoint } from "./types";

/** One condition player-season paired with its matched control. */
export interface MatchedPair {
  readonly condition: PlayerSeasonPoint;
  readonly control: PlayerSeasonPoint;
}

/**
 * mulberry32 — a small, fast, seedable PRNG. Chosen over `Math.random` for the one property that
 * matters here: given the same seed, it produces the same sequence forever, on every machine. That
 * determinism is the whole point of pinning `BOOTSTRAP.seed` in config.
 *
 * Exported (fix round, 2026-08-31) so test fixtures needing a seeded RNG — `discovery/measure.test.ts`'s
 * null battery in particular — use the SAME 32-bit-integer PRNG production does, not a hand-rolled
 * `a*x+c mod m` LCG whose naive floating-point multiplication silently loses precision once `x`
 * approaches 2^31 (`1103515245 * x` exceeds `Number.MAX_SAFE_INTEGER` well before `x` does), which is
 * exactly the "fixture LCG overflow" a review of this file's own test suite caught.
 */
export function mulberry32(seed: number): () => number {
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
 * caliper — inclusive: a control at exactly `caliper` away is an admissible match. A condition row
 * with no control inside the caliper is dropped, which is exactly the "reduced sample" the brief
 * calls out — matching failure is not an error, it's information.
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

/**
 * `matchedPairs`, run separately WITHIN each stratum `keyOf` names, never across strata.
 *
 * A caliper on `matchKey` alone cannot stop a within-caliper pair from crossing a boundary that
 * matters more than points/game does: a 2011 RB and a 2024 WR can sit inside a 2-point caliper of
 * each other while sharing nothing else — different era, different position, different baseline
 * distribution entirely. Every law matches within `season` (cross-era pairing is never legitimate);
 * a law whose population spans more than one position (`Law["position"] === "all"`, or a WR+TE
 * population like `play_caller_fingerprint`) additionally stratifies by `position`, since a WR's
 * and a TE's points/game distributions do not overlap enough for a shared caliper to mean the same
 * thing for both. `keyOf` is the caller's choice of which strata matter for a given law.
 */
export function matchedPairsStratified(
  points: readonly PlayerSeasonPoint[],
  caliper: number,
  keyOf: (point: PlayerSeasonPoint) => string,
): readonly MatchedPair[] {
  const byStratum = new Map<string, PlayerSeasonPoint[]>();
  for (const point of points) {
    const key = keyOf(point);
    const stratum = byStratum.get(key) ?? [];
    stratum.push(point);
    byStratum.set(key, stratum);
  }
  return [...byStratum.values()].flatMap((stratum) => matchedPairs(stratum, caliper));
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

function standardDeviation(values: readonly number[]): number {
  const m = mean(values);
  const variance = values.reduce((sum, value) => sum + (value - m) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

/** The bootstrap effect, its standard error, and its 95% CI, computed from the SAME resample draws —
 *  `measureEffect` and Task 7's discovery pipeline (`discovery/measure.ts`, which needs `se` for its
 *  normal-approximation p-value; see that module's own docblock for why) both build on this rather
 *  than each running its own bootstrap loop, so a law's CI and a discovered candidate's p-value are
 *  never computed from two different resample sequences. */
export interface BootstrapStatistics {
  readonly effect: number;
  readonly se: number;
  readonly ci: readonly [number, number];
}

/**
 * Resamples PAIRS with replacement — never individual points, which would break the
 * condition/control coupling the matching just built. `BOOTSTRAP.resamples` draws, each of
 * `pairs.length` pairs, mean difference per draw; `se` is that resample distribution's own standard
 * deviation, `ci` its 2.5th/97.5th percentile. An empty `pairs` list THROWS rather than returning a
 * sentinel: a measurement with zero matched pairs is not "debunked", it is no measurement at all, and
 * any zero-shaped value returned here would flow into `verdictFor` and come out reading "tested and
 * failed". A law whose population matched nothing is a population-builder bug (condition too strict,
 * wrong `matchKey`, caliper too tight), and the one honest response is to fail loudly at the source so
 * the registry can never stamp a verdict on evidence that does not exist.
 */
export function bootstrapStatistics(pairs: readonly MatchedPair[]): BootstrapStatistics {
  if (pairs.length === 0) {
    throw new Error(
      "bootstrapStatistics: no matched pairs — an empty matched population is a population-builder bug, never a verdict",
    );
  }

  const differences = pairs.map(pairDifference);
  const effect = mean(differences);

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
  const se = standardDeviation(resampleMeans);
  const sorted = [...resampleMeans].sort((a, b) => a - b);
  const ci: readonly [number, number] = [percentile(sorted, 0.025), percentile(sorted, 0.975)];

  return { effect, se, ci };
}

/**
 * The measured effect of a matched population: mean paired difference-in-differences, with a
 * seeded-bootstrap 95% CI — `bootstrapStatistics`'s `effect`/`ci`, repackaged into `LawMeasurement`'s
 * shape (dropping `se`, which only `discovery/measure.ts`'s p-value computation needs). Throws
 * exactly when `bootstrapStatistics` does, for the identical reason (see that function's docblock).
 *
 * `seasons` is returned EMPTY on purpose: this harness has no opinion on which seasons `pairs` was
 * matched over, and it used to guess anyway with a `MEASURE_SEASONS`/`HELD_OUT_SEASONS`-derived
 * label — a guess that went silently stale the moment a caller measured over anything narrower than
 * the whole config (which `scripts/measure-laws.ts` now does, for the held-out subset). The
 * production label — window, any gap seasons, which years direction was replicated on — is
 * `measure-laws.ts`'s own `seasonsLabel()`, the ONE place that knows what was actually measured;
 * every caller is expected to overwrite this field the same way.
 */
export function measureEffect(pairs: readonly MatchedPair[]): LawMeasurement {
  const { effect, ci } = bootstrapStatistics(pairs);
  return { effect, ci, sample: pairs.length, seasons: "" };
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
