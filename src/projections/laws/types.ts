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
  /** Season N, PPR per game. */
  readonly pointsPerGame: number;
  /** Season N+1, PPR per game; null = did not play. */
  readonly nextPointsPerGame: number | null;
  /** The matching covariate (usually `pointsPerGame`). */
  readonly matchKey: number;
  /** Does the law's antecedent hold for this player-season? */
  readonly condition: boolean;
}
