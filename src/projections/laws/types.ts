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

/**
 * THE FOUR NUMERIC SHAPES A DISCOVERED LAW'S OWN MAGNITUDE CAN TAKE (Task 8 fix round, 2026-08-31) —
 * one PLAIN-ROUNDED formatter per unit, generic across every discovered id (never a hand entry per
 * id: a discovered id changes every discovery round). Lives HERE, in the pure shapes file, rather
 * than in `discovery/templates.ts` (which owns the QUANTITY vocabulary this tag is derived FROM),
 * because `Law.primaryQuantityUnit` below needs it and a CLIENT bundle (`ReasonChip`) needs to
 * import `Law`'s own shape without pulling in the candidate generator or its committed quantile
 * table alongside it — the exact bundle-weight problem this fix round exists to close. See
 * `discovery/templates.ts`'s `QuantityDef.magnitudeUnit` for where a quantity picks its own tag, and
 * `ReasonChip`'s own `formatMagnitude` for the plain-rounding formatter keyed by it.
 */
export type PrimaryQuantityUnit = "whole" | "one_decimal" | "two_decimal" | "percent";

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
  /**
   * THE SAME MATCHED-PAIRS MEASUREMENT AS `measured.effect`, RESTRICTED TO PREDICTOR SEASONS
   * `<= LAW_TRAIN_CUTOFF_SEASON` (C1 fix round, 2026-08-31 — `config.ts`'s `trainEffectFor` docblock
   * has the full boundary rationale). A SIBLING field of `measured` rather than nested inside
   * `LawMeasurement` itself: `LawMeasurement` is the generic "one window's measurement" shape
   * `harness.ts`'s `measureEffect` returns for ANY window (full or train), and a train
   * measurement having its own nested "train effect" would be self-referential. `market/blend.ts`'s
   * law delta reads THIS field, never `measured.effect` — the full-window number spans seasons this
   * engine's blend fit is forbidden to fit on. `/player-laws` and every other reader of a law's
   * claim keep showing `measured.effect`, the full-window number, unchanged.
   */
  readonly trainEffect: number;
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
  /**
   * THE DISCOVERED HALF OF A LAW'S OWN PRESENTATION DATA (Task 8 fix round, 2026-08-31) — written
   * ONCE at discovery time (`discovery/measure.ts`'s `runDiscoveryPipeline`, from
   * `discovery/templates.ts`'s `primaryQuantityDefOf`) rather than derived client-side, so a client
   * bundle (`ReasonChip`) can build a discovered law's own headline WITHOUT importing the candidate
   * generator or its committed quantile table — both of which a server-only `board-reasons.ts` is
   * free to keep importing, since it never ships to the browser. `primaryQuantityId` is the SAME id
   * `discovery/templates.ts`'s `primaryQuantityIdOf` computes fresh from the candidate's own clause;
   * `board-reasons.ts`'s `lawReasonsFor` asserts the two agree before ever using either, so this
   * field can never silently drift from the live template it was generated from. All three are
   * `null` for a TRIBAL law, which has no generated presentation data — `ReasonChip`'s own
   * `LAW_HEADLINES` carries a tribal law's headline by hand instead.
   */
  readonly primaryQuantityId: string | null;
  /** The primary quantity's own short label, e.g. "touchdown-points share" — `ReasonChip`'s headline
   *  reads this verbatim, never re-deriving it. `null` for a tribal law. */
  readonly primaryQuantityNoun: string | null;
  /** How to format a MAGNITUDE (a player's own value) of the primary quantity, mechanically, with
   *  PLAIN rounding — see `PrimaryQuantityUnit`'s own docblock for why this is a separate tag from a
   *  THRESHOLD's ceiling-rounded `formatValue`. `null` for a tribal law. */
  readonly primaryQuantityUnit: PrimaryQuantityUnit | null;
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
