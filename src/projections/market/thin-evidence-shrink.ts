/**
 * THIN-EVIDENCE SHRINKAGE TOWARD THE MARKET (calibration fix round, 2026-09-04, Task 3).
 *
 * THE PHILOSOPHY, FIXED BY THE FOUNDER'S OWN REVIEW: shrinkage proportional to the THINNESS OF OUR
 * OWN EVIDENCE, never a market override. This is NOT "the market is right and the model is wrong" —
 * it is "the less real data our own number is built on, the less we should trust it over the
 * market's own aggregated opinion." A projection built on a healthy amount of evidence should move
 * off the market by however much real signal (a confirmed law, a measured availability gap) argues
 * for; a projection built on almost no evidence at all should mostly just DEFER, because there is
 * nothing behind our own number strong enough to argue with a market that priced hundreds of real
 * bettors' and drafters' opinions.
 *
 * THE DEFECT THIS REPLACES. Player A (a rookie running back drafted third overall) carried a
 * `market_anchor` reason recording a +79.7 point disagreement with the market and NOTHING shrank it
 * — the board's rookie branch (`market/blend.ts`'s `blendCandidate`) substituted the model's own
 * number for the market's UNCONDITIONALLY, regardless of how much (or how little) real evidence
 * backed that model number. A rookie curve knot built from one or two historical comparables (see
 * `rookie-curve.ts`'s own module docblock on the draft-capital curve's thin top-of-round-one cells)
 * is not evidence strong enough to stand unmoved against a market that has priced the player too.
 *
 * THE WEIGHT FORMULA: `weight(n) = n0 / (n0 + n)`, the same shrinkage-toward-a-prior shape already
 * used throughout this engine (`availability.ts`'s `shrunkAvailabilityRate`, `fit.ts`'s
 * `blendShares`) — a Bayesian-style shrinkage where `n0` is "how many effective observations of our
 * own evidence would it take to trust our own number as much as the market's." `weight` is 1 at
 * n=0 (no evidence at all: defer to market completely — but see `shrinkTowardMarket`'s own note on
 * why a player with NO market listing never reaches this function to begin with), falls toward 0 as
 * n grows, and is strictly decreasing and bounded to (0, 1] for any finite n >= 0.
 *
 * `n0` ITSELF (`THIN_EVIDENCE_PRIOR_N`, below) is chosen by the calibration backtest
 * (`scripts/rookie-calibration-backtest.ts`), which grid-searches a small set of candidates against
 * 2025 rookie MAE (2023-2024 fit, 2025 score, 2026 never touched) and reports every candidate's
 * score in `docs/research/2026-09-04-rookie-calibration-backtest.md` — not eyeballed. See that
 * report for the grid and the sensitivity of the choice.
 */

/**
 * THE PRIOR-N CONSTANT — see the module docblock's own paragraph on how this is chosen. Documented
 * rather than silently hardcoded: `docs/research/2026-09-04-rookie-calibration-backtest.md` reports
 * the full grid this value was picked from and how sensitive the 2025 rookie score is to it.
 */
export const THIN_EVIDENCE_PRIOR_N = 3;

/**
 * ONE PLAYER'S SHRUNK POINTS TOTAL.
 *
 * `marketPoints === null` IS THE NULL CELL: a player the market has no opinion on has nothing to
 * shrink toward, and returns `modelPoints` UNCHANGED, bit for bit — "a player with no market listing
 * shrinks nowhere" is a hard requirement, not an approximation, so this is an early return rather
 * than a formula that happens to reduce to the identity at some limit.
 *
 * `effectiveN` is never negative in practice (every caller's own count is a real observation tally),
 * but this function does not assume it: `Math.max(0, effectiveN)` keeps the weight inside (0, 1]
 * even if a caller ever hands it something malformed, rather than letting a negative `n` invert the
 * shrink direction.
 */
export function shrinkTowardMarket(modelPoints: number, marketPoints: number | null, effectiveN: number, priorN: number = THIN_EVIDENCE_PRIOR_N): number {
  if (marketPoints === null) return modelPoints;
  if (!(priorN > 0) || !Number.isFinite(priorN)) {
    throw new Error(`shrinkTowardMarket: priorN must be a positive finite number of effective observations; got ${priorN}.`);
  }
  const weight = priorN / (priorN + Math.max(0, effectiveN));
  return modelPoints * (1 - weight) + marketPoints * weight;
}
