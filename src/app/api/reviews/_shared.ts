import { fail } from "@/lib/api/respond";
import { createRateLimiter } from "@/lib/api/rate-limit";
import { REVIEW_CONFIG } from "@/reviews/config";

/**
 * A per-IP ceiling on `GET /api/reviews` — this product's second unauthenticated read, after
 * `GET /api/public/leagues`. Copies `browseRateLimited` (`src/app/api/public/leagues/_shared.ts`)
 * exactly rather than inventing a second pattern: same per-process, in-memory bound (a blast-
 * radius limit on one instance, not a distributed budget — see `createRateLimiter`'s own
 * docblock), same `X-Forwarded-For`-first-hop key, same honest limitation that a motivated
 * scraper can rotate the header it's keyed on.
 */
const browseRequests = createRateLimiter(REVIEW_CONFIG.browseRateLimit);

/** `POST /api/reviews`'s ceiling — keyed per user id, an authenticated write. */
const submitRequests = createRateLimiter(REVIEW_CONFIG.submitRateLimit);

/** `POST /api/reviews/[reviewId]/report`'s ceiling — keyed per user id. */
const reportRequests = createRateLimiter(REVIEW_CONFIG.reportRateLimit);

function clientKey(request: Request): string {
  const forwardedFor = request.headers.get("x-forwarded-for");
  const first = forwardedFor?.split(",")[0]?.trim();
  return first !== undefined && first !== "" ? first : "unknown";
}

/** The 429 `GET /api/reviews` answers with, or `null` when the caller is inside the ceiling. */
export function browseRateLimited(request: Request): Response | null {
  if (browseRequests.allow(clientKey(request))) return null;
  return fail("Too many requests. Please try again in a minute.", 429);
}

/** The 429 `POST /api/reviews` answers with, or `null` when the caller is inside the ceiling. */
export function submitRateLimited(userId: string): Response | null {
  if (submitRequests.allow(userId)) return null;
  return fail("You've changed that a lot in a short time. Give it a minute and try again.", 429);
}

/** The 429 the report route answers with, or `null` when the caller is inside the ceiling. */
export function reportRateLimited(userId: string): Response | null {
  if (reportRequests.allow(userId)) return null;
  return fail("Too many reports in a short time. Give it a minute and try again.", 429);
}

/** Test seam: limiters outlive a single test, same rationale as `resetBrowseRateLimit`. */
export function resetReviewRateLimits(): void {
  browseRequests.reset();
  submitRequests.reset();
  reportRequests.reset();
}
