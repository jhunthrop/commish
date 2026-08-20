import { z } from "zod";
import { REVIEW_CONFIG } from "@/reviews/config";
import { validateReviewDraft } from "@/reviews/validate";

/**
 * `rating`/`body` are type-checked here; the substantive rule (range, length) is
 * `validateReviewDraft`'s alone — the SAME function `ReviewComposer`'s live character count
 * reads, so a body length can never drift between what this boundary accepts and what the UI
 * promises while a manager types. See `validateReviewDraft`'s own docblock.
 */
export const submitReviewSchema = z.object({ rating: z.number(), body: z.string() }).superRefine((draft, ctx) => {
  const result = validateReviewDraft(draft);
  if (!result.ok) ctx.addIssue({ code: "custom", message: result.message, path: ["body"] });
});

export type SubmitReviewInput = z.infer<typeof submitReviewSchema>;

/**
 * `GET /api/reviews`'s one query param. `z.iso.datetime()` is the same shape every `before`
 * cursor this app ever hands back (`ReviewsPage.nextBefore`, always a `Date#toISOString()`
 * output), so a well-formed cursor always round-trips and a hand-edited or garbage one is a 400
 * naming the field — never an uncaught `RangeError` from `new Date(garbage).toISOString()` deep
 * inside `feedQuery`, which is what reached this boundary unvalidated before.
 */
export const listReviewsQuerySchema = z.object({ before: z.iso.datetime().optional() });

export type ListReviewsQuery = z.infer<typeof listReviewsQuerySchema>;

const REPORT_REASONS = REVIEW_CONFIG.reportReasons.map((entry) => entry.value) as [string, ...string[]];

export const reportReviewSchema = z.object({ reason: z.enum(REPORT_REASONS) });

export type ReportReviewInput = z.infer<typeof reportReviewSchema>;
