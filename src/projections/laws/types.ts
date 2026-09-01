/**
 * THE LAW REGISTRY'S SHAPES — what a "law" is before any law exists.
 *
 * A law is a claim like "workhorse backs age out early" or "post-hype WRs bust." Those claims are
 * cheap to assert and expensive to trust, so every law in the registry carries its own measurement:
 * a matched-baseline effect size with a confidence interval, not just a verdict somebody typed in.
 * The registry can then be regenerated from data instead of edited by hand when the evidence moves.
 */

/** How the evidence resolved. Never asserted directly — always the output of `verdictFor`. */
export type LawVerdict = "confirmed" | "weak" | "debunked";

/** The measured evidence behind one law, independent of what the law claims. */
export interface LawMeasurement {
  /** Points/game delta, condition minus matched baseline. */
  readonly effect: number;
  /** Bootstrap 95% confidence interval, [low, high]. */
  readonly ci: readonly [number, number];
  /** Condition player-seasons measured (after matching drops unmatched rows). */
  readonly sample: number;
  /** e.g. "2011-2024, held out 2023-2024" — the window this measurement was drawn from. */
  readonly seasons: string;
}

/** One entry in the law registry: a plain-words claim plus the evidence that grades it. */
export interface Law {
  readonly id: string;
  readonly position: "QB" | "RB" | "WR" | "TE" | "all";
  /** Plain words, user-facing. */
  readonly claim: string;
  readonly measured: LawMeasurement;
  readonly verdict: LawVerdict;
  /** The fitted feature this law gates; null means the law is content only, no model wiring. */
  readonly modelPath: string | null;
  /**
   * Where this law came from (Task 7, 2026-08-31): `"tribal"` is one of the six hand-picked
   * `LAW_SPECS` (`populations.ts`), measured against a claim and an expected sign someone stated up
   * front. `"discovered"` is one of `discovery/generate.ts`'s mechanically generated candidates that
   * survived Benjamini-Hochberg false-discovery control over the whole 1,737-candidate family and
   * then replicated on the full window (`discovery/measure.ts`'s own docblock has the full pipeline).
   * A discovered law's `expectedSign` was never asserted by a person — it is the sign its own
   * train-window effect happened to point, which is why its `claim` only exists post-measurement
   * (`discovery/templates.ts`'s `renderSignedClaim`) rather than being authored alongside a
   * `LawSpec`. `registry()` merges both kinds; `hasFoldEvidence` and `verdict` mean the identical
   * thing for either origin, computed by `verdictForFullWindow` (tribal) or `verdictForDiscoveredLaw`
   * (discovered) respectively.
   */
  readonly origin: "tribal" | "discovered";
  /**
   * Whether at least one replication fold (`config.ts`'s `REPLICATION_FOLDS`) matched any pairs at
   * all. `registry.ts`'s `verdictForFullWindow` caps a `weak` verdict at that grade for two
   * distinct reasons when the full-window CI already excludes zero: a fold disagreed in sign
   * (`hasFoldEvidence: true` — some fold had evidence, and it disagreed), or zero folds matched any
   * pairs (`hasFoldEvidence: false` — nothing to check it against). `foldEffects` itself stays out
   * of `Law`'s own shape (`registry.ts`'s `MeasuredEntry` keeps it internal); this one boolean is
   * the minimal derived fact a consumer like `/player-laws` needs to tell those two cases apart
   * without learning about folds at all.
   */
  readonly hasFoldEvidence: boolean;
}

/**
 * One player's covariate at season N and outcome at season N+1 — the harness's only input shape.
 * `nextPointsPerGame: null` means the player did not play the following season (retired, cut,
 * injured out); matching drops those from both pools rather than scoring them as a zero, because a
 * zero would misrepresent "no data" as "cratered performance."
 */
export interface PlayerSeasonPoint {
  readonly playerId: string;
  readonly season: number;
  /** QB/RB/WR/TE, season N — the stratum a law spanning more than one position must match within. */
  readonly position: "QB" | "RB" | "WR" | "TE";
  /** Season N, PPR per game. */
  readonly pointsPerGame: number;
  /** Season N+1, PPR per game; null = did not play. */
  readonly nextPointsPerGame: number | null;
  /** The matching covariate (usually `pointsPerGame`). */
  readonly matchKey: number;
  /** Does the law's antecedent hold for this player-season? */
  readonly condition: boolean;
}
