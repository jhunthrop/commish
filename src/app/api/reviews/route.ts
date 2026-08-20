import { getDb } from "@/db/client";
import { listReviews, submitReview } from "@/review-service/reviews";
import { submitReviewSchema } from "@/review-service/schemas";
import { ok, parseJson } from "@/lib/api/respond";
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
 * `before` is passed straight through as `listReviews`'s ISO `createdAt` cursor — untrusted, but
 * `new Date(garbage)` inside `feedQuery` produces an Invalid Date, which every Postgres
 * comparison against it treats as false, so a malformed cursor degrades to "no older page" rather
 * than a 500.
 */
export async function GET(request: Request) {
  const limited = browseRateLimited(request);
  if (limited !== null) return limited;

  const before = new URL(request.url).searchParams.get("before");
  const page = await listReviews(getDb(), { before: before ?? undefined });
  return ok<ReviewsListBody>(page);
}

/**
 * Writes the caller's own review. `submitReview`'s upsert (`reviews.user_id` is UNIQUE) is what
 * makes this route double as both "leave a review" and "edit my review" with no separate PATCH —
 * `ReviewComposer` always POSTs here, whichever case it is.
 */
export async function POST(request: Request) {
  return withCurrentUser(request, async (userId, req) => {
    const limited = submitRateLimited(userId);
    if (limited !== null) return limited;

    const parsed = await parseJson(req, submitReviewSchema);
    if (!parsed.ok) return parsed.response;

    const review = await submitReview(getDb(), { userId, rating: parsed.value.rating, body: parsed.value.body });
    return ok<ReviewSubmitBody>(review);
  });
}
