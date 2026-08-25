import { describe, expect, it, beforeEach, afterAll } from "vitest";
import Redis from "ioredis";
import type { Clock } from "@/domain/timing";
import { createRequestBudget, reserveBackfillOrThrow } from "./budget";
import { STATS_INGESTION_CONFIG } from "./config";

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";

const INGESTION_CEILING = STATS_INGESTION_CONFIG.monthlyRequestBudget - STATS_INGESTION_CONFIG.reservedForBackfill;
const GRANTED = { granted: true };
const EXHAUSTED = { granted: false, denial: "budget-exhausted" };
const UNAVAILABLE = { granted: false, denial: "ledger-unavailable" };

const AUGUST = "2026-08-17T12:00:00.000Z";
const AUGUST_LATE = "2026-08-31T23:00:00.000Z";
const SEPTEMBER = "2026-09-01T01:00:00.000Z";

const clockAt = (iso: string): Clock => ({ now: () => iso });
const fixedClock = clockAt(AUGUST);

function keyFor(iso: string): string {
  return STATS_INGESTION_CONFIG.keys.budget(iso.slice(0, 7));
}

/** A connection that throws on every command — models a Redis outage without touching docker. */
function throwingRedis(): Redis {
  return new Redis("redis://localhost:1", { maxRetriesPerRequest: 0, lazyConnect: true, enableOfflineQueue: false });
}

/**
 * A real, working connection whose `eval` call throws before the script ever reaches Redis —
 * models a client-side failure on the one round trip `reserve()` now makes (an `EVAL`), the same
 * way `throwingRedis()` models the connection being down for every command. Every other command
 * (used by `control` for verification) passes through untouched.
 */
function evalThrowingRedis(base: Redis): Redis {
  return new Proxy(base, {
    get(target, prop, receiver: unknown) {
      if (prop === "eval") {
        return (): never => {
          throw new Error("simulated eval failure");
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  });
}

const control = new Redis(REDIS_URL);
const redis = new Redis(REDIS_URL);

beforeEach(async () => {
  await control.del(keyFor(AUGUST), keyFor(SEPTEMBER));
});

afterAll(async () => {
  await control.del(keyFor(AUGUST), keyFor(SEPTEMBER));
  control.disconnect();
  redis.disconnect();
});

describe("createRequestBudget", () => {
  it("grants a reservation on a fresh month and remaining() drops by exactly that many", async () => {
    const budget = createRequestBudget({ redis, clock: fixedClock });
    expect(await budget.remaining()).toBe(INGESTION_CEILING);
    await expect(budget.reserve(40)).resolves.toEqual(GRANTED);
    expect(await budget.remaining()).toBe(INGESTION_CEILING - 40);
  });

  it("denies a reservation that would exceed the ceiling, and a denial consumes nothing", async () => {
    const budget = createRequestBudget({ redis, clock: fixedClock });
    await expect(budget.reserve(INGESTION_CEILING)).resolves.toEqual(GRANTED);
    const remainingBeforeDenial = await budget.remaining();
    expect(remainingBeforeDenial).toBe(0);

    await expect(budget.reserve(1)).resolves.toEqual(EXHAUSTED);
    expect(await budget.remaining()).toBe(remainingBeforeDenial);
  });

  it("rolls the ledger over with the month: reservations on either side of a boundary do not share a budget", async () => {
    const augustBudget = createRequestBudget({ redis, clock: clockAt(AUGUST_LATE) });
    const septemberBudget = createRequestBudget({ redis, clock: clockAt(SEPTEMBER) });

    await expect(augustBudget.reserve(INGESTION_CEILING)).resolves.toEqual(GRANTED);
    expect(await augustBudget.remaining()).toBe(0);
    // September's ledger is untouched by August spending every last request it had.
    expect(await septemberBudget.remaining()).toBe(INGESTION_CEILING);
    await expect(septemberBudget.reserve(INGESTION_CEILING)).resolves.toEqual(GRANTED);
  });

  it("carries a TTL, so an abandoned month's counter is not immortal", async () => {
    const budget = createRequestBudget({ redis, clock: fixedClock });
    await budget.reserve(1);
    const ttl = await control.ttl(keyFor(AUGUST));
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(STATS_INGESTION_CONFIG.ttlSeconds.budget);
  });

  it("refuses to spend when it cannot count what it has spent", async () => {
    // The score cache degrades OPEN on a Redis outage (slower, still correct). The budget
    // degrades CLOSED, because the two failures are not symmetrical: a missed cache read costs
    // milliseconds and a miscounted request budget costs the API key. A skipped tick is
    // recoverable in five minutes; a suspended key is not recoverable at all.
    const dead = throwingRedis();
    try {
      const budget = createRequestBudget({ redis: dead, clock: fixedClock });
      await expect(budget.reserve(1)).resolves.toEqual(UNAVAILABLE);
    } finally {
      dead.disconnect();
    }
  });

  it("reports zero remaining, not a stale positive number, during an outage", async () => {
    const dead = throwingRedis();
    try {
      const budget = createRequestBudget({ redis: dead, clock: fixedClock });
      await expect(budget.remaining()).resolves.toBe(0);
    } finally {
      dead.disconnect();
    }
  });

  it("an eval that throws consumes nothing: the ledger key is left unchanged", async () => {
    // reserve() now makes exactly one Redis round trip (RESERVE_SCRIPT). A failure on that
    // single call can no longer land between "counted" and "rolled back" the way the old
    // INCRBY-then-decide-then-DECRBY sequence could — there is nothing left to roll back,
    // because the script (and therefore the INCRBY inside it) never ran.
    const key = keyFor(AUGUST);
    const budget = createRequestBudget({ redis: evalThrowingRedis(redis), clock: fixedClock });
    await expect(budget.reserve(5)).resolves.toEqual(UNAVAILABLE);
    expect(await control.exists(key)).toBe(0);
  });

  it("under concurrent reservations that together exceed what's left near the ceiling, grants exactly one", async () => {
    // The atomic Lua script serializes the ceiling check and the increment on Redis's side, so
    // two callers racing for the last 5 requests can't both win — the same property the reviewer
    // verified empirically against real Redis before this fix, now asserted as a test.
    const budget = createRequestBudget({ redis, clock: fixedClock });
    await expect(budget.reserve(INGESTION_CEILING - 5)).resolves.toEqual(GRANTED);
    const [first, second] = await Promise.all([budget.reserve(5), budget.reserve(5)]);
    expect([first, second].filter((result) => result.granted)).toHaveLength(1);
    expect(await budget.remaining()).toBe(0);
  });

  it("the backfill draws on the whole monthly quota, not the ingestion share, and both count into one ledger", async () => {
    // `reservedForBackfill` is only a real reservation if the backfill can actually reach it:
    // ingestion is capped at (monthly - reserved), so whatever ingestion leaves untouched at that
    // cap is exactly what a backfill can still spend, and the two together can never exceed the
    // month's quota because they increment the same key.
    const budget = createRequestBudget({ redis, clock: fixedClock });
    await expect(budget.reserve(INGESTION_CEILING)).resolves.toEqual(GRANTED);
    await expect(budget.reserve(1)).resolves.toEqual(EXHAUSTED);

    await expect(budget.reserveBackfill(STATS_INGESTION_CONFIG.reservedForBackfill)).resolves.toEqual(GRANTED);
    await expect(budget.reserveBackfill(1)).resolves.toEqual(EXHAUSTED);
    expect(Number(await control.get(keyFor(AUGUST)))).toBe(STATS_INGESTION_CONFIG.monthlyRequestBudget);
  });

  it("an unreachable ledger denies a backfill too, rather than letting the largest write in the repo spend uncounted", async () => {
    const dead = throwingRedis();
    try {
      const budget = createRequestBudget({ redis: dead, clock: fixedClock });
      await expect(budget.reserveBackfill(2)).resolves.toEqual(UNAVAILABLE);
    } finally {
      dead.disconnect();
    }
  });

  it("honors an injected monthly ceiling, which is how STATS_MONTHLY_REQUEST_BUDGET reaches the ledger", async () => {
    // The operator lever C2 wired: the edge resolves the env var and hands the number here. A
    // ceiling of 310 leaves 2 for ingestion once the backfill reserve is held back.
    const budget = createRequestBudget({
      redis,
      clock: fixedClock,
      monthlyRequestBudget: STATS_INGESTION_CONFIG.reservedForBackfill + 2,
    });
    expect(await budget.remaining()).toBe(2);
    await expect(budget.reserve(2)).resolves.toEqual(GRANTED);
    await expect(budget.reserve(1)).resolves.toEqual(EXHAUSTED);
  });

  it("counts nothing at all for a provider whose calls never leave the process", async () => {
    // The ledger exists to protect a paid API key. The mock answers out of a committed JSON file,
    // so debiting it spends a real ceiling on imaginary requests — and the failure that caused was
    // quiet: ten `npm run seed` runs in a month exhausted the ceiling and the dev worker simply
    // stopped ticking, recoverable only by deleting a Redis key.
    const key = keyFor(AUGUST);
    const budget = createRequestBudget({ redis, clock: fixedClock, metered: false });

    await expect(budget.reserve(STATS_INGESTION_CONFIG.monthlyRequestBudget * 10)).resolves.toEqual(GRANTED);
    await expect(budget.reserveBackfill(STATS_INGESTION_CONFIG.monthlyRequestBudget * 10)).resolves.toEqual(GRANTED);
    // Not "granted and counted" — the ledger key is never touched at all.
    expect(await control.exists(key)).toBe(0);
    // And it reports the whole ceiling, because nothing has been spent. A falling number here
    // would be reporting fiction.
    expect(await budget.remaining()).toBe(INGESTION_CEILING);
  });
});

describe("reserveBackfillOrThrow", () => {
  it("resolves silently when the ledger grants the reservation", async () => {
    const granting = { reserveBackfill: async () => ({ granted: true as const }) };
    await expect(reserveBackfillOrThrow(granting, 3, "the ADP feed")).resolves.toBeUndefined();
  });

  it("throws naming what was refused, the count, the denial and the operator remedy", async () => {
    const denying = {
      reserveBackfill: async () => ({ granted: false as const, denial: "ledger-unavailable" as const }),
    };
    await expect(reserveBackfillOrThrow(denying, 3, "the ADP feed")).rejects.toThrow(
      /the ADP feed \(3 requests, denied: ledger-unavailable\).*STATS_MONTHLY_REQUEST_BUDGET/,
    );
  });
});
