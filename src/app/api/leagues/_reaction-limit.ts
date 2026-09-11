import { CHAT_CONFIG } from "@/chat/config";
import { fail } from "@/lib/api/respond";
import { createRateLimiter } from "@/lib/api/rate-limit";

/**
 * THE ONE CEILING BOTH REACTION ROUTES SHARE — `POST /api/leagues/[leagueId]/chat/[messageId]/reactions`
 * and `POST /api/leagues/[leagueId]/activity/[eventId]/reactions`. One limiter, not two, because a
 * reaction on a pick and a reaction on a message are the same act by the same person: two budgets
 * would mean a caller barred from one write path could keep hammering the other, which is not a
 * ceiling, it is a detour. Keyed per user id, an authenticated write, per process — the same bound
 * and the same honest limits `createRateLimiter`'s own docblock states.
 */
const reactionToggles = createRateLimiter(CHAT_CONFIG.reactionRateLimit);

/** The 429 a reaction route answers with, or `null` when the caller is inside the ceiling. */
export function reactionRateLimited(userId: string): Response | null {
  if (reactionToggles.allow(userId)) return null;
  return fail("That is a lot of reactions in a short time. Give it a minute.", 429);
}

/** Test seam: the limiter outlives a single test, same rationale as `resetChatReportRateLimit`. */
export function resetReactionRateLimit(): void {
  reactionToggles.reset();
}
