import type Redis from "ioredis";
import type { Clock } from "@/domain/timing";
import { STATS_INGESTION_CONFIG } from "./config";

interface RequestBudgetDeps {
  readonly redis: Redis;
  readonly clock: Clock;
}

export interface RequestBudget {
  /**
   * Reserves `count` upstream requests against the current calendar month's ledger. Denies (and
   * consumes nothing) when the reservation would push the month's total past
   * `monthlyRequestBudget - reservedForBackfill`.
   */
  reserve(count: number): Promise<boolean>;
  /** Requests left in the current month's ingestion budget (the backfill reserve is excluded). */
  remaining(): Promise<number>;
}

/** The share of the monthly ceiling ingestion may spend; the rest is held for `npm run seed`. */
const INGESTION_CEILING = STATS_INGESTION_CONFIG.monthlyRequestBudget - STATS_INGESTION_CONFIG.reservedForBackfill;

/** `YYYY-MM`, derived from the injected clock so the ledger rolls over with the calendar month. */
function currentMonthKey(clock: Clock): string {
  return STATS_INGESTION_CONFIG.keys.budget(clock.now().slice(0, 7));
}

/**
 * `KEYS[1]` is the month's ledger key. `ARGV[1]` is the reservation count, `ARGV[2]` is the
 * ingestion ceiling, `ARGV[3]` is the key's TTL in seconds.
 *
 * This is a single Lua script, not three separate client round trips (INCRBY, then decide, then
 * maybe DECRBY), because a client-side sequence has a real window: a failure that lands *after*
 * the INCRBY succeeds but *before* the compensating DECRBY completes — the EXPIRE call throwing,
 * a dropped connection before the DECRBY reaches Redis — leaves the increment permanently
 * stranded in the ledger even though `reserve()` reports the reservation denied. Proved
 * empirically (a Proxy that lets INCRBY succeed and fails the next call): the ledger ends up
 * inflated and never recovers on its own.
 *
 * Redis runs a whole script as one atomic unit — no other command interleaves with it, and if any
 * `redis.call` inside it fails the script aborts as a whole rather than leaving a partial effect
 * visible outside it. Folding INCRBY, the fresh-key EXPIRE, the ceiling check, and the
 * compensating DECRBY into one EVAL therefore removes the window structurally: there is no
 * client-observable state between "counted" and "rolled back" for a failure to land in, because
 * from the client's point of view the whole reservation is a single request that either lands
 * (script ran to completion, INCRBY and any compensating DECRBY both took effect) or didn't
 * happen at all (the request never reached Redis, or Redis never executed it) — the same
 * single-round-trip failure shape as any lone command, not a multi-step sequence a failure can
 * land in the middle of.
 */
const RESERVE_SCRIPT = `
local total = redis.call("INCRBY", KEYS[1], ARGV[1])
if total == tonumber(ARGV[1]) then
  redis.call("EXPIRE", KEYS[1], ARGV[3])
end
if total > tonumber(ARGV[2]) then
  redis.call("DECRBY", KEYS[1], ARGV[1])
  return 0
end
return 1
`;

/**
 * The monthly upstream request ledger. `reserve()` runs as one atomic Lua script (see
 * `RESERVE_SCRIPT`) so a reservation is either fully counted or fully rolled back — never left
 * half-applied.
 *
 * Fails CLOSED on a Redis outage — the deliberate opposite of `score-cache.ts` (and
 * `reference-cache.ts`, and the realtime publisher), which all degrade OPEN. The two failures
 * are not symmetrical: a missed cache read or a lost publish costs milliseconds and is invisible
 * to the user, while a miscounted request budget costs the upstream API key. A skipped tick is
 * recoverable in half an hour; a suspended key is not recoverable at all.
 */
export function createRequestBudget({ redis, clock }: RequestBudgetDeps): RequestBudget {
  async function reserve(count: number): Promise<boolean> {
    try {
      const key = currentMonthKey(clock);
      const granted = await redis.eval(RESERVE_SCRIPT, 1, key, count, INGESTION_CEILING, STATS_INGESTION_CONFIG.ttlSeconds.budget);
      return granted === 1;
    } catch {
      return false;
    }
  }

  async function remaining(): Promise<number> {
    try {
      const used = await redis.get(currentMonthKey(clock));
      const usedCount = used === null ? 0 : Number(used);
      return Math.max(0, INGESTION_CEILING - usedCount);
    } catch {
      // Fails CLOSED here too: an unreadable ledger reports zero remaining rather than a
      // possibly-stale positive number a caller might reserve against.
      return 0;
    }
  }

  return { reserve, remaining };
}
