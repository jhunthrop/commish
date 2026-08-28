/**
 * The two bits of normal-distribution arithmetic the decision layer needs, in one place.
 *
 * Both survival probability and start/sit reduce to the same question — how much of a bell curve
 * lies on one side of a line — and writing that twice would let the two answers drift. There is
 * no dependency to reach for: nothing in this repo ships a statistics library, and a decision
 * surface must be reproducible run to run, which rules out anything sampled.
 */

/** The z-score of the 90th percentile. The quantile a `ProjectionDistribution` states as its ceiling. */
export const Z_NINETIETH = 1.2815515655446004;

/**
 * Abramowitz and Stegun 26.2.17, accurate to about 7.5e-8 across the whole line.
 *
 * That is four orders of magnitude finer than any decision made from it: a survival probability
 * of 0.42 against 0.43 changes nothing a manager does. The approximation is used rather than an
 * exact series because it is short enough for a reviewer to check against the published
 * coefficients, which a Chebyshev expansion is not.
 */
export function normalCdf(z: number): number {
  if (!Number.isFinite(z)) {
    throw new Error(`normalCdf needs a finite z-score; got ${z}.`);
  }
  const sign = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const poly =
    t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  const erf = 1 - poly * Math.exp(-x * x);
  return 0.5 * (1 + sign * erf);
}

/**
 * The chance a total drawn as `mean +/- standardDeviation` clears `target`.
 *
 * The whole of start/sit is this function read twice. When you are ahead, `mean - target` is
 * positive and a SMALLER spread raises the answer; when you are behind it is negative and a
 * LARGER spread raises it. Floor when favoured and ceiling when trailing is not a rule anybody
 * wrote down here, it is what this expression does.
 */
export function chanceOfClearing(mean: number, standardDeviation: number, target: number): number {
  if (standardDeviation <= 0) {
    throw new Error(`A chance of clearing needs a positive spread; got ${standardDeviation}.`);
  }
  return normalCdf((mean - target) / standardDeviation);
}
