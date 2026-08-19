import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import Redis from "ioredis";
import { createReferenceCache } from "./reference-cache";
import { STATS_INGESTION_CONFIG } from "./config";

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";

const LEAGUE_A = "league_ref_cache_a";
const LEAGUE_B = "league_ref_cache_b";

const PLAYERS_KEY = STATS_INGESTION_CONFIG.keys.playerIndex;
const SETTINGS_KEY_A = STATS_INGESTION_CONFIG.keys.scoringSettings(LEAGUE_A);
const SETTINGS_KEY_B = STATS_INGESTION_CONFIG.keys.scoringSettings(LEAGUE_B);

/** A connection that throws on every command — models a Redis outage without touching docker. */
function throwingRedis(): Redis {
  return new Redis("redis://localhost:1", { maxRetriesPerRequest: 0, lazyConnect: true, enableOfflineQueue: false });
}

const control = new Redis(REDIS_URL);
const redis = new Redis(REDIS_URL);

beforeEach(async () => {
  await control.del(PLAYERS_KEY, SETTINGS_KEY_A, SETTINGS_KEY_B);
});

afterAll(async () => {
  await control.del(PLAYERS_KEY, SETTINGS_KEY_A, SETTINGS_KEY_B);
  control.disconnect();
  redis.disconnect();
});

describe("createReferenceCache", () => {
  describe("players", () => {
    it("calls load once on a miss and zero times on a hit", async () => {
      const cache = createReferenceCache({ redis });
      const load = vi.fn(async () => ["p1", "p2"]);

      await expect(cache.players(load)).resolves.toEqual(["p1", "p2"]);
      expect(load).toHaveBeenCalledTimes(1);

      await expect(cache.players(load)).resolves.toEqual(["p1", "p2"]);
      expect(load).toHaveBeenCalledTimes(1);
    });

    it("invalidatePlayers makes the next call load again", async () => {
      const cache = createReferenceCache({ redis });
      const load = vi.fn(async () => ["p1"]);

      await cache.players(load);
      expect(load).toHaveBeenCalledTimes(1);

      await cache.invalidatePlayers();
      await cache.players(load);
      expect(load).toHaveBeenCalledTimes(2);
    });
  });

  describe("scoringSettings", () => {
    it("is per-league: invalidating league A does not evict league B", async () => {
      const cache = createReferenceCache({ redis });
      const loadA = vi.fn(async () => ({ ppr: 1 }));
      const loadB = vi.fn(async () => ({ ppr: 0.5 }));

      await cache.scoringSettings(LEAGUE_A, loadA);
      await cache.scoringSettings(LEAGUE_B, loadB);
      expect(loadA).toHaveBeenCalledTimes(1);
      expect(loadB).toHaveBeenCalledTimes(1);

      await cache.invalidateScoringSettings(LEAGUE_A);

      await cache.scoringSettings(LEAGUE_A, loadA);
      expect(loadA).toHaveBeenCalledTimes(2); // Evicted: loads again.

      await cache.scoringSettings(LEAGUE_B, loadB);
      expect(loadB).toHaveBeenCalledTimes(1); // Untouched by league A's invalidation.
    });
  });

  describe("a corrupt cached value is treated as a miss, never a throw", () => {
    it("players falls back to load when the cached value isn't JSON", async () => {
      await control.set(PLAYERS_KEY, "not-json-at-all{{{");
      const cache = createReferenceCache({ redis });
      const load = vi.fn(async () => ["p1"]);
      await expect(cache.players(load)).resolves.toEqual(["p1"]);
      expect(load).toHaveBeenCalledTimes(1);
    });
  });

  describe("degrades OPEN on a Redis outage", () => {
    it("players calls load — the correct value, slower", async () => {
      const dead = throwingRedis();
      try {
        const cache = createReferenceCache({ redis: dead });
        const load = vi.fn(async () => ["p1"]);
        await expect(cache.players(load)).resolves.toEqual(["p1"]);
        expect(load).toHaveBeenCalledTimes(1);
      } finally {
        dead.disconnect();
      }
    });

    it("scoringSettings calls load — the correct value, slower", async () => {
      const dead = throwingRedis();
      try {
        const cache = createReferenceCache({ redis: dead });
        const load = vi.fn(async () => ({ ppr: 1 }));
        await expect(cache.scoringSettings(LEAGUE_A, load)).resolves.toEqual({ ppr: 1 });
        expect(load).toHaveBeenCalledTimes(1);
      } finally {
        dead.disconnect();
      }
    });

    it("invalidatePlayers and invalidateScoringSettings resolve without throwing", async () => {
      const dead = throwingRedis();
      try {
        const cache = createReferenceCache({ redis: dead });
        await expect(cache.invalidatePlayers()).resolves.toBeUndefined();
        await expect(cache.invalidateScoringSettings(LEAGUE_A)).resolves.toBeUndefined();
      } finally {
        dead.disconnect();
      }
    });
  });
});
