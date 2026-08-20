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

const REPORT_REASONS = REVIEW_CONFIG.reportReasons.map((entry) => entry.value) as [string, ...string[]];

export const reportReviewSchema = z.object({ reason: z.enum(REPORT_REASONS) });

export type ReportReviewInput = z.infer<typeof reportReviewSchema>;
