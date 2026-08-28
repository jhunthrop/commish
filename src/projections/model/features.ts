/**
 * WHICH CONTEXT FEATURES ARE SWITCHED ON — the seam the whole of Phase 3 is measured through.
 *
 * The phase's governing rule is that each feature group lands alone, with its own `rho before ->
 * rho after` on two held-out seasons, and does not ship if it cannot earn that. A rule like that
 * needs a mechanism, and this is it: an ablation is one boolean flipped, run through exactly the
 * same code path as the model itself. Anything less — a second copy of the model with the feature
 * commented out, a branch, a fitted parameter set aside — would let the two arms of a comparison
 * drift apart, and the difference between them would stop being the feature.
 *
 * The flags are all-or-nothing per GROUP rather than per input, on purpose. "Does the offensive
 * line composite earn its place" is a question with a maintainable answer; "does stuffed rate earn
 * its place holding sack rate fixed" is sixteen runs and a conclusion nobody can act on.
 *
 * DEFAULT OFF, and every flag has to be turned on by a commit that measured it. A feature that
 * shipped on because it was written is a feature nobody measured.
 */
export interface FeatureFlags {
  /** Task 1 — a derived offensive line composite feeding layer 2's efficiency priors. */
  readonly line: boolean;
  /** Task 2 — situation-neutral pace and pass rate over expected, sizing layer 1's team volume. */
  readonly scheme: boolean;
  /** Task 3 — a departed player's share vacates and is redistributed by role proximity. */
  readonly redistribution: boolean;
  /** Task 4 — opponent adjusted for offences faced, game script, weather and rest. */
  readonly gameContext: boolean;
  /**
   * Phase 5 — red-zone leverage on the touchdown rates. The first group that separates a man from
   * his own TEAMMATES rather than moving a whole offence together, which is what model v2's closing
   * lesson said would be needed to move a ranking.
   */
  readonly redZone: boolean;
  /**
   * Phase 5 — depth of target on the receiving rates. The second teammate-separating group: a
   * checkdown back and a field-stretcher can take the same target share of the same offence.
   */
  readonly targetDepth: boolean;
}

/** Model v1 exactly: three layers, no context. The `before` arm of every ablation. */
export const NO_FEATURES: FeatureFlags = {
  line: false,
  scheme: false,
  redistribution: false,
  gameContext: false,
  redZone: false,
  targetDepth: false,
};

/** Every group at once. The headline number, and explicitly NOT an ablation of anything. */
export const ALL_FEATURES: FeatureFlags = {
  line: true,
  scheme: true,
  redistribution: true,
  gameContext: true,
  redZone: true,
  targetDepth: true,
};

/**
 * WHAT THE ENGINE ACTUALLY SHIPS WITH — only the groups that earned their place on both held-out
 * seasons.
 *
 * Kept separate from `ALL_FEATURES` because they are different claims. `ALL_FEATURES` is "what if
 * everything were on"; this is "what the measurements said to keep", and a group that measured
 * neutral or negative belongs in the research document and not in this constant, however good the
 * story for it was.
 */
export const SHIPPED_FEATURES: FeatureFlags = {
  ...NO_FEATURES,
  /**
   * ON. Every rank band improved on both held-out seasons — eight of eight — while the overall
   * number stayed flat (0.6770 -> 0.6767 in 2024, 0.6780 -> 0.6781 in 2023). The overall figure is
   * dominated by ordering ACROSS bands, which everybody gets right; the bands are where a manager's
   * start-and-sit decision actually lives. See `docs/research/2026-08-27-model-v2.md`.
   */
  scheme: true,
  /**
   * ON. The elite and starter bands improve by nearly identical amounts on both held-out seasons
   * (+0.0102 / +0.0102 and +0.0073 / +0.0058) and mean absolute error falls on both. Only the
   * opponent adjustment and rest are in it: the implied total, the spread and the weather are
   * knowable only at kickoff and cannot reach a projection made the Tuesday before.
   */
  gameContext: true,
};
