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
}

/** Model v1 exactly: three layers, no context. The `before` arm of every ablation. */
export const NO_FEATURES: FeatureFlags = {
  line: false,
  scheme: false,
  redistribution: false,
  gameContext: false,
};

/** Every group at once. The headline number, and explicitly NOT an ablation of anything. */
export const ALL_FEATURES: FeatureFlags = {
  line: true,
  scheme: true,
  redistribution: true,
  gameContext: true,
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
export const SHIPPED_FEATURES: FeatureFlags = NO_FEATURES;
