import { IDENTITY_CONFIG } from "@/identity";
import { fail } from "@/lib/api/respond";
import { createRateLimiter } from "@/lib/api/rate-limit";

/**
 * Follows the advisor pair's exact pattern (`src/app/api/leagues/[leagueId]/advisor/_shared.ts`)
 * for the same reason: per-process, in-memory, and a blast-radius bound on one instance rather
 * than a distributed budget — see `createRateLimiter`'s own docblock.
 */
const limiter = createRateLimiter(IDENTITY_CONFIG.profileRateLimit);

/** Keyed by user id: a profile write is authenticated, so the user is the right blast-radius unit. */
export function profileRateLimited(userId: string): Response | null {
  return limiter.allow(userId) ? null : fail("You have changed that a lot in a short time. Give it a minute and try again.", 429);
}

/** Test seam: the limiter outlives a single test, same rationale as `resetAdvisorRateLimit`. */
export function resetProfileRateLimit(): void {
  limiter.reset();
}
