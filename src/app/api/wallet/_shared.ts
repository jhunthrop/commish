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

/** The KYC submit door's own limiter — same shape as `limiter` above, `MONEY_CONFIG.kyc.rateLimit`. */
const kycLimiter = createRateLimiter(MONEY_CONFIG.kyc.rateLimit);

export function kycRateLimited(userId: string): Response | null {
  return kycLimiter.allow(userId) ? null : fail("You have tried that a lot in a short time. Give it a minute and try again.", 429);
}

export function resetKycRateLimit(): void {
  kycLimiter.reset();
}

/** The self-exclusion door's own limiter — same shape, `MONEY_CONFIG.exclusion.rateLimit`. */
const exclusionLimiter = createRateLimiter(MONEY_CONFIG.exclusion.rateLimit);

export function exclusionRateLimited(userId: string): Response | null {
  return exclusionLimiter.allow(userId) ? null : fail("You have tried that a lot in a short time. Give it a minute and try again.", 429);
}

export function resetExclusionRateLimit(): void {
  exclusionLimiter.reset();
}
