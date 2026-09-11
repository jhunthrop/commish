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
  it("lists a member who marked present inside the ttl, and forgets one whose connection marked away", async () => {
    await store.markPresent(LEAGUE, "user_dana", "c1", NOW);
    await store.markPresent(LEAGUE, "user_rey", "c2", NOW - 1_000);
    expect([...(await store.listPresent(LEAGUE, NOW))].sort()).toEqual(["user_dana", "user_rey"]);
    await store.markAway(LEAGUE, "user_rey", "c2");
    expect(await store.listPresent(LEAGUE, NOW)).toEqual(["user_dana"]);
  });

  it("keeps a member present while any of their connections is open: closing one tab is not leaving (H1)", async () => {
    await store.markPresent(LEAGUE, "user_dana", "tab1", NOW);
    await store.markPresent(LEAGUE, "user_dana", "tab2", NOW);
    expect(await store.listPresent(LEAGUE, NOW)).toEqual(["user_dana"]);
    await store.markAway(LEAGUE, "user_dana", "tab1");
    expect(await store.listPresent(LEAGUE, NOW)).toEqual(["user_dana"]);
    await store.markAway(LEAGUE, "user_dana", "tab2");
    expect(await store.listPresent(LEAGUE, NOW)).toEqual([]);
  });

  it("never lets one connection's close retire another connection's mark", async () => {
    await store.markPresent(LEAGUE, "user_dana", "tab1", NOW);
    await store.markAway(LEAGUE, "user_dana", "tab-that-never-opened");
    expect(await store.listPresent(LEAGUE, NOW)).toEqual(["user_dana"]);
  });

  it("treats a mark older than the ttl as gone, and prunes it from the hash", async () => {
    await store.markPresent(LEAGUE, "user_ghost", "c1", NOW - PRESENCE_CONFIG.ttlMs - 1);
    await store.markPresent(LEAGUE, "user_here", "c2", NOW - PRESENCE_CONFIG.ttlMs);
    expect(await store.listPresent(LEAGUE, NOW)).toEqual(["user_here"]);
    expect(await redis.hexists(PRESENCE_CONFIG.key(LEAGUE), "user_ghost|c1")).toBe(0);
  });

  it("answers empty for a league nobody has opened", async () => {
    expect(await store.listPresent("league_presence_nobody", NOW)).toEqual([]);
  });

  it("lets the whole hash expire on its own, so an abandoned league holds nothing", async () => {
    await store.markPresent(LEAGUE, "user_dana", "c1", NOW);
    const ttl = await redis.pttl(PRESENCE_CONFIG.key(LEAGUE));
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(PRESENCE_CONFIG.ttlMs * 2);
  });
});

describe("presenceLifecycle", () => {
  it("marks present and announces the whole room on open, refreshes on keepalive, retires its own mark and announces on close", async () => {
    const publish = vi.fn(async () => "1-0");
    let clock = NOW;
    const lifecycle = presenceLifecycle({ store, publish, now: () => clock, newConnectionId: () => "conn-a" }, LEAGUE, "user_dana");
    await lifecycle.onOpen();
    expect(await store.listPresent(LEAGUE, NOW)).toEqual(["user_dana"]);
    expect(publish).toHaveBeenCalledWith({ leagueId: LEAGUE, type: "presence.changed", payload: { userIds: ["user_dana"] } });

    clock = NOW + PRESENCE_CONFIG.ttlMs;
    await lifecycle.onKeepalive();
    expect(await store.listPresent(LEAGUE, clock)).toEqual(["user_dana"]);
    expect(publish).toHaveBeenCalledTimes(1);

    await lifecycle.onClose();
    expect(await store.listPresent(LEAGUE, clock)).toEqual([]);
    expect(publish).toHaveBeenLastCalledWith({ leagueId: LEAGUE, type: "presence.changed", payload: { userIds: [] } });
  });

  it("two connections for one member: closing one still announces them present, closing both announces them away (H1)", async () => {
    const publish = vi.fn(async () => "1-0");
    const deps = { store, publish, now: () => NOW };
    const tab1 = presenceLifecycle({ ...deps, newConnectionId: () => "tab1" }, LEAGUE, "user_dana");
    const tab2 = presenceLifecycle({ ...deps, newConnectionId: () => "tab2" }, LEAGUE, "user_dana");
    await tab1.onOpen();
    await tab2.onOpen();
    await tab1.onClose();
    expect(publish).toHaveBeenLastCalledWith({ leagueId: LEAGUE, type: "presence.changed", payload: { userIds: ["user_dana"] } });
    await tab2.onClose();
    expect(publish).toHaveBeenLastCalledWith({ leagueId: LEAGUE, type: "presence.changed", payload: { userIds: [] } });
  });

  it("mints its own connection id when none is given, so two lifecycles never share a mark", async () => {
    const publish = vi.fn(async () => "1-0");
    const a = presenceLifecycle({ store, publish, now: () => NOW }, LEAGUE, "user_dana");
    const b = presenceLifecycle({ store, publish, now: () => NOW }, LEAGUE, "user_dana");
    await a.onOpen();
    await b.onOpen();
    await a.onClose();
    expect(await store.listPresent(LEAGUE, NOW)).toEqual(["user_dana"]);
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
