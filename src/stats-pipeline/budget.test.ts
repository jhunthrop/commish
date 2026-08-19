import { describe, expect, it, beforeEach, afterAll } from "vitest";
import Redis from "ioredis";
import type { Clock } from "@/domain/timing";
import { createRequestBudget } from "./budget";
import { STATS_INGESTION_CONFIG } from "./config";

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";

const INGESTION_CEILING = STATS_INGESTION_CONFIG.monthlyRequestBudget - STATS_INGESTION_CONFIG.reservedForBackfill;

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
    await expect(budget.reserve(40)).resolves.toBe(true);
    expect(await budget.remaining()).toBe(INGESTION_CEILING - 40);
  });

  it("denies a reservation that would exceed the ceiling, and a denial consumes nothing", async () => {
    const budget = createRequestBudget({ redis, clock: fixedClock });
    await expect(budget.reserve(INGESTION_CEILING)).resolves.toBe(true);
    const remainingBeforeDenial = await budget.remaining();
    expect(remainingBeforeDenial).toBe(0);

    await expect(budget.reserve(1)).resolves.toBe(false);
    expect(await budget.remaining()).toBe(remainingBeforeDenial);
  });

  it("rolls the ledger over with the month: reservations on either side of a boundary do not share a budget", async () => {
    const augustBudget = createRequestBudget({ redis, clock: clockAt(AUGUST_LATE) });
    const septemberBudget = createRequestBudget({ redis, clock: clockAt(SEPTEMBER) });

    await expect(augustBudget.reserve(INGESTION_CEILING)).resolves.toBe(true);
    expect(await augustBudget.remaining()).toBe(0);
    // September's ledger is untouched by August spending every last request it had.
    expect(await septemberBudget.remaining()).toBe(INGESTION_CEILING);
    await expect(septemberBudget.reserve(INGESTION_CEILING)).resolves.toBe(true);
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
    const budget = createRequestBudget({ redis: throwingRedis(), clock: fixedClock });
    await expect(budget.reserve(1)).resolves.toBe(false);
  });

  it("reports zero remaining, not a stale positive number, during an outage", async () => {
    const budget = createRequestBudget({ redis: throwingRedis(), clock: fixedClock });
    await expect(budget.remaining()).resolves.toBe(0);
  });
});
