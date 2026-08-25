import { fail } from "@/lib/api/respond";
import { createRateLimiter } from "@/lib/api/rate-limit";
import { MONEY_CONFIG } from "@/money/config";

/**
 * Sibling parity with `preferencesRateLimited` (`src/app/api/preferences/_shared.ts`), copied
 * rather than re-invented: the deposit door is an authenticated per-user write that reaches an
 * external provider per call, so it gets the same per-process, in-memory ceiling — a
 * blast-radius bound on one instance, never a distributed budget (`createRateLimiter`'s own
 * docblock). The ceiling itself is config (`MONEY_CONFIG.deposit.rateLimit`), not a constant.
 */
const limiter = createRateLimiter(MONEY_CONFIG.deposit.rateLimit);

/** Keyed by user id: the deposit door is authenticated, so the user is the blast-radius unit. */
export function depositRateLimited(userId: string): Response | null {
  return limiter.allow(userId) ? null : fail("You have tried that a lot in a short time. Give it a minute and try again.", 429);
}

/** Test seam: the limiter outlives a single test, same rationale as `resetPreferencesRateLimit`. */
export function resetDepositRateLimit(): void {
  limiter.reset();
}
