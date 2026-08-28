/**
 * THE ONE ESTIMATOR THE PLAYER-LEVEL FEATURES SHARE — a log-link elasticity fitted by the Poisson
 * score, which is the only technique in this engine that survives an outcome of zero.
 *
 * Every elasticity Phase 3 fitted is a weighted least-squares slope in log space, and that technique
 * cannot be used for anything a player produces in a single week. A back's touchdowns are zero far
 * more often than not; a receiver's catches are zero whenever he was covered all afternoon; `log 0`
 * is not a number. The usual dodges each destroy the thing being measured, and one of them is
 * actively dishonest: dropping the zero rows fits on the subset of weeks selected BY the outcome.
 *
 * The model is a multiplicative one, which is what the whole context layer already is:
 *
 *   E[outcome] = exposure x ratio^e
 *
 * `exposure` is what the model ALREADY predicts for that player-week and `ratio` is the feature. So
 * the fitted elasticity is by construction a fit against the RESIDUAL — the only question worth
 * asking of a new feature is what it adds to what is already known, and putting the current
 * prediction in the exposure makes that the question the arithmetic answers.
 *
 * WHY THE POISSON SCORE FOR A CONTINUOUS OUTCOME TOO. Receiving yards are not counts, and this is
 * used for them anyway. That is Poisson pseudo-maximum likelihood, and it is consistent for the
 * parameters of ANY non-negative outcome whose MEAN follows the log link, whatever its actual
 * distribution — the standard result behind its use for trade flows and insurance claims. It is not
 * a claim that yards are Poisson; it is a claim about the mean, which is the only thing a multiplier
 * on a rate is about.
 */

/** One player-week: what happened, what was already predicted, and the log of the feature's ratio. */
export interface LogLinkPoint {
  /** The outcome. Legitimately zero, which is the whole reason this file exists. */
  readonly outcome: number;
  /** What the model predicts without the feature. Must be positive to say anything. */
  readonly exposure: number;
  readonly logRatio: number;
}

/**
 * The bracket the elasticity is searched in, rather than a starting guess.
 *
 * Nothing meaningful sits outside it: an elasticity of 5 says a feature 20% above average trebles
 * the outcome, which no rate in football does. A solution pinned to an end of the bracket is
 * reported as zero rather than as the end, because "the data wants something impossible" is a
 * failure to measure and not a measurement.
 */
const BRACKET = { min: -5, max: 5 } as const;

/** 1e-17 of precision on a bracket of ten, well past where the data means anything. */
const BISECTION_STEPS = 60;

/**
 * The elasticity where the Poisson score is zero, by bisection.
 *
 * The score is `sum(logRatio x (outcome - exposure x ratio^e))` and is strictly decreasing in `e`,
 * because its own derivative is a sum of negative terms. So it crosses zero exactly once and the
 * signs at the bracket's two ends are all a bisection needs — no initial guess, no convergence
 * criterion, and no dependency whose conventions nobody here knows.
 */
export function fitLogLinkElasticity(points: readonly LogLinkPoint[]): number {
  const score = (e: number): number => {
    let value = 0;
    for (const point of points) {
      value += point.logRatio * (point.outcome - point.exposure * Math.exp(e * point.logRatio));
    }
    return value;
  };
  const atLow = score(BRACKET.min);
  const atHigh = score(BRACKET.max);
  if (!Number.isFinite(atLow) || !Number.isFinite(atHigh) || atLow <= 0 || atHigh >= 0) return 0;
  let low: number = BRACKET.min;
  let high: number = BRACKET.max;
  for (let step = 0; step < BISECTION_STEPS; step += 1) {
    const middle = (low + high) / 2;
    if (score(middle) > 0) low = middle;
    else high = middle;
  }
  return (low + high) / 2;
}

/**
 * The log-likelihood at an elasticity, without the constant term.
 *
 * The dropped term depends only on the outcomes, so it is identical across every candidate window
 * and prior a sweep compares — which is the only thing this number is ever used for. Comparing it to
 * a likelihood computed anywhere else would be meaningless, and it is never used that way.
 */
export function logLinkLikelihood(points: readonly LogLinkPoint[], elasticity: number): number {
  let total = 0;
  for (const point of points) {
    const mean = point.exposure * Math.exp(elasticity * point.logRatio);
    if (!(mean > 0)) continue;
    total += point.outcome * Math.log(mean) - mean;
  }
  return total;
}

/**
 * WHY NEITHER FEATURE SWEEPS ITS SHRINKAGE PRIOR, recorded here because both of them tried to.
 *
 * A ratio shrunk toward a league mean by `k` opportunities and then raised to an elasticity `e` is
 * very nearly unidentified in the pair `(k, e)`: for a large prior the log of the ratio scales as one
 * over the prior, so doubling `k` and doubling `e` leaves every multiplier almost exactly where it
 * was. The likelihood along that ridge is flat, and an unqualified argmax over a ladder of priors
 * therefore wanders to whichever end somebody typed last — publishing "2,560 targets of prior,
 * elasticity 2.86" for a model indistinguishable from "320 and 0.37".
 *
 * The identified quantity is the ratio `e/k`, so the prior is a choice of UNITS rather than a
 * parameter, and each feature fixes it at a number a reader can interpret — roughly a season of
 * opportunities — and fits only the elasticity against it. Sweeping both would report a spurious
 * precision about which of the two was doing the work.
 */
