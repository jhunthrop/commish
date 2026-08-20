import { fail } from "@/lib/api/respond";
import { createRateLimiter } from "@/lib/api/rate-limit";
import { LEAGUE_CONFIG } from "@/league";

/**
 * A per-IP ceiling on `GET /api/invites/[code]` — the app's second unauthenticated read,
 * alongside `GET /api/public/leagues`. Same shape and the same rationale as that route's own
 * `browseRateLimited` (`src/app/api/public/leagues/_shared.ts`): there is no signed-in caller
 * to key a limiter on, so this keys on the platform's forwarded-for header instead. See that
 * file's docblock for exactly what a per-process, in-memory, per-IP ceiling does and does not
 * guarantee.
 */
const previewRequests = createRateLimiter(LEAGUE_CONFIG.invite.previewRateLimit);

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

/** The 429 the invite preview route answers with, or `null` when the caller is inside the ceiling. */
export function previewRateLimited(request: Request): Response | null {
  if (previewRequests.allow(clientKey(request))) return null;
  return fail("Too many requests. Please try again in a minute.", 429);
}

/** Test seam: the limiter outlives a single test, same rationale as `resetBrowseRateLimit`. */
export function resetInvitePreviewRateLimit(): void {
  previewRequests.reset();
}
