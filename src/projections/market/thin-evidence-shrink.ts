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
 * 2025 rookie MAE and reports every candidate's score in
 * `docs/research/2026-09-04-rookie-calibration-backtest.md` — not eyeballed.
 *
 * THIS ONE PARAMETER IS TUNED ON THE TEST SEASON, NAMED PLAINLY: unlike every other fitted table
 * this calibration round produced (fit on 2023-2024, scored on 2025 only), `THIN_EVIDENCE_PRIOR_N`
 * is selected directly against 2025 rookie MAE, which is tuned-on-test rather than a genuine
 * held-out evaluation. The committed value (3) is deliberately the conservative choice from that
 * grid rather than the score-maximising one — see the report's own "Decision" section. The
 * recommended follow-up, not yet run: fit on 2023, select this constant against 2024 as a real
 * validation season, and reserve 2025 as a never-touched-for-tuning test — see the report's own
 * "tuned on the test season" section for why that three-way split is next, not this round's own gate.
 */

/**
 * THE PRIOR-N CONSTANT — grid-searched against 2025 rookie MAE
 * (`scripts/rookie-calibration-backtest.ts`), over `[0.5, 1, 2, 3, 5, 8, 15, 30, 50, ...]`, broken
 * out per exact evidence count rather than trusted as one aggregate number.
 *
 * THE AGGREGATE GRID'S OWN ARG-MIN CLIMBS TOWARD PURE MARKET WITHOUT BOUND, and is NOT what this is
 * set to: `docs/research/2026-09-04-rookie-calibration-backtest.md` reports the full grid, including
 * that tail, in the open. Chasing it would weight every rookie almost entirely toward market
 * regardless of evidence — the "never a market override" philosophy the founder's review explicitly
 * rejected — and would make `effectiveN` meaningless in practice, since a real pick's evidence count
 * rarely exceeds single digits.
 *
 * 3 IS ALSO NOT THE AGGREGATE'S OWN BEST SCORE — a larger value (15) scores better in the COMBINED
 * average. It was rejected anyway: broken out by exact evidence count, priorN=15 REGRESSES the n=1
 * stratum below the pure model's own MAE (the exact evidence level Player A, the diagnosed defect's
 * own pick-three running back, sits at), while its combined-average win is driven by the n=2/n=3
 * buckets outnumbering n=1 in the sample. `THIN_EVIDENCE_PRIOR_N=3` is the one tested value that
 * improves on the pure model at EVERY individual evidence count actually present — the more
 * defensible finding, even though it is not the single largest aggregate number. See the report's
 * own "Decision" section for the full stratified comparison.
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
