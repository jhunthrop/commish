import { getDraftStore } from "@/draft-service";
import type { Clock } from "@/domain/timing";
import { fail } from "@/lib/api/respond";
import { createRateLimiter } from "@/lib/api/rate-limit";
import { MOCK_CONFIG } from "@/mock-draft/config";
import type { MockLifecycleDeps } from "@/mock-draft-service/claim";

/** The outermost edge is the only place a wall clock is allowed — see every other route
 *  module's identical constant (`@/app/api/leagues/route.ts`, `.../invites/[code]/accept`). */
export const systemClock: Clock = { now: () => new Date().toISOString() };

/**
 * Invite codes are membership capabilities, so their randomness must be unpredictable —
 * `Math.random` is seedable/observable, so this derives a `[0, 1)` float from `crypto` instead.
 * Verbatim the `cryptoRandom` idiom `src/app/api/leagues/[leagueId]/invites/route.ts` already
 * uses for a real invite code; a mock room's share code admits strangers exactly the same way.
 */
function cryptoRandom(): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0]! / 2 ** 32;
}

/**
 * `mock_rooms.bot_seed` is a Postgres `integer` — SIGNED 32-bit, `-2147483648` to `2147483647` —
 * so the raw `crypto.getRandomValues` draw (unsigned) is reinterpreted with `| 0` rather than
 * stored as-is: a draw at or above `2^31` would otherwise overflow the column and the whole
 * creation transaction would roll back. `rngFor`'s own `seedForKey` (`@/mock-draft/rng`) treats
 * its seed as a raw 32-bit bit pattern either way (`(0x811c9dc5 ^ seed) >>> 0`), so a negative
 * signed value seeds it exactly as well as a positive one — nothing downstream cares about sign,
 * only Postgres's column type does. Crypto-derived so a room's whole bot behavior can never be
 * guessed from anything a caller controls.
 */
function cryptoSeed32(): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0]! | 0;
}

/** The real collaborators `createMockRoom` needs, assembled once at the edge — the wall clock,
 *  `crypto.randomUUID` ids, and the two `crypto`-derived draws above. Tests supply their own
 *  (`mockLifecycleDeps`, `@/mock-draft-service/test-support`); this is the ONE production
 *  builder, so the route never re-derives it inline. */
export function mockLifecycleDeps(): MockLifecycleDeps {
  return {
    store: getDraftStore(),
    clock: systemClock,
    newId: () => crypto.randomUUID(),
    newSeed: cryptoSeed32,
    random: cryptoRandom,
  };
}

/**
 * Per-user ceilings on the mock-drafts surface (`MOCK_CONFIG.rateLimit`). Every route behind
 * this domain requires a signed-in caller (no anonymous rooms), so each limiter is keyed on the
 * caller's own id — the identical shape `advisorRateLimited`
 * (`@/app/api/leagues/[leagueId]/advisor/_shared.ts`) already uses, never the forwarded-for
 * header the app's two genuinely unauthenticated reads key on
 * (`browseRateLimited`/`previewRateLimited`).
 */
const createRequests = createRateLimiter(MOCK_CONFIG.rateLimit.create);
const claimRequests = createRateLimiter(MOCK_CONFIG.rateLimit.claim);
const readRequests = createRateLimiter(MOCK_CONFIG.rateLimit.read);

/** The 429 `POST /api/mock-drafts` answers with, or `null` when the caller is inside the
 *  ceiling. */
export function createMockRateLimited(userId: string): Response | null {
  if (createRequests.allow(userId)) return null;
  return fail("You have started a lot of practice drafts at once. Please wait a minute and try again.", 429);
}

/** The 429 `POST /api/mock-drafts/[code]` answers with, or `null` when the caller is inside the
 *  ceiling. */
export function claimMockRateLimited(userId: string): Response | null {
  if (claimRequests.allow(userId)) return null;
  return fail("You have joined a lot of practice drafts at once. Please wait a minute and try again.", 429);
}

/** The 429 `GET /api/mock-drafts` and `GET /api/mock-drafts/[code]` share — one budget for both,
 *  the shared-read reasoning `MOCK_CONFIG.rateLimit.read`'s own docblock states. */
export function readMockRateLimited(userId: string): Response | null {
  if (readRequests.allow(userId)) return null;
  return fail("Too many requests. Please try again in a minute.", 429);
}

/** Test seam: every limiter outlives a single test, so route tests reset all three between
 *  cases — the same rationale as `resetAdvisorRateLimit`/`resetBrowseRateLimit`. */
export function resetMockRateLimits(): void {
  createRequests.reset();
  claimRequests.reset();
  readRequests.reset();
}
