import { fail } from "@/lib/api/respond";
import { createRateLimiter } from "@/lib/api/rate-limit";
import { MATCHMAKING_CONFIG } from "@/matchmaking/config";

/**
 * A per-IP ceiling on `GET /api/public/leagues` — the app's only unauthenticated read. Every
 * other rate-limited route in this app (the advisor pair, `_shared.ts` beside them) keys its
 * limiter on the signed-in caller's user id; this route has no caller identity to key on, so it
 * keys on the platform's forwarded-for header instead.
 *
 * Per-process and in-memory, same as `createRateLimiter`'s own docblock and `openPerUser` in
 * `src/lib/realtime/sse.ts`: this bounds one instance's blast radius, not a distributed budget,
 * and the key itself is a header the caller controls — a motivated scraper can rotate it. That
 * is an honest, accepted limitation for Phase 1's single-instance deployment, not a promise of
 * abuse-proofing; a durable, spoof-resistant ceiling belongs at the edge/CDN in a later phase.
 */
const browseRequests = createRateLimiter(MATCHMAKING_CONFIG.browseRateLimit);

/**
 * `X-Forwarded-For` may carry a comma-separated chain (client, then every proxy hop); the first
 * entry is the original client as the nearest trusted hop saw it. Falls back to one shared
 * bucket for every caller with no header at all (e.g. a direct connection in dev), which is
 * strictly more permissive than per-caller limiting, never less.
 */
function clientKey(request: Request): string {
  const forwardedFor = request.headers.get("x-forwarded-for");
  const first = forwardedFor?.split(",")[0]?.trim();
  return first !== undefined && first !== "" ? first : "unknown";
}

/** The 429 the browse route answers with, or `null` when the caller is inside the ceiling. */
export function browseRateLimited(request: Request): Response | null {
  if (browseRequests.allow(clientKey(request))) return null;
  return fail("Too many requests. Please try again in a minute.", 429);
}

/** Test seam: the limiter outlives a single test, same rationale as `resetAdvisorRateLimit`. */
export function resetBrowseRateLimit(): void {
  browseRequests.reset();
}
