import { ADVISOR_CONFIG } from "@/ai-advisor";
import { fail } from "@/lib/api/respond";
import { createRateLimiter } from "@/lib/api/rate-limit";

/**
 * ONE budget per user across BOTH advisor routes, because both spend the same two scarce
 * things: a full context assembly against Postgres and one Anthropic call. Splitting the
 * ceiling per route would double what a single caller can spend for no product reason.
 *
 * Per-process and in-memory on purpose — see `createRateLimiter`'s own docblock and
 * `openPerUser` in `src/lib/realtime/sse.ts`. The durable, budget-accounted spend ceiling is
 * Phase 6's; this bounds the blast radius on one instance until then.
 */
const advisorRequests = createRateLimiter({
  maxRequests: ADVISOR_CONFIG.maxRequestsPerWindow,
  windowMs: ADVISOR_CONFIG.rateLimitWindowMs,
});

/** The 429 both advisor routes answer with, or `null` when the caller is inside the ceiling. */
export function advisorRateLimited(userId: string): Response | null {
  if (advisorRequests.allow(userId)) return null;
  return fail("You've asked for a lot of advice at once. Give it a minute and try again.", 429);
}

/**
 * Test seam: the limiter outlives a single test, so route tests reset it between cases.
 *
 * `sse.test.ts` needs no equivalent for `openPerUser` because that ceiling's resource (a live
 * connection) releases itself on close — its `afterEach` aborts connections and the module's own
 * cleanup does the rest. A request-per-window ceiling has no analogous release: the window only
 * lapses with time, never with an action a test can trigger. `reset()` is not a one-off escape
 * hatch invented here — it is `RateLimiter`'s own sanctioned member (`src/lib/api/rate-limit.ts`,
 * "what a process restart does, made explicit so tests stay independent"); this just forwards it
 * for the one singleton instance both advisor routes share.
 */
export function resetAdvisorRateLimit(): void {
  advisorRequests.reset();
}
