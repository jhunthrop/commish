import { describe, it, expect, beforeEach } from "vitest";
import { CHAT_CONFIG } from "@/chat/config";
import type { Db } from "@/db/client";
import { chatReactions } from "@/db/schema";
import { createTestDb, truncateAll } from "@/db/test-db";
import type { RealtimeEventType } from "@/lib/realtime/events";
import { listMessages, postMessage, toggleReaction } from "./chat";
import { chatLeagueFixture } from "./test-support";

const db: Db = createTestDb();

interface Published {
  readonly type: RealtimeEventType;
  readonly leagueId: string;
  readonly payload: unknown;
}

function recorder() {
  const sent: Published[] = [];
  return {
    sent,
    publish: async (input: Published) => {
      sent.push(input);
      return "1-0";
    },
  };
}

beforeEach(async () => {
  await truncateAll(db);
  await chatLeagueFixture(db);
});

describe("postMessage", () => {
  it("persists the message with the author's profile and publishes chat.message", async () => {
    const bus = recorder();
    const message = await postMessage(db, { leagueId: "l1", userId: "u1", body: "wheels up", publish: bus.publish });

    expect(message.body).toBe("wheels up");
    expect(message.authorUserId).toBe("u1");
    expect(message.authorName).toBe("Alex Rivera");
    expect(message.reactions).toEqual([]);
    expect(bus.sent).toEqual([{ type: "chat.message", leagueId: "l1", payload: { message } }]);
  });

  it("survives a reload — the message is still there on a fresh read", async () => {
    const bus = recorder();
    await postMessage(db, { leagueId: "l1", userId: "u1", body: "history please", publish: bus.publish });
    const page = await listMessages(db, { leagueId: "l1" });
    expect(page.messages.map((m) => m.body)).toEqual(["history please"]);
  });

  it("does not fail the write when publishing fails — Postgres is authoritative", async () => {
    const message = await postMessage(db, {
      leagueId: "l1",
      userId: "u1",
      body: "redis is down",
      publish: async () => {
        throw new Error("redis unreachable");
      },
    });
    const page = await listMessages(db, { leagueId: "l1" });
    expect(page.messages.map((m) => m.id)).toEqual([message.id]);
  });

  it("routes a publish failure through the injected error sink instead of console.error", async () => {
    const failures: Array<{ readonly error: unknown; readonly type: string; readonly leagueId: string }> = [];
    const message = await postMessage(db, {
      leagueId: "l1",
      userId: "u1",
      body: "sink me",
      publish: async () => {
        throw new Error("redis unreachable");
      },
      onPublishError: (error, event) => {
        failures.push({ error, type: event.type, leagueId: event.leagueId });
      },
    });

    expect(failures).toEqual([{ error: expect.any(Error), type: "chat.message", leagueId: "l1" }]);
    const page = await listMessages(db, { leagueId: "l1" });
    expect(page.messages.map((m) => m.id)).toEqual([message.id]);
  });
});

describe("listMessages", () => {
  it("returns one page of the newest messages, oldest first, and says more exist", async () => {
    const bus = recorder();
    for (let i = 1; i <= CHAT_CONFIG.pageSize + 5; i += 1) {
      await postMessage(db, { leagueId: "l1", userId: "u1", body: `m${i}`, publish: bus.publish });
    }
    const page = await listMessages(db, { leagueId: "l1" });
    expect(page.messages).toHaveLength(CHAT_CONFIG.pageSize);
    expect(page.hasMore).toBe(true);
    expect(page.messages[0]?.body).toBe("m6");
    expect(page.messages[CHAT_CONFIG.pageSize - 1]?.body).toBe(`m${CHAT_CONFIG.pageSize + 5}`);
  });

  it("pages backwards from a cursor and reports when the history is exhausted", async () => {
    const bus = recorder();
    for (let i = 1; i <= CHAT_CONFIG.pageSize + 5; i += 1) {
      await postMessage(db, { leagueId: "l1", userId: "u1", body: `m${i}`, publish: bus.publish });
    }
    const first = await listMessages(db, { leagueId: "l1" });
    const earlier = await listMessages(db, { leagueId: "l1", before: first.messages[0]!.id });
    expect(earlier.messages.map((m) => m.body)).toEqual(["m1", "m2", "m3", "m4", "m5"]);
    expect(earlier.hasMore).toBe(false);
  });

  it("never returns another league's messages", async () => {
    const bus = recorder();
    await postMessage(db, { leagueId: "l1", userId: "u1", body: "ours", publish: bus.publish });
    const page = await listMessages(db, { leagueId: "l_other" });
    expect(page.messages).toEqual([]);
  });
});

describe("toggleReaction", () => {
  it("adds, then removes, the same reaction and publishes both transitions", async () => {
    const bus = recorder();
    const message = await postMessage(db, { leagueId: "l1", userId: "u1", body: "clutch", publish: bus.publish });

    const added = await toggleReaction(db, { leagueId: "l1", messageId: message.id, userId: "u2", emoji: "🔥", publish: bus.publish });
    expect(added).toEqual({ ok: true, action: "added", reactions: [{ emoji: "🔥", userId: "u2" }] });

    const removed = await toggleReaction(db, { leagueId: "l1", messageId: message.id, userId: "u2", emoji: "🔥", publish: bus.publish });
    expect(removed).toEqual({ ok: true, action: "removed", reactions: [] });

    expect(bus.sent.slice(1)).toEqual([
      { type: "chat.reaction", leagueId: "l1", payload: { messageId: message.id, emoji: "🔥", userId: "u2", action: "added" } },
      { type: "chat.reaction", leagueId: "l1", payload: { messageId: message.id, emoji: "🔥", userId: "u2", action: "removed" } },
    ]);
  });

  it("refuses a message that isn't in this league", async () => {
    const bus = recorder();
    const message = await postMessage(db, { leagueId: "l1", userId: "u1", body: "ours", publish: bus.publish });
    const result = await toggleReaction(db, { leagueId: "l_other", messageId: message.id, userId: "u2", emoji: "🔥", publish: bus.publish });
    expect(result).toEqual({ ok: false, status: 404, reason: "That message is no longer here." });
  });

  it("refuses an id that doesn't exist", async () => {
    const bus = recorder();
    const result = await toggleReaction(db, { leagueId: "l1", messageId: "999999", userId: "u2", emoji: "🔥", publish: bus.publish });
    expect(result.ok).toBe(false);
  });
});

describe("toggleReaction — atomic transition", () => {
  it('reports "removed" when another writer already holds the reaction', async () => {
    const bus = recorder();
    const message = await postMessage(db, { leagueId: "l1", userId: "u1", body: "already there", publish: bus.publish });
    // Bypasses the service, simulating a reaction some other writer already committed.
    await db.insert(chatReactions).values({ messageId: Number(message.id), userId: "u2", emoji: "🔥" });

    const result = await toggleReaction(db, { leagueId: "l1", messageId: message.id, userId: "u2", emoji: "🔥", publish: bus.publish });
    expect(result).toEqual({ ok: true, action: "removed", reactions: [] });
  });

  it('reports "added" when nothing is there yet', async () => {
    const bus = recorder();
    const message = await postMessage(db, { leagueId: "l1", userId: "u1", body: "nothing yet", publish: bus.publish });

    const result = await toggleReaction(db, { leagueId: "l1", messageId: message.id, userId: "u2", emoji: "🔥", publish: bus.publish });
    expect(result).toEqual({ ok: true, action: "added", reactions: [{ emoji: "🔥", userId: "u2" }] });
  });

  it('resolves a concurrent double-add without double-reporting "added"', async () => {
    const bus = recorder();
    const message = await postMessage(db, { leagueId: "l1", userId: "u1", body: "race to add", publish: bus.publish });

    const [r1, r2] = await Promise.all([
      toggleReaction(db, { leagueId: "l1", messageId: message.id, userId: "u2", emoji: "🔥", publish: bus.publish }),
      toggleReaction(db, { leagueId: "l1", messageId: message.id, userId: "u2", emoji: "🔥", publish: bus.publish }),
    ]);

    // Exactly one writer's INSERT wins the unique index and reports "added"; the other sees the
    // conflict and, correctly, toggles it back off — never two "added"s for one physical row.
    const actions = [r1, r2].map((r) => (r.ok ? r.action : "error")).sort();
    expect(actions).toEqual(["added", "removed"]);

    const reactionEvents = bus.sent.filter((event) => event.type === "chat.reaction");
    expect(reactionEvents).toHaveLength(2);
    expect(reactionEvents.map((event) => (event.payload as { readonly action: string }).action).sort()).toEqual(["added", "removed"]);
  });

  it("resolves a concurrent double-remove without a phantom publish", async () => {
    const bus = recorder();
    const message = await postMessage(db, { leagueId: "l1", userId: "u1", body: "race to remove", publish: bus.publish });
    await db.insert(chatReactions).values({ messageId: Number(message.id), userId: "u2", emoji: "🔥" });

    const [r1, r2] = await Promise.all([
      toggleReaction(db, { leagueId: "l1", messageId: message.id, userId: "u2", emoji: "🔥", publish: bus.publish }),
      toggleReaction(db, { leagueId: "l1", messageId: message.id, userId: "u2", emoji: "🔥", publish: bus.publish }),
    ]);

    // Both callers see the reaction gone and both honestly report "removed", but only the one
    // whose DELETE actually removed a row gets to publish — the loser's would-be publish is the
    // phantom this fix exists to prevent.
    expect(r1).toEqual({ ok: true, action: "removed", reactions: [] });
    expect(r2).toEqual({ ok: true, action: "removed", reactions: [] });

    const reactionEvents = bus.sent.filter((event) => event.type === "chat.reaction");
    expect(reactionEvents).toEqual([
      { type: "chat.reaction", leagueId: "l1", payload: { messageId: message.id, emoji: "🔥", userId: "u2", action: "removed" } },
    ]);
  });
});
