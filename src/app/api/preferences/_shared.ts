import { IDENTITY_CONFIG } from "@/identity";
import { fail } from "@/lib/api/respond";
import { createRateLimiter } from "@/lib/api/rate-limit";

/**
 * Sibling parity with `profileRateLimited` (`src/app/api/profile/_shared.ts`), which this
 * copies exactly rather than inventing a second pattern. Both routes are authenticated per-user
 * writes; this one opens a three-statement transaction per call and had no ceiling at all.
 * Per-process and in-memory, a blast-radius bound on one instance rather than a distributed
 * budget — see `createRateLimiter`'s own docblock.
 */
const limiter = createRateLimiter(IDENTITY_CONFIG.preferencesRateLimit);

/** Keyed by user id: a preferences write is authenticated, so the user is the blast-radius unit. */
export function preferencesRateLimited(userId: string): Response | null {
  return limiter.allow(userId) ? null : fail("You've changed that a lot in a short time. Give it a minute and try again.", 429);
}

/** Test seam: the limiter outlives a single test, same rationale as `resetProfileRateLimit`. */
export function resetPreferencesRateLimit(): void {
  limiter.reset();
}
