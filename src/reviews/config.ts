import { MODERATION_CONFIG } from "@/moderation/config";
import { REMOVAL_REASON_VALUES as MODERATION_REMOVAL_REASON_VALUES } from "@/moderation/removal";

/**
 * Every tunable the public review feed has. Nothing in `src/reviews/**`, `src/review-service/**`
 * or `src/account-room/components/review-*` may inline one of these — see `validateReviewDraft`,
 * which is the one rule both the Zod boundary (`@/review-service/schemas`) and the composer's
 * live character count read, so a body length can never drift between what the server accepts
 * and what the UI promises while you type.
 */
export const REVIEW_CONFIG = {
  rating: { min: 1, max: 5 },
  body: { minLength: 20, maxLength: 1000 },
  /** Reviews per feed page. `listReviews` always paginates — there is no unbounded read. */
  pageSize: 20,
  /**
   * The complete, closed report-reason set — `MODERATION_CONFIG.reasons` (`@/moderation/config`),
   * not a second copy of it. Founder decision #2's default is "mirror `reviews`' existing closed
   * set exactly; one vocabulary, two record types", and a review report and a Task 6 chat report
   * pick from the SAME three reasons — so as of this task the one list lives in `src/moderation`,
   * pure and browser-safe, and this field is a re-export of it (ruling 21). Every existing
   * consumer (`reportReviewSchema`'s `z.enum`, `ReviewComposer`, `scripts/remove-review.ts`) reads
   * `REVIEW_CONFIG.reportReasons` exactly as it always has; only where the words are DEFINED moved.
   */
  reportReasons: MODERATION_CONFIG.reasons,
  /**
   * A cap on `scripts/remove-review.ts`'s `--reason`, mirroring `body.maxLength` above — defense
   * in depth alongside the closed `reportReasons` enum `--reason` is already validated against.
   * `removeReview` (`@/review-service/reviews.ts`) is the operator's ONLY door today, but it
   * enforces this itself rather than trusting the script's own enum check to be the sole gate: a
   * future caller of the service directly (an admin UI, a different script) must not be able to
   * hand an unbounded string to `notifyAffectedMember`, which stores it on a member's own
   * notice and renders it, through `removalPhraseFor`, in a blockquote they read.
   */
  removalReason: { maxLength: 200 },
  /** `POST /api/reviews`'s ceiling — keyed per user id, an authenticated write. */
  submitRateLimit: { maxRequests: 5, windowMs: 60_000 },
  /** `GET /api/reviews`'s ceiling — keyed per IP, this product's second unauthenticated read. */
  browseRateLimit: { maxRequests: 60, windowMs: 60_000 },
  /** `POST /api/reviews/[reviewId]/report`'s ceiling — keyed per user id. */
  reportRateLimit: { maxRequests: 20, windowMs: 60_000 },
} as const;

export type ReportReasonValue = (typeof REVIEW_CONFIG.reportReasons)[number]["value"];

/**
 * Every reason an operator may remove a review for. `scripts/remove-review.ts` validates against
 * this. Re-exported from `@/moderation/removal`, but WIDENED back to `readonly string[]` here
 * (the moderation original is narrowed to the closed union — see that module's own docblock):
 * the script's own `.includes(reason)` check compares against a bare CLI string, which the narrow
 * element type would refuse to accept as an argument at all.
 */
export const REMOVAL_REASON_VALUES: readonly string[] = MODERATION_REMOVAL_REASON_VALUES;

/**
 * `removalPhraseFor`/`removalSentenceFor` are re-exported from `@/moderation/removal` unchanged —
 * the point of a re-export here is that the diff at every consumer (`ReviewComposer`,
 * `scripts/remove-review.ts`, `@/integrity-service/notify`) is zero, which is what makes this a
 * de-duplication rather than a refactor.
 */
export { removalPhraseFor, removalSentenceFor } from "@/moderation/removal";
