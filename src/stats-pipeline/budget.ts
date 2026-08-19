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
 * The monthly upstream request ledger. INCRBY-backed so concurrent tick reservations serialize
 * through Redis rather than racing in process memory: two ticks that both read "5 remaining"
 * and both reserve 5 would overspend by 5 with a read-then-write implementation, and INCRBY does
 * the read and the write atomically.
 *
 * Fails CLOSED on a Redis outage — the opposite of the realtime publisher's degrade-open rule.
 * The two failures are not symmetrical: a missed cache read or a lost publish costs milliseconds
 * and is invisible to the user, while a miscounted request budget costs the upstream API key. A
 * skipped tick is recoverable in half an hour; a suspended key is not recoverable at all.
 */
export function createRequestBudget({ redis, clock }: RequestBudgetDeps): RequestBudget {
  async function reserve(count: number): Promise<boolean> {
    try {
      const key = currentMonthKey(clock);
      const total = await redis.incrby(key, count);
      // The first write to a fresh month's key: attach the TTL now so an abandoned month's
      // counter is not immortal. Every later reservation in the same month skips this — the key
      // already carries an expiry.
      if (total === count) await redis.expire(key, STATS_INGESTION_CONFIG.ttlSeconds.budget);
      if (total > INGESTION_CEILING) {
        // Denial consumes nothing: undo the increment before reporting failure.
        await redis.decrby(key, count);
        return false;
      }
      return true;
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
