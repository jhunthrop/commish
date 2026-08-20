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
   *
   * `label` is what a REPORTER picks from; `removalPhrase` is what the removed AUTHOR reads in
   * "Your review was removed for ___." Two phrasings of one vocabulary, kept side by side for
   * the same reason `EXPERIENCE_TIER_LABEL` sits beside its enum: the alternative is two lists
   * that drift. `scripts/remove-review.ts` accepts only these `value`s, so an operator can no
   * longer type free text into a sentence a user reads.
   */
  reportReasons: [
    { value: "spam", label: "Spam or fake", removalPhrase: "spam or fake content" },
    { value: "abusive", label: "Abusive or harassing", removalPhrase: "abusive or harassing content" },
    { value: "other", label: "Something else", removalPhrase: "breaking the review rules" },
  ],
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

/** Every reason an operator may remove a review for. `scripts/remove-review.ts` validates against this. */
export const REMOVAL_REASON_VALUES: readonly string[] = REVIEW_CONFIG.reportReasons.map((reason) => reason.value);

/**
 * The sentence fragment a removed author reads. A stored value outside the closed set falls back
 * to the generic phrase rather than being printed raw: rows written before the operator script
 * constrained `--reason`, or by hand in SQL, must not put an operator's private wording into a
 * sentence on the author's own profile.
 */
export function removalPhraseFor(storedReason: string): string {
  return REVIEW_CONFIG.reportReasons.find((reason) => reason.value === storedReason)?.removalPhrase ?? "breaking the review rules";
}

/**
 * The whole sentence, in ONE place. `ReviewComposer` renders it on the author's own profile and
 * `scripts/remove-review.ts` prints it in the operator's confirmation preview, and those two had
 * drifted into two string literals that only happened to agree. An operator preview that promises
 * different words from the ones the author reads is worse than no preview: it is a wrong answer
 * to the only question the preview exists to answer.
 */
export function removalSentenceFor(storedReason: string): string {
  return `Your review was removed for ${removalPhraseFor(storedReason)}. It can't be edited.`;
}
