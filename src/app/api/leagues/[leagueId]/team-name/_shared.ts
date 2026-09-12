import { IDENTITY_CONFIG } from "@/identity";
import { fail } from "@/lib/api/respond";
import { createRateLimiter } from "@/lib/api/rate-limit";

/**
 * THE SAME CEILING AS THE DISPLAY NAME (fix round 1, MEDIUM 5), and for the same reason ruling 12
 * gives that one: a team name is stored VERBATIM into rendered activity copy and is never
 * re-rendered, so a name changed in a loop writes a loop's worth of permanent sentences into
 * every member's feed. Its sibling league PUTs (slot-preference, settings) are unlimited and
 * rightly so — neither writes a string anybody else reads.
 *
 * `IDENTITY_CONFIG.profileRateLimit` rather than a second number: the two writes are the same
 * kind of write and the budget is named once. Per-process and in-memory, a blast-radius bound on
 * one instance rather than a distributed budget, exactly like `profileRateLimited` and the
 * advisor pair before it (see `createRateLimiter`'s own docblock).
 */
const limiter = createRateLimiter(IDENTITY_CONFIG.profileRateLimit);

/** Keyed by user id: a rename is authenticated, so the user is the right blast-radius unit. */
export function teamNameRateLimited(userId: string): Response | null {
  return limiter.allow(userId) ? null : fail("You have changed that a lot in a short time. Give it a minute and try again.", 429);
}

/** Test seam: the limiter outlives a single test, same rationale as `resetProfileRateLimit`. */
export function resetTeamNameRateLimit(): void {
  limiter.reset();
}
