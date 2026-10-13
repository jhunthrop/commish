/**
 * THE SCORING HARNESS'S OWN ARITHMETIC — built before any model exists, on purpose.
 *
 * The engine design's first principle (`docs/research/…projection-engine`, and the artifact of
 * 2026-08-27) is that you can only learn what you measure: a projection you cannot score is a
 * projection you cannot improve, and every later question — which feature earns its place, whether
 * the news pass adds anything, whether we beat the market — is answered by these functions or not
 * at all. So they land first, pure and tested, with no data pipeline attached.
 *
 * Everything here is deliberately free of I/O, dates and league state. A metric that needs a
 * database cannot be run inside an ablation loop a thousand times.
 */

/** One prediction against what actually happened. */
export interface Observation {
  /** What the projection said. */
  readonly predicted: number;
  /** What the player actually did. */
  readonly actual: number;
}

/**
 * Average ranks, ties shared — the standard correction, and not optional here.
 *
 * Fantasy projections tie constantly: every player projected for zero (inactive, deep bench, a
 * defence we do not model) carries the identical number. Ranking those by array order would invent
 * an ordering the projection never claimed and then score us on it, which flatters or punishes at
 * random depending on how the rows happened to be sorted.
 */
function averageRanks(values: readonly number[]): readonly number[] {
  const order = values.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value);
  const ranks = new Array<number>(values.length);
  let position = 0;
  while (position < order.length) {
    let end = position;
    while (end + 1 < order.length && order[end + 1]!.value === order[position]!.value) end += 1;
    // Ranks are 1-based; a tied run from `position` to `end` shares their average.
    const shared = (position + end) / 2 + 1;
    for (let i = position; i <= end; i += 1) ranks[order[i]!.index] = shared;
    position = end + 1;
  }
  return ranks;
}

function pearson(xs: readonly number[], ys: readonly number[]): number | null {
  const n = xs.length;
  const meanX = xs.reduce((sum, x) => sum + x, 0) / n;
  const meanY = ys.reduce((sum, y) => sum + y, 0) / n;
  let covariance = 0;
  let varianceX = 0;
  let varianceY = 0;
  for (let i = 0; i < n; i += 1) {
    const dx = xs[i]! - meanX;
    const dy = ys[i]! - meanY;
    covariance += dx * dy;
    varianceX += dx * dx;
    varianceY += dy * dy;
  }
  // Zero variance on either side means the correlation is undefined, not zero — every prediction
  // identical (a constant model) or every outcome identical (a week nobody scored). Saying "0"
  // there would read as "no skill" when the honest answer is "this sample cannot tell you".
  if (varianceX === 0 || varianceY === 0) return null;
  return covariance / Math.sqrt(varianceX * varianceY);
}

function assertFinite(observations: readonly Observation[]): void {
  for (const { predicted, actual } of observations) {
    if (!Number.isFinite(predicted) || !Number.isFinite(actual)) {
      throw new Error("A projection metric received a non-finite value; check the projection source for NaN or Infinity.");
    }
  }
}

/**
 * THE PRIMARY METRIC. Fantasy is an ordering problem, not an estimation one: a projection that is
 * wrong about everybody by the same twelve points costs a manager nothing, because the draft board
 * and the lineup are both decided by who is ABOVE whom. Mean error would score that projection
 * badly and a subtly mis-ordered one well, which is exactly backwards.
 *
 * `null` when the sample cannot support an answer — fewer than two observations, or no variance on
 * either side. Callers must treat that as "unknown", never as zero.
 */
export function spearman(observations: readonly Observation[]): number | null {
  assertFinite(observations);
  if (observations.length < 2) return null;
  return pearson(
    averageRanks(observations.map((o) => o.predicted)),
    averageRanks(observations.map((o) => o.actual)),
  );
}

/** Mean absolute error, in whatever unit the observations carry (points, targets, carries). */
export function meanAbsoluteError(observations: readonly Observation[]): number | null {
  assertFinite(observations);
  if (observations.length === 0) return null;
  const total = observations.reduce((sum, o) => sum + Math.abs(o.predicted - o.actual), 0);
  return total / observations.length;
}

/**
 * Root mean squared error — reported ALONGSIDE mean absolute error rather than instead of it,
 * because the gap between them is itself the signal. RMSE punishes large misses quadratically, so
 * an RMSE far above the MAE means the damage is concentrated in a few blowups (a missed injury, a
 * three-touchdown game) rather than spread thinly. Those two failures want completely different
 * fixes, and a single error number cannot tell them apart.
 */
export function rootMeanSquaredError(observations: readonly Observation[]): number | null {
  assertFinite(observations);
  if (observations.length === 0) return null;
  const total = observations.reduce((sum, o) => sum + (o.predicted - o.actual) ** 2, 0);
  return Math.sqrt(total / observations.length);
}

/**
 * The rank bands the harness segments by. The engine design expects the first real win in the deep
 * pool: everybody ranks the top fifty correctly, human analyst attention runs out somewhere past a
 * hundred, and that is where leagues are actually decided — on waiver adds, late picks and bye
 * fills. A single headline number averages that win away, so it is never reported alone.
 */
export const RANK_BANDS = [
  { name: "elite", from: 1, to: 50 },
  { name: "starter", from: 51, to: 150 },
  { name: "deep", from: 151, to: 400 },
  { name: "fringe", from: 401, to: Number.MAX_SAFE_INTEGER },
] as const;

export type RankBandName = (typeof RANK_BANDS)[number]["name"];

/** Which band a rank falls in. Ranks are 1-based, as every fantasy surface renders them. */
export function rankBandFor(rank: number): RankBandName {
  if (!Number.isInteger(rank) || rank < 1) {
    throw new Error(`A rank band was asked for rank ${rank}; ranks are 1-based integers.`);
  }
  return RANK_BANDS.find((band) => rank >= band.from && rank <= band.to)!.name;
}

export interface ScoreCard {
  /** The ordering metric — the one that decides whether a change shipped. */
  readonly rankCorrelation: number | null;
  readonly meanAbsoluteError: number | null;
  readonly rootMeanSquaredError: number | null;
  readonly sampleSize: number;
}

/** One projection source's whole story against one set of actuals. */
export function scoreCard(observations: readonly Observation[]): ScoreCard {
  return {
    rankCorrelation: spearman(observations),
    meanAbsoluteError: meanAbsoluteError(observations),
    rootMeanSquaredError: rootMeanSquaredError(observations),
    sampleSize: observations.length,
  };
}
