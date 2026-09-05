/**
 * THE WILSON SCORE INTERVAL — a real 95% confidence interval over a build's own top-3 finish
 * rate, shown only at 100 runs (spec §5: "confidence intervals shown at 100 runs, suppressed at
 * 10k") because a rate measured over a few dozen runs is exactly the case where the honest range
 * matters more than the point estimate; at 10,000 runs the interval is already a fraction of a
 * point wide and would only add noise to the row.
 *
 * Wilson, not the plain normal-approximation interval, because the normal approximation can
 * report a lower bound below 0 or an upper bound above 1 for a rate near either extreme — exactly
 * the range a build with a genuinely rare or genuinely common outcome sits in.
 */
const Z_95 = 1.959963984540054;

export interface ConfidenceInterval {
  readonly low: number;
  readonly high: number;
}

export function wilsonInterval(successes: number, n: number, z: number = Z_95): ConfidenceInterval {
  if (n <= 0) return { low: 0, high: 0 };
  const phat = successes / n;
  const denominator = 1 + (z * z) / n;
  const center = phat + (z * z) / (2 * n);
  const margin = z * Math.sqrt((phat * (1 - phat)) / n + (z * z) / (4 * n * n));
  return { low: Math.max(0, (center - margin) / denominator), high: Math.min(1, (center + margin) / denominator) };
}

/** Spec §5's own rule, named once: the interval renders at 100 runs and suppresses at 10,000. */
export function showsConfidenceInterval(runs: number): boolean {
  return runs <= 100;
}
