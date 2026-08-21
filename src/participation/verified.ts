/**
 * Founder decision #8's definition, stated in one place so both halves — the pure predicate here
 * and the badge it drives on `ReviewView` (Task 8) — read from the same file rather than each
 * carrying its own copy of what "verified" means.
 *
 * `completedSeasons` can only come from a `count(*)`, so a negative value means the caller is
 * confused, matching `participationTierFor`'s own boundary discipline (`./tier`).
 */
export function isVerifiedPlayer(completedSeasons: number, cutoff: number): boolean {
  if (completedSeasons < 0) {
    throw new Error(`isVerifiedPlayer: completedSeasons must not be negative (got ${completedSeasons}).`);
  }
  return completedSeasons >= cutoff;
}

/** The badge's own visible text — short, because the tooltip carries the claim. */
export const VERIFIED_BADGE_LABEL = "Verified";

/**
 * The sentence founder decision #8 asks for, verbatim: it states the claim rather than implying a
 * broader one. A badge that says only "Verified" invites every reader to guess what was verified;
 * this says exactly what was checked.
 */
export const VERIFIED_BADGE_TOOLTIP = "This reviewer finished at least one full season on Commish.";
