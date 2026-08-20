/**
 * The one closed report/removal reason vocabulary, and the two phrasings it is rendered as.
 * Founder decision #2's default is "mirror `reviews`' existing closed set exactly; one
 * vocabulary, two record types" — a review report and (from Task 6) a chat report pick from the
 * SAME three reasons, so the vocabulary cannot live inside either record type's own config
 * without either a second copy (the thing ruling 21 forbids) or one record type's client code
 * importing the other's server-only directory it has no business depending on.
 *
 * `src/moderation/**` is pure — no database, no clock, no I/O — the same shape `src/reviews/**`,
 * `src/chat/**`, `src/identity/**`, `src/matchmaking/**` and `src/help/**` already have, which is
 * what makes it safe for `eslint.config.mjs`'s client-boundary rule to exempt (see that file's
 * own comment) rather than block the way `@/integrity`/`@/integrity-service` are blocked.
 *
 * `label` is what a REPORTER picks from; `removalPhrase` is what the removed AUTHOR reads in
 * "Your review was removed for ___." — kept side by side for the same reason
 * `EXPERIENCE_TIER_LABEL` (`@/identity/config`) sits beside its own enum: the alternative is two
 * lists that only happen to agree, until they don't.
 */
export const MODERATION_CONFIG = {
  reasons: [
    { value: "spam", label: "Spam or fake", removalPhrase: "spam or fake content" },
    { value: "abusive", label: "Abusive or harassing", removalPhrase: "abusive or harassing content" },
    { value: "other", label: "Something else", removalPhrase: "breaking the review rules" },
  ],
  /**
   * `POST /api/leagues/[leagueId]/chat/[messageId]/report`'s ceiling — keyed per user id, an
   * authenticated write. Mirrors `REVIEW_CONFIG.reportRateLimit` exactly (same numbers, same
   * shape): a chat report and a review report are the same act — a signal into `raiseFlag`, not
   * a second thing with its own budget to reason about separately.
   */
  chatReportRateLimit: { maxRequests: 20, windowMs: 60_000 },
} as const;

export type ModerationReasonValue = (typeof MODERATION_CONFIG.reasons)[number]["value"];
