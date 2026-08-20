import { REVIEW_CONFIG } from "./config";

export interface ReviewDraft {
  readonly rating: number;
  readonly body: string;
}

export type ReviewDraftValidation = { readonly ok: true } | { readonly ok: false; readonly message: string };

/**
 * The ONE rule for what a submittable review looks like — read by `submitReviewSchema`
 * (`@/review-service/schemas`, the Zod boundary a `POST /api/reviews` request actually meets)
 * AND by `ReviewComposer`'s live remaining-character count, so the number a manager watches
 * tick down while they type is never a different number than the one the server enforces.
 *
 * Pure and I/O-free (no `src/reviews/**` module may reach a database or the network), which is
 * what lets `ReviewComposer` — client code under the boundary rule — value-import it directly.
 */
export function validateReviewDraft(draft: ReviewDraft): ReviewDraftValidation {
  if (!Number.isInteger(draft.rating) || draft.rating < REVIEW_CONFIG.rating.min || draft.rating > REVIEW_CONFIG.rating.max) {
    return { ok: false, message: `Choose a rating from ${REVIEW_CONFIG.rating.min} to ${REVIEW_CONFIG.rating.max}.` };
  }
  const trimmed = draft.body.trim();
  if (trimmed.length < REVIEW_CONFIG.body.minLength) {
    return { ok: false, message: `Say a little more, at least ${REVIEW_CONFIG.body.minLength} characters.` };
  }
  if (trimmed.length > REVIEW_CONFIG.body.maxLength) {
    return { ok: false, message: `Keep it under ${REVIEW_CONFIG.body.maxLength} characters.` };
  }
  return { ok: true };
}
