import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import Redis from "ioredis";
import { PRESENCE_CONFIG, createPresenceStore, presenceLifecycle } from "./presence";

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
const redis = new Redis(REDIS_URL);
const store = createPresenceStore(redis);
const LEAGUE = "league_presence_test";
const NOW = 1_760_000_000_000;

beforeEach(async () => {
  await redis.del(PRESENCE_CONFIG.key(LEAGUE));
});

afterAll(async () => {
  await redis.del(PRESENCE_CONFIG.key(LEAGUE));
  redis.disconnect();
});

describe("createPresenceStore", () => {
  it("lists a member who marked present inside the ttl, and forgets one who marked away", async () => {
    await store.markPresent(LEAGUE, "user_dana", NOW);
    await store.markPresent(LEAGUE, "user_rey", NOW - 1_000);
    expect([...(await store.listPresent(LEAGUE, NOW))].sort()).toEqual(["user_dana", "user_rey"]);
    await store.markAway(LEAGUE, "user_rey");
    expect(await store.listPresent(LEAGUE, NOW)).toEqual(["user_dana"]);
  });

  it("treats a mark older than the ttl as gone, and prunes it from the hash", async () => {
    await store.markPresent(LEAGUE, "user_ghost", NOW - PRESENCE_CONFIG.ttlMs - 1);
    await store.markPresent(LEAGUE, "user_here", NOW - PRESENCE_CONFIG.ttlMs);
    expect(await store.listPresent(LEAGUE, NOW)).toEqual(["user_here"]);
    expect(await redis.hexists(PRESENCE_CONFIG.key(LEAGUE), "user_ghost")).toBe(0);
  });

  it("answers empty for a league nobody has opened", async () => {
    expect(await store.listPresent("league_presence_nobody", NOW)).toEqual([]);
  });

  it("lets the whole hash expire on its own, so an abandoned league holds nothing", async () => {
    await store.markPresent(LEAGUE, "user_dana", NOW);
    const ttl = await redis.pttl(PRESENCE_CONFIG.key(LEAGUE));
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(PRESENCE_CONFIG.ttlMs * 2);
  });
});

describe("presenceLifecycle", () => {
  it("marks present and announces on open, refreshes the mark on keepalive, marks away and announces on close", async () => {
    const publish = vi.fn(async () => "1-0");
    let clock = NOW;
    const lifecycle = presenceLifecycle({ store, publish, now: () => clock }, LEAGUE, "user_dana");
    await lifecycle.onOpen();
    expect(await store.listPresent(LEAGUE, NOW)).toEqual(["user_dana"]);
    expect(publish).toHaveBeenCalledWith({ leagueId: LEAGUE, type: "presence.changed", payload: { userId: "user_dana", present: true } });

    clock = NOW + PRESENCE_CONFIG.ttlMs;
    await lifecycle.onKeepalive();
    expect(await store.listPresent(LEAGUE, clock)).toEqual(["user_dana"]);
    expect(publish).toHaveBeenCalledTimes(1);

    await lifecycle.onClose();
    expect(await store.listPresent(LEAGUE, clock)).toEqual([]);
    expect(publish).toHaveBeenLastCalledWith({ leagueId: LEAGUE, type: "presence.changed", payload: { userId: "user_dana", present: false } });
  });

  it("never throws: a failing store or publisher leaves the stream alone", async () => {
    const broken = createPresenceStore(new Redis("redis://localhost:1", { maxRetriesPerRequest: 0, lazyConnect: true, enableOfflineQueue: false }));
    const publish = vi.fn(async () => {
      throw new Error("redis down");
    });
    const lifecycle = presenceLifecycle({ store: broken, publish, now: () => NOW }, LEAGUE, "user_dana");
    await expect(lifecycle.onOpen()).resolves.toBeUndefined();
    await expect(lifecycle.onKeepalive()).resolves.toBeUndefined();
    await expect(lifecycle.onClose()).resolves.toBeUndefined();
  });
});
