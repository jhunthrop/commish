/**
 * OPPORTUNITY — share, not count. The keystone layer of the engine (spec, layer 1).
 *
 * Volume predicts fantasy points far better than efficiency does, because opportunity is stable
 * and efficiency is mostly noise: a receiver's catch rate swings wildly week to week, his target
 * share barely moves. A share is also the quantity a trade resolves against — a receiver leaves,
 * his target share vacates, and the model redistributes it — which a raw count cannot express.
 *
 * Every function here is pure: no I/O, no dates, no league state. That is a hard requirement, not
 * a preference. These run inside an ablation loop thousands of times, and a feature that needs a
 * database cannot be ablated.
 *
 * NULL IS NOT ZERO, throughout, following `metrics.ts`' own discipline. A team that ran no
 * offensive snaps has no snap share — not a share of zero — and a bye week is a week with no
 * evidence rather than a week of no opportunity. Averaging those zeros in would quietly halve a
 * starter's projected share for the crime of having had a bye, and the number would look
 * plausible enough to survive review.
 */

export const OPPORTUNITY_CONFIG = {
  /**
   * How much a week's weight decays per week into the past, for `rollingOpportunity`.
   *
   * 0.75 gives a half-life of about 2.4 weeks — recent form dominates, but a full month still
   * contributes. It is a PLACEHOLDER, chosen for plausibility rather than measured, and it is
   * stated here as one named constant precisely so the harness can settle it: the right answer is
   * whichever value scores best on held-out seasons, and until the backtest has run nobody knows
   * what that is. Do not scatter a second decay anywhere.
   */
  recencyDecay: 0.75,
} as const;

function assertFinite(value: number, label: string): number {
  if (!Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number; got ${value}.`);
  }
  if (value < 0) {
    throw new Error(`${label} must not be negative; got ${value}.`);
  }
  return value;
}

/**
 * A part over a whole, or `null` when the whole is zero.
 *
 * Throws when the part exceeds the whole. That combination is not a plausible edge case — it is a
 * join that went wrong upstream (a player matched to the wrong team, two files disagreeing about a
 * week) — and a "share" above 1 would flow into a model as a legitimate-looking feature value and
 * never be questioned again. Better to stop at the boundary and name it.
 */
function share(part: number, whole: number, partLabel: string, wholeLabel: string): number | null {
  assertFinite(part, partLabel);
  assertFinite(whole, wholeLabel);
  if (whole === 0) return null;
  if (part > whole) {
    throw new Error(
      `${partLabel} (${part}) is more than ${wholeLabel} (${whole}); the two numbers describe different players or different weeks.`,
    );
  }
  return part / whole;
}

/**
 * The fraction of his offense's snaps a player was on the field for.
 *
 * THE feature Tank01 cannot supply and this whole ingestion module exists to make possible: a box
 * score says five catches on eight targets and cannot distinguish a twenty-snap specialist from a
 * sixty-snap starter having a quiet day. Those two players have completely different next weeks.
 */
export function snapShare(playerSnaps: number, teamSnaps: number): number | null {
  return share(playerSnaps, teamSnaps, "player snaps", "team offensive snaps");
}

/** The fraction of his team's targets that came his way. */
export function targetShare(playerTargets: number, teamTargets: number): number | null {
  return share(playerTargets, teamTargets, "player targets", "team targets");
}

/**
 * Targets per route run — the sharpest available measure of how much a quarterback looks for a
 * receiver, independent of how often the offense threw.
 *
 * `routesRun` is nullable because nflverse does not publish it: it is charting data. This returns
 * `null` for that, and the caller must NOT read that as zero — see the module docblock. The
 * parameter is typed nullable rather than defaulted so a call site cannot forget.
 */
export function targetsPerRouteRun(targets: number, routesRun: number | null): number | null {
  if (routesRun === null) return null;
  return share(targets, routesRun, "targets", "routes run");
}

/** One week's value for a player, or `null` where there is no evidence for that week. */
export interface WeeklyValue {
  readonly week: number;
  readonly value: number | null;
}

export interface RollingOptions {
  /** How many weeks back to look, counted in CALENDAR weeks from the most recent one. */
  readonly window: number;
  /** Defaults to `OPPORTUNITY_CONFIG.recencyDecay`. */
  readonly decay?: number;
}

/**
 * A recency-weighted mean of a player's recent weeks — the form number every downstream layer
 * actually reads, rather than a raw single week.
 *
 * Weighted by CALENDAR distance, not by position in the list. A player returning from a
 * three-week absence should have his last healthy week discounted by three weeks, not treated as
 * though it were last Sunday; counting rows would do the latter, and would make a returning
 * starter's stale form look current, which is exactly the segment the engine most needs to get
 * right.
 *
 * `null` when nothing in the window carries a value — the honest answer for a player with no
 * recent evidence, and one a caller must treat as "unknown" rather than as zero opportunity.
 */
export function rollingOpportunity(
  history: readonly WeeklyValue[],
  { window, decay = OPPORTUNITY_CONFIG.recencyDecay }: RollingOptions,
): number | null {
  if (!Number.isInteger(window) || window < 1) {
    throw new Error(`A rolling window must be a positive whole number of weeks; got ${window}.`);
  }
  // Outside (0, 1] the weights stop describing "recent matters more": at 0 every past week
  // vanishes and the window is a lie, above 1 the OLDEST week dominates.
  if (!Number.isFinite(decay) || decay <= 0 || decay > 1) {
    throw new Error(`A recency decay must be greater than 0 and at most 1; got ${decay}.`);
  }

  const known = history.filter((entry): entry is { week: number; value: number } => entry.value !== null);
  if (known.length === 0) return null;

  const mostRecent = Math.max(...known.map((entry) => entry.week));
  let weighted = 0;
  let weights = 0;
  for (const { week, value } of known) {
    const weeksAgo = mostRecent - week;
    if (weeksAgo >= window) continue;
    const weight = decay ** weeksAgo;
    weighted += weight * assertFinite(value, `week ${week} value`);
    weights += weight;
  }
  return weights === 0 ? null : weighted / weights;
}
