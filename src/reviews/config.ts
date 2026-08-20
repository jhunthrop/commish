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
   * The complete, closed report-reason set — a fixed vocabulary rather than free text, so the
   * operator script's stdout and any future Phase 3 queue read the same small enum forever.
   */
  reportReasons: [
    { value: "spam", label: "Spam or fake" },
    { value: "abusive", label: "Abusive or harassing" },
    { value: "other", label: "Something else" },
  ],
  /** `POST /api/reviews`'s ceiling — keyed per user id, an authenticated write. */
  submitRateLimit: { maxRequests: 5, windowMs: 60_000 },
  /** `GET /api/reviews`'s ceiling — keyed per IP, this product's second unauthenticated read. */
  browseRateLimit: { maxRequests: 60, windowMs: 60_000 },
  /** `POST /api/reviews/[reviewId]/report`'s ceiling — keyed per user id. */
  reportRateLimit: { maxRequests: 20, windowMs: 60_000 },
} as const;

export type ReportReasonValue = (typeof REVIEW_CONFIG.reportReasons)[number]["value"];
