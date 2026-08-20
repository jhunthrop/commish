import { INTEGRITY_CONFIG } from "@/integrity/config";
import { fail } from "@/lib/api/respond";
import { createRateLimiter } from "@/lib/api/rate-limit";

/**
 * ONE budget across both `GET /api/notices` and `POST /api/notices/read`, same rationale as
 * `advisorRateLimited` (`src/app/api/leagues/[leagueId]/advisor/_shared.ts`, "ONE budget per
 * user across BOTH routes"): both spend the same scarce resource, a Postgres round trip for
 * this caller's own notices, so splitting the ceiling per route would double what a single
 * caller can spend for no product reason. `GET /api/notices/stream` needs no entry here — its
 * own ceiling is the shared SSE connection cap (`REALTIME_CONFIG.maxStreamsPerUser`).
 *
 * Per-process and in-memory on purpose — see `createRateLimiter`'s own docblock and
 * `profileRateLimited` (`src/app/api/profile/_shared.ts`), whose singleton-plus-test-reset
 * shape this copies exactly.
 */
const limiter = createRateLimiter(INTEGRITY_CONFIG.notices.rateLimit);

/** The ceiling itself, for tests that need to loop past it without duplicating the number. */
export const NOTICES_RATE_LIMIT = INTEGRITY_CONFIG.notices.rateLimit.maxRequests;

/** Keyed by user id: both notices routes are authenticated reads/writes of the caller's own data. */
export function noticesRateLimited(userId: string): Response | null {
  return limiter.allow(userId)
    ? null
    : fail("You've checked your notices a lot in a short time. Give it a minute and try again.", 429);
}

/** Test seam: the limiter outlives a single test, same rationale as `resetProfileRateLimit`. */
export function resetNoticesRateLimit(): void {
  limiter.reset();
}
