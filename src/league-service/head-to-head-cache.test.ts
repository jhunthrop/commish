import { describe, it, expect, beforeEach, afterAll } from "vitest";
import Redis from "ioredis";
import { LEAGUE_CONFIG, type HeadToHeadRecord } from "@/league";
import { createHeadToHeadCache, NOOP_HEAD_TO_HEAD_CACHE } from "./head-to-head-cache";

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
const LEAGUE = "league_h2h_cache_test";
const WEEK = 5;
const KEY = LEAGUE_CONFIG.headToHead.cacheKey(LEAGUE, WEEK);

const RECORDS: ReadonlyMap<string, HeadToHeadRecord> = new Map([
  ["t_me|t_rey", { wins: 4, losses: 1, ties: 0, seasons: [2026] }],
  ["t_rey|t_me", { wins: 1, losses: 4, ties: 0, seasons: [2026] }],
]);

/** A connection that cannot reach anything — models an outage without touching docker. */
function throwingRedis(): Redis {
  return new Redis("redis://localhost:1", { maxRetriesPerRequest: 0, lazyConnect: true, enableOfflineQueue: false });
}

const control = new Redis(REDIS_URL);
const redis = new Redis(REDIS_URL);

beforeEach(async () => {
  await control.del(KEY);
});

afterAll(async () => {
  await control.del(KEY);
  control.disconnect();
  redis.disconnect();
});

describe("createHeadToHeadCache", () => {
  it("writes then reads back the whole league's pairs", async () => {
    const cache = createHeadToHeadCache({ redis });
    await cache.write(LEAGUE, WEEK, RECORDS);
    const held = await cache.read(LEAGUE, WEEK);
    expect(held?.get("t_me|t_rey")).toEqual({ wins: 4, losses: 1, ties: 0, seasons: [2026] });
    expect(held?.size).toBe(2);
  });

  it("sets the configured expiry, so a settle that never fires still ages out", async () => {
    const cache = createHeadToHeadCache({ redis });
    await cache.write(LEAGUE, WEEK, RECORDS);
    const ttl = await control.ttl(KEY);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(LEAGUE_CONFIG.headToHead.cacheTtlSeconds);
  });

  it("misses on a key nobody has written", async () => {
    expect(await createHeadToHeadCache({ redis }).read(LEAGUE, WEEK)).toBeNull();
  });

  it("misses on a value that is not JSON, rather than throwing", async () => {
    await control.set(KEY, "not json at all");
    expect(await createHeadToHeadCache({ redis }).read(LEAGUE, WEEK)).toBeNull();
  });

  it("misses on JSON of the wrong shape, rather than handing a card a half-record", async () => {
    await control.set(KEY, JSON.stringify([["t_me|t_rey", { wins: 4 }]]));
    expect(await createHeadToHeadCache({ redis }).read(LEAGUE, WEEK)).toBeNull();
    await control.set(KEY, JSON.stringify({ notAnArray: true }));
    expect(await createHeadToHeadCache({ redis }).read(LEAGUE, WEEK)).toBeNull();
    await control.set(KEY, JSON.stringify([["t_me|t_rey", { wins: 1, losses: 0, ties: 0, seasons: ["2026"] }]]));
    expect(await createHeadToHeadCache({ redis }).read(LEAGUE, WEEK)).toBeNull();
    await control.set(KEY, JSON.stringify([["t_me|t_rey"]]));
    expect(await createHeadToHeadCache({ redis }).read(LEAGUE, WEEK)).toBeNull();
    await control.set(KEY, JSON.stringify(["t_me|t_rey", null]));
    expect(await createHeadToHeadCache({ redis }).read(LEAGUE, WEEK)).toBeNull();
  });

  it("drops the key a settling week names, and only that one", async () => {
    const cache = createHeadToHeadCache({ redis });
    await cache.write(LEAGUE, WEEK, RECORDS);
    await cache.write(LEAGUE, WEEK + 1, RECORDS);
    try {
      await cache.invalidate(LEAGUE, WEEK);
      expect(await cache.read(LEAGUE, WEEK)).toBeNull();
      expect(await cache.read(LEAGUE, WEEK + 1)).not.toBeNull();
    } finally {
      await control.del(LEAGUE_CONFIG.headToHead.cacheKey(LEAGUE, WEEK + 1));
    }
  });

  it("degrades open on a dead Redis, on every method", async () => {
    const dead = throwingRedis();
    const cache = createHeadToHeadCache({ redis: dead });
    try {
      expect(await cache.read(LEAGUE, WEEK)).toBeNull();
      await expect(cache.write(LEAGUE, WEEK, RECORDS)).resolves.toBeUndefined();
      await expect(cache.invalidate(LEAGUE, WEEK)).resolves.toBeUndefined();
    } finally {
      dead.disconnect();
    }
  });

  it("has a do-nothing default for a caller with no Redis wired", async () => {
    await expect(NOOP_HEAD_TO_HEAD_CACHE.invalidate(LEAGUE, WEEK)).resolves.toBeUndefined();
  });
});
