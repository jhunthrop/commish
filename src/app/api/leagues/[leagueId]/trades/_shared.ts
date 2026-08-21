import { fail } from "@/lib/api/respond";
import { createRateLimiter } from "@/lib/api/rate-limit";
import { TRADE_CONFIG } from "@/trades/config";

/**
 * ONE budget per user across every trade route: proposing, withdrawing and rejecting (and,
 * once Task 5 wires it, accepting) all spend the same scarce resource — a multi-table
 * transaction against this league — the same "one budget across sibling routes" call
 * `advisorRateLimited` (`@/app/api/leagues/[leagueId]/advisor/_shared`) and
 * `INTEGRITY_CONFIG.notices.rateLimit` both make.
 */
const tradeRequests = createRateLimiter(TRADE_CONFIG.rateLimit);

/** The 429 every trade route answers with, or `null` when the caller is inside the ceiling. */
export function tradeRateLimited(userId: string): Response | null {
  if (tradeRequests.allow(userId)) return null;
  return fail("Too many trade actions in a short time. Give it a minute and try again.", 429);
}

/** Test seam: the limiter outlives a single test, so route tests reset it between cases. */
export function resetTradeRateLimit(): void {
  tradeRequests.reset();
}
