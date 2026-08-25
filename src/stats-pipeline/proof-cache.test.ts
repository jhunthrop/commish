import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import Redis from "ioredis";
import { createProofCache } from "./proof-cache";
import { MATCHMAKING_CONFIG } from "@/matchmaking/config";
import type { ProofStats } from "@/matchmaking/contract";

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
const PROOF_CACHE_KEY = "matchmaking:proof";

const STATS: ProofStats = {
  leaguesFilled: 247,
  draftsNext48h: 12,
  rating: { average: 4.8, count: 63 },
  nextDraftAt: "2026-09-10T17:00:00.000Z",
  any: true,
};
const EMPTY_STATS: ProofStats = { leaguesFilled: null, draftsNext48h: null, rating: null, nextDraftAt: null, any: false };

/** A connection that throws on every command — models a Redis outage without touching docker. */
function throwingRedis(): Redis {
  return new Redis("redis://localhost:1", { maxRetriesPerRequest: 0, lazyConnect: true, enableOfflineQueue: false });
}

const control = new Redis(REDIS_URL);
const redis = new Redis(REDIS_URL);

beforeEach(async () => {
  await control.del(PROOF_CACHE_KEY);
});

afterAll(async () => {
  await control.del(PROOF_CACHE_KEY);
  control.disconnect();
  redis.disconnect();
});

describe("createProofCache", () => {
  it("calls load on a miss and writes the result through", async () => {
    const cache = createProofCache({ redis });
    const load = vi.fn().mockResolvedValue(STATS);
    await expect(cache.stats(load)).resolves.toEqual(STATS);
    expect(load).toHaveBeenCalledTimes(1);
    expect(await control.get(PROOF_CACHE_KEY)).toBe(JSON.stringify(STATS));
  });

  it("calls load zero times on a hit", async () => {
    const cache = createProofCache({ redis });
    await cache.stats(async () => STATS);
    const load = vi.fn().mockResolvedValue(EMPTY_STATS);
    await expect(cache.stats(load)).resolves.toEqual(STATS);
    expect(load).not.toHaveBeenCalled();
  });

  it("caches the empty-strip answer too — 'any: false' is a real value, not a cache miss", async () => {
    const cache = createProofCache({ redis });
    await cache.stats(async () => EMPTY_STATS);
    const load = vi.fn().mockResolvedValue(STATS);
    await expect(cache.stats(load)).resolves.toEqual(EMPTY_STATS);
    expect(load).not.toHaveBeenCalled();
  });

  it("the key carries the configured TTL", async () => {
    const cache = createProofCache({ redis });
    await cache.stats(async () => STATS);
    const ttl = await control.ttl(PROOF_CACHE_KEY);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(MATCHMAKING_CONFIG.proof.cacheTtlSeconds);
  });

  it("a corrupt (non-JSON) cached value is treated as a miss, never a throw", async () => {
    await control.set(PROOF_CACHE_KEY, "not json");
    const cache = createProofCache({ redis });
    await expect(cache.stats(async () => STATS)).resolves.toEqual(STATS);
  });

  it("a wrong-shape cached value is treated as a miss, never a throw", async () => {
    await control.set(PROOF_CACHE_KEY, JSON.stringify({ leaguesFilled: "not a number" }));
    const cache = createProofCache({ redis });
    await expect(cache.stats(async () => STATS)).resolves.toEqual(STATS);
  });

  // Task 7: `nextDraftAt` joined the contract, so a value cached by the previous deploy (no
  // such field) fails the shape check and reloads — self-healing across the shape change.
  it("a cached value from before nextDraftAt existed is treated as a miss and reloaded", async () => {
    const previousShape = Object.fromEntries(Object.entries(STATS).filter(([key]) => key !== "nextDraftAt"));
    await control.set(PROOF_CACHE_KEY, JSON.stringify(previousShape));
    const cache = createProofCache({ redis });
    await expect(cache.stats(async () => STATS)).resolves.toEqual(STATS);
  });

  it("degrades open on a Redis outage — reads fall through to load, writes are swallowed", async () => {
    const cache = createProofCache({ redis: throwingRedis() });
    await expect(cache.stats(async () => STATS)).resolves.toEqual(STATS);
  });
});
