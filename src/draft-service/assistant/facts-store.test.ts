import { describe, expect, it, vi } from "vitest";
import type { PlayedPick } from "../sim/continue";
import { ADVISOR_CONFIG } from "./config";
import { createMemoryRoomFactsStore, createRedisRoomFactsStore, deserializeRoomFacts, factsKey, factsLockKey, roomFactsOnce, serializeRoomFacts, type FactsKey } from "./facts-store";
import type { RoomFacts } from "./memo";

const ORDER = ["t1", "t2", "t3", "t4"];
const KEY: FactsKey = { draftId: "d1", sequence: 5, draftOrder: ORDER };

/** A 4-team snake from pick 3: t3, t4, t4, t3, t2, t1 ... */
const snake = (fromPick: number, playerIds: readonly string[]): readonly PlayedPick[] =>
  playerIds.map((playerId, i) => {
    const pickNumber = fromPick + i;
    const round = Math.ceil(pickNumber / ORDER.length);
    const index = (pickNumber - 1) % ORDER.length;
    return { pickNumber, teamId: ORDER[round % 2 === 1 ? index : ORDER.length - 1 - index]!, playerId };
  });

const facts: RoomFacts = {
  table: {
    runs: 3,
    fromPick: 3,
    throughPick: 8,
    played: [
      snake(3, ["a", "b", "c", "d", "e", "f"]),
      // A run that ended early (the draft completed): still a plain continuation.
      snake(3, ["a", "b"]),
      // A run that is NOT a plain continuation (a seat skipped): kept whole on the wire.
      [{ pickNumber: 3, teamId: "t3", playerId: "a" }, { pickNumber: 5, teamId: "t4", playerId: "z" }],
    ],
  },
  tiers: { a: { tier: 1, left: 2, size: 4 } },
  collapses: [{ position: "RB", playersLeftInTier: 1, dropToNextTier: 9.5 }],
};

describe("the wire form", () => {
  it("round-trips exactly, compacting plain continuations to player ids and keeping every other run whole", () => {
    const text = serializeRoomFacts(facts, ORDER);
    expect(deserializeRoomFacts(text, ORDER)).toEqual(facts);
    const wire = JSON.parse(text) as { played: unknown[] };
    expect(wire.played[0]).toEqual(["a", "b", "c", "d", "e", "f"]);
    expect(wire.played[2]).toEqual(facts.table.played[2]);
    // Fifty-odd bytes per pick verbatim against a handful compacted.
    expect(text.length).toBeLessThan(JSON.stringify(facts).length);
  });

  it("refuses anything that is not its own shape", () => {
    expect(deserializeRoomFacts("{not json", ORDER)).toBeNull();
    expect(deserializeRoomFacts(JSON.stringify({ v: 99, runs: 1, fromPick: 1, throughPick: 1, played: [], tiers: {}, collapses: [] }), ORDER)).toBeNull();
    expect(deserializeRoomFacts(JSON.stringify({ hello: "world" }), ORDER)).toBeNull();
    expect(deserializeRoomFacts("null", ORDER)).toBeNull();
  });

  it("keys by draft and sequence, the lock beside it", () => {
    expect(factsKey(KEY)).toBe("advisor:facts:d1:5");
    expect(factsLockKey(KEY)).toBe("advisor:facts-lock:d1:5");
  });
});

describe("roomFactsOnce over the memory store", () => {
  it("a miss computes under the lock, writes, releases; a hit computes nothing", async () => {
    const store = createMemoryRoomFactsStore();
    const compute = vi.fn(async () => facts);
    expect(await roomFactsOnce(store, KEY, compute)).toEqual(facts);
    expect(compute).toHaveBeenCalledTimes(1);
    expect(store.locks.size).toBe(0);
    expect(await roomFactsOnce(store, KEY, compute)).toEqual(facts);
    expect(compute).toHaveBeenCalledTimes(1);
  });

  it("a contended miss waits for the lock holder's write rather than simulating too", async () => {
    const store = createMemoryRoomFactsStore();
    store.locks.add(factsLockKey(KEY));
    const compute = vi.fn(async () => facts);
    const sleeps: number[] = [];
    const waiting = roomFactsOnce(store, KEY, compute, {
      waitPollMs: 10,
      waitMaxMs: 100,
      sleep: async (ms) => {
        sleeps.push(ms);
        if (sleeps.length === 3) await store.write(KEY, facts);
      },
    });
    expect(await waiting).toEqual(facts);
    expect(compute).not.toHaveBeenCalled();
    expect(sleeps).toEqual([10, 10, 10]);
  });

  it("a holder that never writes does not strand the reader: past the wait it computes itself", async () => {
    const store = createMemoryRoomFactsStore();
    store.locks.add(factsLockKey(KEY));
    const compute = vi.fn(async () => facts);
    const result = await roomFactsOnce(store, KEY, compute, { waitPollMs: 10, waitMaxMs: 30, sleep: async () => undefined });
    expect(result).toEqual(facts);
    expect(compute).toHaveBeenCalledTimes(1);
    expect(await store.read(KEY)).toEqual(facts);
  });

  it("a compute that throws releases the lock and rethrows", async () => {
    const store = createMemoryRoomFactsStore();
    await expect(roomFactsOnce(store, KEY, async () => Promise.reject(new Error("sim broke")))).rejects.toThrow("sim broke");
    expect(store.locks.size).toBe(0);
    expect(await store.read(KEY)).toBeNull();
  });

  it("the config names a short TTL and a lock that outlives the longest measured compute", () => {
    expect(ADVISOR_CONFIG.facts.ttlMs).toBeLessThanOrEqual(15 * 60_000);
    expect(ADVISOR_CONFIG.facts.lockMs).toBeGreaterThan(2_000);
    expect(ADVISOR_CONFIG.facts.waitMaxMs).toBeLessThan(ADVISOR_CONFIG.facts.lockMs);
  });
});

/** The ioredis surface the store touches, faked: get/set/del over a map, or throwing. */
function fakeRedis(failing = false) {
  const held = new Map<string, string>();
  const calls: string[] = [];
  const fail = (): never => {
    throw new Error("connect ETIMEDOUT");
  };
  return {
    held,
    calls,
    client: {
      async get(key: string) {
        calls.push(`get ${key}`);
        if (failing) fail();
        return held.get(key) ?? null;
      },
      async set(key: string, value: string, ...args: (string | number)[]) {
        calls.push(`set ${key} ${args.join(" ")}`);
        if (failing) fail();
        if (args.includes("NX") && held.has(key)) return null;
        held.set(key, value);
        return "OK";
      },
      async del(key: string) {
        calls.push(`del ${key}`);
        if (failing) fail();
        held.delete(key);
        return 1;
      },
    },
  };
}

describe("the Redis store", () => {
  it("writes with the TTL, reads back, and takes the lock NX with its own expiry", async () => {
    const redis = fakeRedis();
    const store = createRedisRoomFactsStore(redis.client as never);
    expect(await store.read(KEY)).toBeNull();
    await store.write(KEY, facts);
    expect(await store.read(KEY)).toEqual(facts);
    expect(redis.calls).toContain(`set ${factsKey(KEY)} PX ${ADVISOR_CONFIG.facts.ttlMs}`);
    expect(await store.acquire(KEY)).toBe(true);
    expect(await store.acquire(KEY)).toBe(false);
    expect(redis.calls).toContain(`set ${factsLockKey(KEY)} PX ${ADVISOR_CONFIG.facts.lockMs} NX`);
    await store.release(KEY);
    expect(await store.acquire(KEY)).toBe(true);
  });

  it("degrades on a Redis failure: a read is a miss, a write is dropped, the lock is granted, logged once per streak", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const store = createRedisRoomFactsStore(fakeRedis(true).client as never);
    expect(await store.read(KEY)).toBeNull();
    await store.write(KEY, facts);
    expect(await store.acquire(KEY)).toBe(true);
    await store.release(KEY);
    expect(error).toHaveBeenCalledTimes(1);
    error.mockRestore();
  });
});
