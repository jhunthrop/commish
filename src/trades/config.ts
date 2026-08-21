/**
 * Every tunable the trade PRODUCT has. The integrity thresholds are deliberately not here:
 * `INTEGRITY_CONFIG.trade` owns what makes a completed trade a question for an operator, and
 * that file's own docblock reserves the right to be the one home for this phase's thresholds.
 * Two configs, two audiences, and the line between them is "would a commissioner tune this?"
 */
export const TRADE_CONFIG = {
  /** How long an offer stands before it stops being answerable. Lazy: checked on read and again
   *  inside the accept transaction, never by a scheduled job, because this product has no
   *  scheduler and inventing one for an expiry is how a plan grows a deploy dependency. */
  proposalTtlHours: 72,
  /** Most assets one side may send. Matches `ADVISOR_CONFIG.maxPlayersPerSide` (5) on purpose:
   *  a proposal the advisor cannot assess is a proposal a manager accepts blind. */
  maxAssetsPerSide: 5,
  /** Open offers one team may have outstanding at once, counted inside the proposing
   *  transaction. Bounded so a manager cannot paper a league with offers, and generous enough
   *  that shopping one player to three teams is normal use. */
  maxOpenProposalsPerTeam: 10,
  /** The optional note a proposer attaches. Read by one other human, so it is short. */
  noteMaxLength: 280,
  /** Per user, across every trade route: proposing, withdrawing, rejecting and accepting all
   *  spend the same scarce resource (a multi-table transaction against this league), the same
   *  "one budget across sibling routes" call `advisorRateLimited` and `INTEGRITY_CONFIG.notices
   *  .rateLimit` both make. */
  rateLimit: { maxRequests: 20, windowMs: 60_000 },
} as const;
