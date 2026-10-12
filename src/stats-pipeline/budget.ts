import type Redis from "ioredis";
import type { Clock } from "@research/domain/timing";
import { STATS_INGESTION_CONFIG } from "./config";

interface RequestBudgetDeps {
  readonly redis: Redis;
  readonly clock: Clock;
  /**
   * The day's ceiling across ingestion AND backfill — daily because RapidAPI meters the Tank01
   * plans per day (founder correction, 2026-08-30). Defaults to the shipped config; the edge
   * (`./index.ts`) passes `STATS_DAILY_REQUEST_BUDGET` when an operator has set it. Injected
   * rather than read from `process.env` in here, so this module stays a pure function of its
   * dependencies and a test can drive a small ceiling without touching the environment.
   */
  readonly dailyRequestBudget?: number;
  /**
   * Whether the configured provider's calls actually cost anything upstream
   * (`StatsProvider.requestCost`). Defaults to true.
   *
   * An unmetered ledger grants everything and touches Redis for nothing, because there is nothing
   * to protect: the mock provider answers out of a committed JSON file and never reaches a
   * network, so debiting it spends a real ceiling against imaginary requests. The failure that
   * caused was quiet and confusing — ten `npm run seed` runs exhausted the ceiling and
   * the dev worker simply stopped ticking, recoverable only by deleting a Redis key. The flag is
   * config carried by the provider, not a name check at the call site.
   */
  readonly metered?: boolean;
}

/**
 * Why a reservation was refused. Two causes, two different things an operator does about them:
 * an exhausted ledger means the day's quota is spent (raise `STATS_DAILY_REQUEST_BUDGET` to the
 * purchased daily quota, or wait for the day to roll over), while an unreachable ledger means Redis is down and the pipeline is
 * refusing to guess (fix Redis). They used to be indistinguishable in the tick log, which is one
 * page and one pager apart.
 */
export type ReservationDenial = "budget-exhausted" | "ledger-unavailable";

export type Reservation = { readonly granted: true } | { readonly granted: false; readonly denial: ReservationDenial };

const GRANTED: Reservation = { granted: true };

export interface RequestBudget {
  /**
   * Reserves `count` upstream requests against the current calendar day's ledger (UTC), for the
   * INGESTION share of it. Denies (and consumes nothing) when the reservation would push the
   * day's total past `dailyRequestBudget - reservedForBackfill`.
   */
  reserve(count: number): Promise<Reservation>;
  /**
   * Reserves against the same day's ledger for a season BACKFILL (`npm run seed`), which is
   * allowed the whole `dailyRequestBudget` rather than the ingestion share. That is what makes
   * `reservedForBackfill` an actual reservation instead of only a reduction of the ingestion
   * ceiling: ingestion can never eat the headroom the backfill needs, and the backfill can never
   * take the day past the quota, because both count into one key.
   */
  reserveBackfill(count: number): Promise<Reservation>;
  /** Requests left in the current day's ingestion budget (the backfill reserve is excluded). */
  remaining(): Promise<number>;
}

/**
 * Reserves `count` backfill requests or fails LOUDLY, for the operator-run spenders
 * (`seedPlayers`, `ingestAdp`) that must stop rather than half-finish: a partially backfilled
 * table looks exactly like a complete one to every reader. One message, shared, so the operator
 * remedy — raise `STATS_DAILY_REQUEST_BUDGET` to the purchased daily quota, or wait for the day
 * to roll over — reads identically wherever the ledger says no.
 */
export async function reserveBackfillOrThrow(
  budget: Pick<RequestBudget, "reserveBackfill">,
  count: number,
  what: string,
): Promise<void> {
  const reservation = await budget.reserveBackfill(count);
  if (reservation.granted) return;
  throw new Error(
    `The daily upstream request budget could not cover ${what} (${count} requests, denied: ${reservation.denial}). ` +
      `Raise STATS_DAILY_REQUEST_BUDGET to the purchased daily quota, or wait for the day to roll over (the upstream quota resets daily).`,
  );
}

/** `YYYY-MM-DD` (UTC), derived from the injected clock so the ledger rolls over with the daily quota. */
function currentDayKey(clock: Clock): string {
  return STATS_INGESTION_CONFIG.keys.budget(clock.now().slice(0, 10));
}

/**
 * `KEYS[1]` is the day's ledger key. `ARGV[1]` is the reservation count, `ARGV[2]` is the
 * ceiling this reservation is measured against, `ARGV[3]` is the key's TTL in seconds.
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
 * The daily upstream request ledger. `reserve()` runs as one atomic Lua script (see
 * `RESERVE_SCRIPT`) so a reservation is either fully counted or fully rolled back — never left
 * half-applied.
 *
 * Callers reserve what they are ACTUALLY about to spend, never a worst case: there is no release
 * path, by design (a release is a second round trip that can be lost, and a lost release is a
 * permanently over-counted ledger). The worker earns that by reserving in two phases — the
 * schedule calls it is about to make, then, once the schedules are in hand, the exact box scores
 * it has decided to fetch. See `worker.ts`'s `tick`.
 *
 * Fails CLOSED on a Redis outage — the deliberate opposite of `score-cache.ts` (and
 * `reference-cache.ts`, and the realtime publisher), which all degrade OPEN. The two failures
 * are not symmetrical: a missed cache read or a lost publish costs milliseconds and is invisible
 * to the user, while a miscounted request budget costs the upstream API key. A skipped tick is
 * recoverable in half an hour; a suspended key is not recoverable at all.
 */
export function createRequestBudget({
  redis,
  clock,
  dailyRequestBudget = STATS_INGESTION_CONFIG.dailyRequestBudget,
  metered = true,
}: RequestBudgetDeps): RequestBudget {
  /** The share of the day's ceiling ingestion may spend; the rest is held for `npm run seed`. */
  const ingestionCeiling = dailyRequestBudget - STATS_INGESTION_CONFIG.reservedForBackfill;

  if (!metered) {
    return {
      reserve: async () => GRANTED,
      reserveBackfill: async () => GRANTED,
      // The whole ceiling, always: nothing has been spent because nothing this provider does
      // costs anything. Reporting a falling number would be reporting fiction.
      remaining: async () => ingestionCeiling,
    };
  }

  async function reserveAgainst(count: number, ceiling: number): Promise<Reservation> {
    try {
      const key = currentDayKey(clock);
      const granted = await redis.eval(RESERVE_SCRIPT, 1, key, count, ceiling, STATS_INGESTION_CONFIG.ttlSeconds.budget);
      return granted === 1 ? GRANTED : { granted: false, denial: "budget-exhausted" };
    } catch {
      return { granted: false, denial: "ledger-unavailable" };
    }
  }

  return {
    reserve: (count: number) => reserveAgainst(count, ingestionCeiling),
    reserveBackfill: (count: number) => reserveAgainst(count, dailyRequestBudget),

    async remaining(): Promise<number> {
      try {
        const used = await redis.get(currentDayKey(clock));
        const usedCount = used === null ? 0 : Number(used);
        return Math.max(0, ingestionCeiling - usedCount);
      } catch {
        // Fails CLOSED here too: an unreadable ledger reports zero remaining rather than a
        // possibly-stale positive number a caller might reserve against.
        return 0;
      }
    },
  };
}
