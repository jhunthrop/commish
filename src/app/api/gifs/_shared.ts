import { GIF_CONFIG } from "@/gifs/config";
import { fail } from "@/lib/api/respond";
import { createRateLimiter } from "@/lib/api/rate-limit";

/**
 * `GET /api/gifs/search`'s ceiling, keyed per user id — the same pattern as `advisorRateLimited`
 * (`src/app/api/leagues/[leagueId]/advisor/_shared.ts`) and for the same reason: this bounds
 * spend against a real, paid-per-call upstream quota once `GIPHY_API_KEY` exists, not only
 * server load. Per-process and in-memory on purpose — see `createRateLimiter`'s own docblock.
 */
const searchRequests = createRateLimiter(GIF_CONFIG.searchRateLimit);

/** The 429 the search route answers with, or `null` when the caller is inside the ceiling. */
export function gifSearchRateLimited(userId: string): Response | null {
  if (searchRequests.allow(userId)) return null;
  return fail("You've searched for a lot of GIFs at once. Give it a minute and try again.", 429);
}

/** Test seam: the limiter outlives a single test, so route tests reset it between cases. */
export function resetGifSearchRateLimit(): void {
  searchRequests.reset();
}
