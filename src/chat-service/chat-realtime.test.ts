import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";

// The route handlers use the process-wide getDb()/getPublisher(); point them at the test
// infrastructure before any module is imported. vi.hoisted runs before the import graph, so
// this is the same seam `draft-service/api-routes.test.ts` and `events/route.test.ts` use —
// not a new one invented for chat.
vi.hoisted(() => {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://commish:commish@localhost:5433/commish_test";
  process.env.REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
});

const currentUser = vi.fn<() => Promise<{ readonly id: string } | null>>();
vi.mock("@/lib/auth/current-user", () => ({
  getCurrentUser: () => currentUser(),
  requireCurrentUser: async () => {
    const user = await currentUser();
    if (user === null) throw new Error("not signed in");
    return user;
  },
}));

import Redis from "ioredis";
import type { ChatMessagePayload, ChatPageBody, ChatReactionPayload, PostChatBody, ReactionBody } from "@/chat/contract";
import { createTestDb, truncateAll } from "@/db/test-db";
import type { ApiEnvelope } from "@/lib/api/respond";
import { REALTIME_CONFIG } from "@/lib/realtime/config";
import { subscribe } from "@/lib/realtime/subscribe";
import type { RealtimeEvent } from "@/lib/realtime/events";
import { chatLeagueFixture } from "./test-support";

const { GET, POST } = await import("@/app/api/leagues/[leagueId]/chat/route");
const { POST: REACT } = await import("@/app/api/leagues/[leagueId]/chat/[messageId]/reactions/route");

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
const db = createTestDb();
const control = new Redis(REDIS_URL);

const leagueContext = { params: Promise.resolve({ leagueId: "l1" }) };
const url = "http://localhost/api/leagues/l1/chat";

function post(body: unknown): Request {
  return new Request(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

/** One reader of the league stream — the server half of what a browser's EventSource does. */
async function collect(leagueId: string, count: number, signal: AbortSignal): Promise<readonly RealtimeEvent[]> {
  const out: RealtimeEvent[] = [];
  const redis = new Redis(REDIS_URL);
  try {
    for await (const event of subscribe({ redis, streamKey: REALTIME_CONFIG.leagueStreamKey(leagueId), afterId: "$", signal })) {
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
  currentUser.mockResolvedValue({ id: "u1" });
});

afterAll(async () => {
  await control.del(REALTIME_CONFIG.leagueStreamKey("l1"));
  control.disconnect();
});

describe("two users in the same league", () => {
  it("both see each other's message and reaction, published through the real HTTP wire path", async () => {
    const ac = new AbortController();
    // Two independent subscribers, exactly as two browsers would be. Plain XREAD gives each
    // its own cursor over the same stream — the property XREADGROUP would have broken.
    const alex = collect("l1", 2, ac.signal);
    const jordan = collect("l1", 2, ac.signal);
    await new Promise((resolve) => setTimeout(resolve, 100));

    // The actual wire path: `POST /chat` and `POST /chat/:id/reactions` through the real route
    // handlers, so the write flows route → service → the `getPublisher()` singleton → Redis —
    // never a locally-built publisher standing in for it.
    currentUser.mockResolvedValue({ id: "u1" });
    const posted = (await (await POST(post({ body: "wheels up" }), leagueContext)).json()) as ApiEnvelope<PostChatBody>;
    if (!posted.ok) throw new Error("post failed");
    const messageId = posted.data.message.id;

    currentUser.mockResolvedValue({ id: "u2" });
    const reactContext = { params: Promise.resolve({ leagueId: "l1", messageId }) };
    const reacted = (await (await REACT(post({ emoji: "🔥" }), reactContext)).json()) as ApiEnvelope<ReactionBody>;
    if (!reacted.ok) throw new Error("react failed");

    const [alexSaw, jordanSaw] = await Promise.all([alex, jordan]);
    ac.abort();

    for (const seen of [alexSaw, jordanSaw]) {
      expect(seen.map((event) => event.type)).toEqual(["chat.message", "chat.reaction"]);
      expect((seen[0]!.payload as ChatMessagePayload).message.body).toBe("wheels up");
      expect(seen[1]!.payload as ChatReactionPayload).toEqual({
        messageId,
        emoji: "🔥",
        userId: "u2",
        action: "added",
      });
    }
  });

  it("keeps the history across a reload — a fresh GET shows what the stream already delivered", async () => {
    const posted = (await (await POST(post({ body: "wheels up" }), leagueContext)).json()) as ApiEnvelope<PostChatBody>;
    if (!posted.ok) throw new Error("post failed");

    currentUser.mockResolvedValue({ id: "u2" });
    const reactContext = { params: Promise.resolve({ leagueId: "l1", messageId: posted.data.message.id }) };
    await REACT(post({ emoji: "🔥" }), reactContext);

    // No stream involved: this is what a page load does after a refresh.
    currentUser.mockResolvedValue({ id: "u1" });
    const page = (await (await GET(new Request(url), leagueContext)).json()) as ApiEnvelope<ChatPageBody>;
    if (!page.ok) throw new Error("get failed");
    expect(page.data.messages).toHaveLength(1);
    expect(page.data.messages[0]?.body).toBe("wheels up");
    expect(page.data.messages[0]?.reactions).toEqual([{ emoji: "🔥", userId: "u2" }]);
  });

  it("replays what a disconnected client missed, from its Last-Event-ID", async () => {
    const ac = new AbortController();
    const posted = (await (await POST(post({ body: "first" }), leagueContext)).json()) as ApiEnvelope<PostChatBody>;
    if (!posted.ok) throw new Error("post failed");
    const firstId = await control.xrevrange(REALTIME_CONFIG.leagueStreamKey("l1"), "+", "-", "COUNT", 1);

    currentUser.mockResolvedValue({ id: "u2" });
    const reactContext = { params: Promise.resolve({ leagueId: "l1", messageId: posted.data.message.id }) };
    await REACT(post({ emoji: "🔥" }), reactContext);

    const redis = new Redis(REDIS_URL);
    const replayed: RealtimeEvent[] = [];
    for await (const event of subscribe({ redis, streamKey: REALTIME_CONFIG.leagueStreamKey("l1"), afterId: firstId[0]![0], signal: ac.signal })) {
      replayed.push(event);
      break;
    }
    redis.disconnect();
    ac.abort();
    expect(replayed.map((event) => event.type)).toEqual(["chat.reaction"]);
  });
});
