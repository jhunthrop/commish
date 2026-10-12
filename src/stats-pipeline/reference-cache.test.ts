import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import Redis from "ioredis";
import { createReferenceCache } from "./reference-cache";
import { STATS_INGESTION_CONFIG } from "./config";
import type { Player } from "@research/domain/player";
import type { ScoringSettings } from "@research/domain/scoring";

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";

const LEAGUE_A = "league_ref_cache_a";
const LEAGUE_B = "league_ref_cache_b";

const PLAYERS_KEY = STATS_INGESTION_CONFIG.keys.playerIndex;
const SETTINGS_KEY_A = STATS_INGESTION_CONFIG.keys.scoringSettings(LEAGUE_A);
const SETTINGS_KEY_B = STATS_INGESTION_CONFIG.keys.scoringSettings(LEAGUE_B);

const PLAYERS: readonly Player[] = [{ id: "p1", name: "One Guy", position: "QB", nflTeam: "SF", headshotUrl: null, adp: null }];

const SETTINGS_A: ScoringSettings = {
  leagueId: LEAGUE_A,
  pointsPerPassingYard: 0.04,
  pointsPerPassingTouchdown: 4,
  pointsPerInterception: -2,
  pointsPerRushingYard: 0.1,
  pointsPerRushingTouchdown: 6,
  pointsPerReceivingYard: 0.1,
  pointsPerReceivingTouchdown: 6,
  pointsPerReception: 1,
  pointsPerFumbleLost: -2,
  teReceptionBonus: 0,
  pointsPerFieldGoal: 3,
  pointsPerExtraPoint: 1,
  pointsPerSack: 1,
  pointsPerDefensiveInterception: 2,
  pointsPerDefensiveTouchdown: 6,
  pointsPerTwoPointConversion: 2,
  pointsPerFieldGoalMissed: -1,
  pointsPerExtraPointMissed: -1,
  pointsPerReturnTouchdown: 6,
  pointsPerDefensiveFumbleRecovery: 2,
  pointsPerSafety: 2,
};

const SETTINGS_B: ScoringSettings = { ...SETTINGS_A, leagueId: LEAGUE_B, pointsPerReception: 0.5 };

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
      const load = vi.fn(async () => PLAYERS);

      await expect(cache.players(load)).resolves.toEqual(PLAYERS);
      expect(load).toHaveBeenCalledTimes(1);

      await expect(cache.players(load)).resolves.toEqual(PLAYERS);
      expect(load).toHaveBeenCalledTimes(1);
    });

    it("invalidatePlayers makes the next call load again", async () => {
      const cache = createReferenceCache({ redis });
      const load = vi.fn(async () => PLAYERS);

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
      const loadA = vi.fn(async () => SETTINGS_A);
      const loadB = vi.fn(async () => SETTINGS_B);

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

  describe("a corrupt or wrong-shape cached value is treated as a miss, never a throw", () => {
    it("players falls back to load when the cached value isn't JSON", async () => {
      await control.set(PLAYERS_KEY, "not-json-at-all{{{");
      const cache = createReferenceCache({ redis });
      const load = vi.fn(async () => PLAYERS);
      await expect(cache.players(load)).resolves.toEqual(PLAYERS);
      expect(load).toHaveBeenCalledTimes(1);
    });

    it("players falls back to load when the cached JSON isn't an array", async () => {
      await control.set(PLAYERS_KEY, JSON.stringify({ unrelated: "shape" }));
      const cache = createReferenceCache({ redis });
      const load = vi.fn(async () => PLAYERS);
      await expect(cache.players(load)).resolves.toEqual(PLAYERS);
      expect(load).toHaveBeenCalledTimes(1);
    });

    it("players falls back to load when an array entry is missing a required field", async () => {
      await control.set(PLAYERS_KEY, JSON.stringify([{ id: "p1", name: "One Guy", position: "QB" }])); // no nflTeam
      const cache = createReferenceCache({ redis });
      const load = vi.fn(async () => PLAYERS);
      await expect(cache.players(load)).resolves.toEqual(PLAYERS);
      expect(load).toHaveBeenCalledTimes(1);
    });

    it("players falls back to load when an array entry isn't an object at all", async () => {
      await control.set(PLAYERS_KEY, JSON.stringify(["not-an-object"]));
      const cache = createReferenceCache({ redis });
      const load = vi.fn(async () => PLAYERS);
      await expect(cache.players(load)).resolves.toEqual(PLAYERS);
      expect(load).toHaveBeenCalledTimes(1);
    });

    it("scoringSettings falls back to load when the cached JSON parses to a non-object", async () => {
      await control.set(SETTINGS_KEY_A, JSON.stringify(42));
      const cache = createReferenceCache({ redis });
      const load = vi.fn(async () => SETTINGS_A);
      await expect(cache.scoringSettings(LEAGUE_A, load)).resolves.toEqual(SETTINGS_A);
      expect(load).toHaveBeenCalledTimes(1);
    });

    it("scoringSettings falls back to load when the cached value isn't JSON", async () => {
      await control.set(SETTINGS_KEY_A, "not-json-at-all{{{");
      const cache = createReferenceCache({ redis });
      const load = vi.fn(async () => SETTINGS_A);
      await expect(cache.scoringSettings(LEAGUE_A, load)).resolves.toEqual(SETTINGS_A);
      expect(load).toHaveBeenCalledTimes(1);
    });

    it("scoringSettings falls back to load when a numeric field is the wrong type", async () => {
      await control.set(SETTINGS_KEY_A, JSON.stringify({ ...SETTINGS_A, pointsPerReception: "one" }));
      const cache = createReferenceCache({ redis });
      const load = vi.fn(async () => SETTINGS_A);
      await expect(cache.scoringSettings(LEAGUE_A, load)).resolves.toEqual(SETTINGS_A);
      expect(load).toHaveBeenCalledTimes(1);
    });

    it("scoringSettings falls back to load when leagueId is missing", async () => {
      const withoutLeagueId: Record<string, unknown> = { ...SETTINGS_A };
      Reflect.deleteProperty(withoutLeagueId, "leagueId");
      await control.set(SETTINGS_KEY_A, JSON.stringify(withoutLeagueId));
      const cache = createReferenceCache({ redis });
      const load = vi.fn(async () => SETTINGS_A);
      await expect(cache.scoringSettings(LEAGUE_A, load)).resolves.toEqual(SETTINGS_A);
      expect(load).toHaveBeenCalledTimes(1);
    });
  });

  describe("degrades OPEN on a Redis outage", () => {
    it("players calls load — the correct value, slower", async () => {
      const dead = throwingRedis();
      try {
        const cache = createReferenceCache({ redis: dead });
        const load = vi.fn(async () => PLAYERS);
        await expect(cache.players(load)).resolves.toEqual(PLAYERS);
        expect(load).toHaveBeenCalledTimes(1);
      } finally {
        dead.disconnect();
      }
    });

    it("scoringSettings calls load — the correct value, slower", async () => {
      const dead = throwingRedis();
      try {
        const cache = createReferenceCache({ redis: dead });
        const load = vi.fn(async () => SETTINGS_A);
        await expect(cache.scoringSettings(LEAGUE_A, load)).resolves.toEqual(SETTINGS_A);
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
