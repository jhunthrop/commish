import { describe, it, expect, beforeEach, afterAll } from "vitest";
import Redis from "ioredis";
import type { ChatMessagePayload, ChatReactionPayload } from "@/chat/contract";
import type { Db } from "@/db/client";
import { createTestDb, truncateAll } from "@/db/test-db";
import { REALTIME_CONFIG } from "@/lib/realtime/config";
import { createPublisher } from "@/lib/realtime/publish";
import { subscribe } from "@/lib/realtime/subscribe";
import type { RealtimeEvent } from "@/lib/realtime/events";
import { listMessages, postMessage, toggleReaction } from "./chat";
import { chatLeagueFixture } from "./test-support";

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
const db: Db = createTestDb();
const control = new Redis(REDIS_URL);
const publisher = createPublisher({ redis: new Redis(REDIS_URL), clock: { now: () => "2026-08-18T12:00:00.000Z" } });
const publish = publisher.publish;

/** One reader of the league stream — the server half of what a browser's EventSource does. */
async function collect(leagueId: string, count: number, signal: AbortSignal): Promise<readonly RealtimeEvent[]> {
  const out: RealtimeEvent[] = [];
  const redis = new Redis(REDIS_URL);
  try {
    for await (const event of subscribe({ redis, leagueId, afterId: "$", signal })) {
      out.push(event);
      if (out.length >= count) break;
    }
  } finally {
    redis.disconnect();
  }
  return out;
}

beforeEach(async () => {
  await truncateAll(db);
  await chatLeagueFixture(db);
  await control.del(REALTIME_CONFIG.leagueStreamKey("l1"));
});

afterAll(async () => {
  await control.del(REALTIME_CONFIG.leagueStreamKey("l1"));
  control.disconnect();
  publisher.close();
});

describe("two users in the same league", () => {
  it("both see each other's message and reaction in real time", async () => {
    const ac = new AbortController();
    // Two independent subscribers, exactly as two browsers would be. Plain XREAD gives each
    // its own cursor over the same stream — the property XREADGROUP would have broken.
    const alex = collect("l1", 2, ac.signal);
    const jordan = collect("l1", 2, ac.signal);
    await new Promise((resolve) => setTimeout(resolve, 100));

    const message = await postMessage(db, { leagueId: "l1", userId: "u1", body: "wheels up", publish });
    await toggleReaction(db, { leagueId: "l1", messageId: message.id, userId: "u2", emoji: "🔥", publish });

    const [alexSaw, jordanSaw] = await Promise.all([alex, jordan]);
    ac.abort();

    for (const seen of [alexSaw, jordanSaw]) {
      expect(seen.map((event) => event.type)).toEqual(["chat.message", "chat.reaction"]);
      expect((seen[0]!.payload as ChatMessagePayload).message.body).toBe("wheels up");
      expect(seen[1]!.payload as ChatReactionPayload).toEqual({
        messageId: message.id,
        emoji: "🔥",
        userId: "u2",
        action: "added",
      });
    }
  });

  it("keeps the history across a reload — a fresh read shows what the stream already delivered", async () => {
    const first = await postMessage(db, { leagueId: "l1", userId: "u1", body: "wheels up", publish });
    await toggleReaction(db, { leagueId: "l1", messageId: first.id, userId: "u2", emoji: "🔥", publish });

    // No stream involved: this is what a page load does after a refresh.
    const page = await listMessages(db, { leagueId: "l1" });
    expect(page.messages).toHaveLength(1);
    expect(page.messages[0]?.body).toBe("wheels up");
    expect(page.messages[0]?.reactions).toEqual([{ emoji: "🔥", userId: "u2" }]);
  });

  it("replays what a disconnected client missed, from its Last-Event-ID", async () => {
    const ac = new AbortController();
    const message = await postMessage(db, { leagueId: "l1", userId: "u1", body: "first", publish });
    const firstId = await control.xrevrange(REALTIME_CONFIG.leagueStreamKey("l1"), "+", "-", "COUNT", 1);
    await toggleReaction(db, { leagueId: "l1", messageId: message.id, userId: "u2", emoji: "🔥", publish });

    const redis = new Redis(REDIS_URL);
    const replayed: RealtimeEvent[] = [];
    for await (const event of subscribe({ redis, leagueId: "l1", afterId: firstId[0]![0], signal: ac.signal })) {
      replayed.push(event);
      break;
    }
    redis.disconnect();
    ac.abort();
    expect(replayed.map((event) => event.type)).toEqual(["chat.reaction"]);
  });
});
