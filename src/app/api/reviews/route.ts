import { getDb } from "@research/db/client";
import { listReviews, submitReview } from "@/review-service/reviews";
import { listReviewsQuerySchema, submitReviewSchema } from "@/review-service/schemas";
import { fail, ok, parseJson, parseQuery } from "@/lib/api/respond";
import type { ReviewsListBody, ReviewSubmitBody } from "@/reviews/contract";
import { withCurrentUser } from "@/app/api/leagues/_shared";
import { browseRateLimited, submitRateLimited } from "./_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The ONE unauthenticated review read in this application, same standing as `GET /api/public/
 * leagues`: readable signed out because the person it's for (`docs/superpowers/plans/2026-08-19-
 * phase2-plan-c-onboarding-and-trust.md`'s first-timer persona) has not signed up yet.
 *
 * `before` is validated at THIS boundary (`listReviewsQuerySchema`) before it ever reaches
 * `listReviews`/`feedQuery`: a hand-edited or garbage cursor is a 400 naming the field, not an
 * uncaught `RangeError` from `new Date(garbage).toISOString()` — the failure mode a live
 * unauthenticated route can least afford.
 */
export async function GET(request: Request) {
  const limited = browseRateLimited(request);
  if (limited !== null) return limited;

  const before = new URL(request.url).searchParams.get("before");
  const parsedQuery = parseQuery({ before: before ?? undefined }, listReviewsQuerySchema);
  if (!parsedQuery.ok) return parsedQuery.response;

  const page = await listReviews(getDb(), { before: parsedQuery.value.before });
  return ok<ReviewsListBody>(page);
}

/**
 * Writes the caller's own review. `submitReview`'s upsert (`reviews.user_id` is UNIQUE) is what
 * makes this route double as both "leave a review" and "edit my review" with no separate PATCH —
 * `ReviewComposer` always POSTs here, whichever case it is.
 *
 * A removed author is refused with `submitReview`'s own 409, not a success for a write that
 * never landed: removal wins, and this is where the product says so out loud.
 */
export async function POST(request: Request) {
  return withCurrentUser(request, async (userId, req) => {
    const limited = submitRateLimited(userId);
    if (limited !== null) return limited;

    const parsed = await parseJson(req, submitReviewSchema);
    if (!parsed.ok) return parsed.response;

    const result = await submitReview(getDb(), { userId, rating: parsed.value.rating, body: parsed.value.body });
    if (!result.ok) return fail(result.reason, result.status);
    return ok<ReviewSubmitBody>(result.review);
  });
}
