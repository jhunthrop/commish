import { describe, it, expect, beforeEach, afterAll } from "vitest";
import Redis from "ioredis";
import { createPublisher } from "./publish";
import { subscribe } from "./subscribe";
import { REALTIME_CONFIG } from "./config";
import type { RealtimeEvent } from "./events";

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
const clock = { now: () => "2026-08-17T12:00:00.000Z" };

const control = new Redis(REDIS_URL);
const publisher = createPublisher({ redis: new Redis(REDIS_URL), clock });

const LEAGUE = "league_rt_test";

async function collect(
  opts: { leagueId: string; afterId?: string; signal: AbortSignal },
  count: number,
): Promise<readonly RealtimeEvent[]> {
  const out: RealtimeEvent[] = [];
  const redis = new Redis(REDIS_URL);
  try {
    for await (const ev of subscribe({ redis, ...opts })) {
      out.push(ev);
      if (out.length >= count) break;
    }
  } finally {
    redis.disconnect();
  }
  return out;
}

beforeEach(async () => {
  await control.del(REALTIME_CONFIG.leagueStreamKey(LEAGUE));
});

afterAll(async () => {
  await control.del(REALTIME_CONFIG.leagueStreamKey(LEAGUE));
  control.disconnect();
  publisher.close();
});

describe("publishEvent", () => {
  it("appends to the league stream and returns the entry id", async () => {
    const id = await publisher.publish({ leagueId: LEAGUE, type: "chat.message", payload: { text: "hi" } });
    expect(id).toMatch(/^\d+-\d+$/);
    const len = await control.xlen(REALTIME_CONFIG.leagueStreamKey(LEAGUE));
    expect(len).toBe(1);
  });

  it("does not throw the publish failure back to the caller when Redis is unreachable", async () => {
    // Publishing is best-effort: the underlying write is already committed in Postgres,
    // so a Redis outage must never make an accepted action look rejected.
    const dead = createPublisher({
      redis: new Redis("redis://localhost:1", { maxRetriesPerRequest: 0, lazyConnect: true, enableOfflineQueue: false }),
      clock,
    });
    const id = await dead.publish({ leagueId: LEAGUE, type: "chat.message", payload: {} });
    expect(id).toBeNull();
    dead.close();
  });
});

describe("subscribe (broadcast semantics)", () => {
  it("delivers every event to every subscriber — 3 subscribers all see all 3 events", async () => {
    // This is the exact property XREADGROUP would have broken (it partitions entries
    // across consumers). Plain XREAD from a per-connection cursor is what makes this hold.
    const ac = new AbortController();
    const subs = [1, 2, 3].map(() => collect({ leagueId: LEAGUE, afterId: "$", signal: ac.signal }, 3));
    await new Promise((r) => setTimeout(r, 100));
    await publisher.publish({ leagueId: LEAGUE, type: "draft.pick", payload: { n: 1 } });
    await publisher.publish({ leagueId: LEAGUE, type: "draft.pick", payload: { n: 2 } });
    await publisher.publish({ leagueId: LEAGUE, type: "draft.pick", payload: { n: 3 } });
    const results = await Promise.all(subs);
    ac.abort();
    for (const events of results) {
      expect(events.map((e) => (e.payload as { n: number }).n)).toEqual([1, 2, 3]);
    }
  });

  it("replays events missed during a gap when resumed from the last-seen id (Last-Event-ID)", async () => {
    const ac = new AbortController();
    const first = await publisher.publish({ leagueId: LEAGUE, type: "chat.message", payload: { n: 1 } });
    await publisher.publish({ leagueId: LEAGUE, type: "chat.message", payload: { n: 2 } });
    await publisher.publish({ leagueId: LEAGUE, type: "chat.message", payload: { n: 3 } });
    if (first === null) throw new Error("publish failed");
    const replayed = await collect({ leagueId: LEAGUE, afterId: first, signal: ac.signal }, 2);
    ac.abort();
    expect(replayed.map((e) => (e.payload as { n: number }).n)).toEqual([2, 3]);
  });

  it("carries type, leagueId, payload, and the publisher's timestamp through intact", async () => {
    const ac = new AbortController();
    const pending = collect({ leagueId: LEAGUE, afterId: "$", signal: ac.signal }, 1);
    await new Promise((r) => setTimeout(r, 100));
    await publisher.publish({ leagueId: LEAGUE, type: "draft.bid", payload: { teamId: "t1", amount: 42 } });
    const [ev] = await pending;
    ac.abort();
    expect(ev?.type).toBe("draft.bid");
    expect(ev?.leagueId).toBe(LEAGUE);
    expect(ev?.payload).toEqual({ teamId: "t1", amount: 42 });
    expect(ev?.timestamp).toBe("2026-08-17T12:00:00.000Z");
  });

  it("stops cleanly when the signal is aborted", async () => {
    const ac = new AbortController();
    const pending = collect({ leagueId: LEAGUE, afterId: "$", signal: ac.signal }, 99);
    setTimeout(() => ac.abort(), 200);
    const events = await pending;
    expect(events).toEqual([]);
  });
});
