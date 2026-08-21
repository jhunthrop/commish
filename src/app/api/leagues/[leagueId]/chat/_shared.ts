import { fail } from "@/lib/api/respond";
import { createRateLimiter } from "@/lib/api/rate-limit";
import { MODERATION_CONFIG } from "@/moderation/config";

/**
 * `POST /api/leagues/[leagueId]/chat/[messageId]/report`'s ceiling — keyed per user id, an
 * authenticated write. Copies `reportRequests` (`src/app/api/reviews/_shared.ts`) exactly: same
 * per-process, in-memory bound, same "one budget, per authenticated writer" shape.
 */
const reportRequests = createRateLimiter(MODERATION_CONFIG.chatReportRateLimit);

/** The 429 the chat report route answers with, or `null` when the caller is inside the ceiling. */
export function chatReportRateLimited(userId: string): Response | null {
  if (reportRequests.allow(userId)) return null;
  return fail("Too many reports in a short time. Give it a minute and try again.", 429);
}

/** Test seam: the limiter outlives a single test, same rationale as `resetReviewRateLimits`. */
export function resetChatReportRateLimit(): void {
  reportRequests.reset();
}
