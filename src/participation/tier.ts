/**
 * THE THIRD MEANING OF "TIER". `users.experience_tier` (`beginner` | `experienced`) is a
 * self-reported sign-up answer that drives `helpLevel` defaults. `leagues.experience_tier` (same
 * enum, different table) is a self-declared label a commissioner puts on a league for the browse
 * page. Neither is this: `participationTier` is a COMPUTED, ENFORCED fact — how many seasons an
 * account has actually finished on this platform — and it shares no word with either column on
 * purpose. Reusing `beginner`/`experienced` here would type-check against both of those columns
 * and guarantee that somebody, someday, hands a self-reported sign-up answer to a join gate that
 * is supposed to be reading a computed participation record.
 */
export const PARTICIPATION_TIERS = ["newcomer", "veteran"] as const;

export type ParticipationTier = (typeof PARTICIPATION_TIERS)[number];

/**
 * NO LABEL OR BLURB TABLE LIVES HERE. `PARTICIPATION_TIER_LABEL` and `PARTICIPATION_TIER_BLURB`
 * shipped beside this union with no production reader (final review F13) and were deleted rather
 * than left to look like a shared vocabulary. The one surface that names these two tiers to a
 * person, `browse-filters.tsx`, deliberately writes its own "Newcomer-friendly"/"Veteran-heavy"
 * copy, because a filter control is describing what a league LEANS rather than labelling an
 * account; `TIER_COMPOSITION_LABEL` (`./composition`) owns the three phrases a browse card says.
 * A future surface that genuinely needs an account-facing tier word should add the table back
 * with its consumer in the same commit, per the delete-dead-code rule.
 */

/**
 * `newcomer` below `cutoff`, `veteran` at it and above it — `>=`, on purpose, the same reasoning
 * `crossesFairnessThreshold` (`@/trades/fairness`) already uses: a cutoff that can never be
 * reached exactly is a cutoff nobody can configure precisely.
 *
 * An account that has never finished a season is a `newcomer`, not an unknown or an error —
 * `completedSeasons` of `0` is the ordinary, expected value for every account today (no league on
 * this platform has completed a season yet), and treating it as anything other than the plainest
 * possible tier would make the common case the special one.
 *
 * `completedSeasons` can only come from a `count(*)`, so a negative value means the caller is
 * confused, not that the account is somehow tier-negative — fail fast at the boundary rather than
 * classify a number that cannot be real.
 */
export function participationTierFor(completedSeasons: number, cutoff: number): ParticipationTier {
  if (completedSeasons < 0) {
    throw new Error(`participationTierFor: completedSeasons must not be negative (got ${completedSeasons}).`);
  }
  return completedSeasons >= cutoff ? "veteran" : "newcomer";
}
