import { z } from "zod";
import { fail } from "@/lib/api/respond";
import { createRateLimiter } from "@/lib/api/rate-limit";
import { SEARCH_CONFIG } from "@/search/config";

const limiter = createRateLimiter(SEARCH_CONFIG.rateLimit);

/** The one boundary the query crosses: a string inside the configured bounds, nothing else. */
export const searchQuerySchema = z.object({
  q: z.string().trim().min(SEARCH_CONFIG.minQueryLength, "Type something to search for.").max(SEARCH_CONFIG.maxQueryLength, "That is longer than any name or team."),
});

export function searchRateLimited(userId: string): Response | null {
  return limiter.allow(userId) ? null : fail("You have searched a lot in a short time. Give it a minute and try again.", 429);
}

export function resetSearchRateLimit(): void {
  limiter.reset();
}
