import { describe, it, expect, beforeEach, afterAll } from "vitest";
import Redis from "ioredis";
import { createScoreCache } from "./score-cache";
import { STATS_INGESTION_CONFIG } from "./config";
import type { TeamScore } from "./contract";

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";

const LEAGUE = "league_score_cache_test";
const WEEK = 4;

function keyFor(leagueId: string, week: number): string {
  return STATS_INGESTION_CONFIG.keys.score(leagueId, week);
}

const SCORES: readonly TeamScore[] = [
  { teamId: "t1", points: 101.4 },
  { teamId: "t2", points: 88.2 },
];

/** A connection that throws on every command — models a Redis outage without touching docker. */
function throwingRedis(): Redis {
  return new Redis("redis://localhost:1", { maxRetriesPerRequest: 0, lazyConnect: true, enableOfflineQueue: false });
}

const control = new Redis(REDIS_URL);
const redis = new Redis(REDIS_URL);

beforeEach(async () => {
  await control.del(keyFor(LEAGUE, WEEK));
});

afterAll(async () => {
  await control.del(keyFor(LEAGUE, WEEK));
  control.disconnect();
  redis.disconnect();
});

describe("createScoreCache", () => {
  it("a write then a read at the same version returns the value", async () => {
    const cache = createScoreCache({ redis });
    await cache.write(LEAGUE, WEEK, 3, SCORES);
    await expect(cache.read(LEAGUE, WEEK, 3)).resolves.toEqual(SCORES);
  });

  it("a read at a newer version misses and never returns the stale value", async () => {
    const cache = createScoreCache({ redis });
    await cache.write(LEAGUE, WEEK, 3, SCORES);
    await expect(cache.read(LEAGUE, WEEK, 4)).resolves.toBeNull();
  });

  it("invalidate removes the key, so a subsequent read at the same version misses", async () => {
    const cache = createScoreCache({ redis });
    await cache.write(LEAGUE, WEEK, 3, SCORES);
    await cache.invalidate(LEAGUE, WEEK);
    await expect(cache.read(LEAGUE, WEEK, 3)).resolves.toBeNull();
    expect(await control.exists(keyFor(LEAGUE, WEEK))).toBe(0);
  });

  it("keys carry the configured TTL", async () => {
    const cache = createScoreCache({ redis });
    await cache.write(LEAGUE, WEEK, 3, SCORES);
    const ttl = await control.ttl(keyFor(LEAGUE, WEEK));
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(STATS_INGESTION_CONFIG.ttlSeconds.score);
  });

  describe("degrades OPEN on a Redis outage", () => {
    it("read resolves to a miss, not a throw", async () => {
      const dead = throwingRedis();
      try {
        const cache = createScoreCache({ redis: dead });
        await expect(cache.read(LEAGUE, WEEK, 3)).resolves.toBeNull();
      } finally {
        dead.disconnect();
      }
    });

    it("write resolves without throwing", async () => {
      const dead = throwingRedis();
      try {
        const cache = createScoreCache({ redis: dead });
        await expect(cache.write(LEAGUE, WEEK, 3, SCORES)).resolves.toBeUndefined();
      } finally {
        dead.disconnect();
      }
    });

    it("invalidate resolves without throwing", async () => {
      const dead = throwingRedis();
      try {
        const cache = createScoreCache({ redis: dead });
        await expect(cache.invalidate(LEAGUE, WEEK)).resolves.toBeUndefined();
      } finally {
        dead.disconnect();
      }
    });
  });

  describe("a corrupt value is treated as a miss, never a throw", () => {
    it("a value that isn't JSON", async () => {
      await control.set(keyFor(LEAGUE, WEEK), "not-json-at-all{{{");
      const cache = createScoreCache({ redis });
      await expect(cache.read(LEAGUE, WEEK, 3)).resolves.toBeNull();
    });

    it("JSON of the wrong shape", async () => {
      await control.set(keyFor(LEAGUE, WEEK), JSON.stringify({ unrelated: "shape" }));
      const cache = createScoreCache({ redis });
      await expect(cache.read(LEAGUE, WEEK, 3)).resolves.toBeNull();
    });

    it("JSON that parses to a non-object (a bare number)", async () => {
      await control.set(keyFor(LEAGUE, WEEK), JSON.stringify(42));
      const cache = createScoreCache({ redis });
      await expect(cache.read(LEAGUE, WEEK, 3)).resolves.toBeNull();
    });

    it("JSON that parses to null", async () => {
      await control.set(keyFor(LEAGUE, WEEK), JSON.stringify(null));
      const cache = createScoreCache({ redis });
      await expect(cache.read(LEAGUE, WEEK, 3)).resolves.toBeNull();
    });

    it("JSON whose scores array holds a non-object entry", async () => {
      await control.set(keyFor(LEAGUE, WEEK), JSON.stringify({ version: 3, scores: ["not-an-object"] }));
      const cache = createScoreCache({ redis });
      await expect(cache.read(LEAGUE, WEEK, 3)).resolves.toBeNull();
    });

    it("JSON whose scores array holds an entry of the wrong shape", async () => {
      await control.set(keyFor(LEAGUE, WEEK), JSON.stringify({ version: 3, scores: [{ teamId: "t1" }] }));
      const cache = createScoreCache({ redis });
      await expect(cache.read(LEAGUE, WEEK, 3)).resolves.toBeNull();
    });
  });
});
