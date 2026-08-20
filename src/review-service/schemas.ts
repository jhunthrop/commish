import { z } from "zod";
import { REVIEW_CONFIG } from "@/reviews/config";
import { validateReviewDraft } from "@/reviews/validate";
import { parseReviewCursor } from "@/reviews/cursor";

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
 * `GET /api/reviews`'s one query param, validated AND parsed here: the handler receives a
 * `ReviewCursor`, never a raw string, so nothing hand-edited or garbage reaches
 * `new Date(...)` deep inside `feedQuery` — the uncaught `RangeError` this boundary was added
 * to prevent. A malformed cursor is a 400 naming the field.
 *
 * The cursor carries a timestamp AND a row id (`@/reviews/cursor`). A bare-timestamp value —
 * including one this feed handed out before the id joined the sort key — is rejected rather
 * than silently paging with a non-unique key.
 */
export const listReviewsQuerySchema = z.object({
  before: z
    .string()
    .transform((raw, ctx) => {
      const cursor = parseReviewCursor(raw);
      if (cursor === null) {
        ctx.addIssue({ code: "custom", message: "That isn't a place we can load from." });
        return z.NEVER;
      }
      return cursor;
    })
    .optional(),
});

export type ListReviewsQuery = z.infer<typeof listReviewsQuerySchema>;

const REPORT_REASONS = REVIEW_CONFIG.reportReasons.map((entry) => entry.value) as [string, ...string[]];

export const reportReviewSchema = z.object({ reason: z.enum(REPORT_REASONS) });

export type ReportReviewInput = z.infer<typeof reportReviewSchema>;
