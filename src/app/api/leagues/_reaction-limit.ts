import type Redis from "ioredis";
import { CHAT_CONFIG } from "@/chat/config";
import { fail } from "@/lib/api/respond";
import { getSharedRedis } from "@/lib/realtime/redis";

/**
 * One fixed window, in Redis, as one atomic script: count this request, put the window's expiry on
 * the key the first time it is used, and answer the running total.
 *
 * A script rather than INCR-then-EXPIRE for the reason `RESERVE_SCRIPT` (`@/stats-pipeline/budget`)
 * states at length: a client-side sequence has a real window between the two calls, and a failure
 * landing in it leaves a key that counts forever with no expiry. Redis runs a whole script as one
 * unit, so there is no client-observable state between "counted" and "given a lifetime".
 */
const COUNT_SCRIPT = `
local total = redis.call("INCR", KEYS[1])
if total == 1 then
  redis.call("PEXPIRE", KEYS[1], ARGV[1])
end
return total
`;

/**
 * The window this instant falls in. A fixed window, the same shape the in-memory limiter this
 * replaced had, and the same honesty: a caller can spend the ceiling at the end of one window and
 * again at the start of the next. That is a bound on a loop, not an accounting system.
 */
function windowKey(userId: string, at: number): string {
  return `reaction-rate:${userId}:${Math.floor(at / CHAT_CONFIG.reactionRateLimit.windowMs)}`;
}

/**
 * THE ONE CEILING BOTH REACTION ROUTES SHARE — `POST /api/leagues/[leagueId]/chat/[messageId]/reactions`
 * and `POST /api/leagues/[leagueId]/activity/[eventId]/reactions`.
 *
 * IN REDIS, NOT IN THIS PROCESS'S MEMORY. A reaction on a pick and a reaction on a message are the
 * same act by the same person, and two budgets would mean a caller barred from one path could keep
 * hammering the other. A module-scope counter could not deliver that on a platform where each route
 * handler is its own bundle and its own function instance: the two routes would simply never meet.
 * The store is the one every league surface already depends on for presence and the stream, so this
 * adds no dependency, only a key.
 *
 * IT FAILS CLOSED. Every other Redis reader in this codebase degrades OPEN because Postgres is
 * authoritative and Redis is an accelerator — that argument does not transfer to a ceiling. A
 * ceiling that answers "go ahead" when it cannot count is not a ceiling, and the failure it exists
 * to prevent (one authenticated caller looping a write endpoint) is exactly the situation in which
 * a struggling Redis is most likely. The refusal is in the room's own voice and names what to do.
 */
export async function reactionRateLimited(userId: string, redis: Redis = getSharedRedis()): Promise<Response | null> {
  const { maxRequests, windowMs } = CHAT_CONFIG.reactionRateLimit;
  let total: number;
  try {
    total = Number(await redis.eval(COUNT_SCRIPT, 1, windowKey(userId, Date.now()), String(windowMs)));
  } catch {
    return fail("We could not count that one just now. Give it a second and try again.", 503);
  }
  if (total <= maxRequests) return null;
  return fail("That is a lot of reactions in a short time. Give it a minute.", 429);
}

/**
 * Test seam: clears one person's current and previous window, which is every window a test can
 * still be inside. `reset()` on the in-memory limiter this replaced dropped every key in the
 * process; a shared store has no such thing, and scanning for one would be a pattern scan against
 * a production keyspace for a test's convenience.
 */
export async function resetReactionRateLimitFor(userId: string, redis: Redis = getSharedRedis()): Promise<void> {
  const now = Date.now();
  await redis.del(windowKey(userId, now), windowKey(userId, now - CHAT_CONFIG.reactionRateLimit.windowMs));
}
