import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { CHAT_CONFIG } from "@/chat/config";
import { REASON_FRAGMENTS } from "@/moderation/test-support";
import type { Db } from "@/db/client";
import { chatMessages, chatReactions, users } from "@/db/schema";
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

const TOUCHDOWN_GIF = {
  url: "https://media.giphy.com/media/abc123/giphy.gif",
  previewUrl: "https://media.giphy.com/media/abc123/200.gif",
  alt: "Touchdown Dance GIF",
  width: 480,
  height: 270,
};

describe("postMessage", () => {
  it("speaks as the author's TEAM in this league, and publishes chat.message", async () => {
    const bus = recorder();
    const message = await postMessage(db, { leagueId: "l1", userId: "u1", body: "wheels up", publish: bus.publish });

    expect(message.body).toBe("wheels up");
    expect(message.authorUserId).toBe("u1");
    // Team identity, not legal identity (persona review): u1 owns Bay Bandits in l1.
    expect(message.authorName).toBe("Bay Bandits");
    expect(message.reactions).toEqual([]);
    expect(message.gif).toBeNull();
    expect(bus.sent).toEqual([{ type: "chat.message", leagueId: "l1", payload: { message } }]);
  });

  it("writes a GIF and its body in one insert, and folds it straight back as the message's gif — ruling 17, no second event type", async () => {
    const bus = recorder();
    const message = await postMessage(db, {
      leagueId: "l1",
      userId: "u1",
      body: TOUCHDOWN_GIF.alt,
      gif: TOUCHDOWN_GIF,
      publish: bus.publish,
    });

    expect(message.gif).toEqual(TOUCHDOWN_GIF);
    expect(message.body).toBe(TOUCHDOWN_GIF.alt);
    expect(bus.sent).toEqual([{ type: "chat.message", leagueId: "l1", payload: { message } }]);

    // Survives a reload identically — a GIF message is read back the same shape it was written.
    const page = await listMessages(db, { leagueId: "l1" });
    expect(page.messages).toHaveLength(1);
    expect(page.messages[0]?.gif).toEqual(TOUCHDOWN_GIF);
  });

  it("falls back to the display name for an author with no team here (a teamless commissioner)", async () => {
    const bus = recorder();
    await db.insert(users).values({ id: "u_comm", email: "comm@test.local", displayName: "Sam Field" });
    const message = await postMessage(db, { leagueId: "l1", userId: "u_comm", body: "settle down", publish: bus.publish });
    expect(message.authorName).toBe("Sam Field");

    const page = await listMessages(db, { leagueId: "l1" });
    expect(page.messages.map((m) => m.authorName)).toEqual(["Sam Field"]);
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

  describe("a removed message", () => {
    it("withholds body and gif but keeps attribution, and stamps the removal with its time and nothing else", async () => {
      const bus = recorder();
      const posted = await postMessage(db, { leagueId: "l1", userId: "u1", body: "should never be sent", publish: bus.publish });
      await db
        .update(chatMessages)
        .set({ removedAt: new Date("2026-08-20T00:00:00.000Z"), removedByUserId: "u1", removalReason: "spam" })
        .where(eq(chatMessages.id, Number(posted.id)));

      const page = await listMessages(db, { leagueId: "l1" });
      expect(page.messages).toHaveLength(1);
      const [message] = page.messages;
      expect(message!.body).toBe("");
      expect(message!.gif).toBeNull();
      expect(message!.authorUserId).toBe("u1");
      expect(message!.authorName).toBe("Bay Bandits");
      expect(message!.removal).toEqual({ at: "2026-08-20T00:00:00.000Z" });
    });

    /**
     * THE WIRE-LEVEL GUARD (final review, HIGH 1). The reason used to ride on
     * `ChatMessageView.removal.phrase`: no room-visible surface rendered it, but every member of
     * the league received it in this exact payload and could read it out of devtools. Unrendered
     * is not unsent, so the assertion is made where the leak was — over the SERIALIZED page, the
     * bytes the route hands the browser, for every reason in the closed vocabulary.
     */
    it("puts no removal reason on the wire, in any form, for any reason in the vocabulary", async () => {
      const bus = recorder();
      for (const reason of ["spam", "abusive", "other"]) {
        await truncateAll(db);
        await chatLeagueFixture(db);
        const posted = await postMessage(db, { leagueId: "l1", userId: "u1", body: "the words the room keeps", publish: bus.publish });
        await db
          .update(chatMessages)
          .set({ removedAt: new Date("2026-08-20T00:00:00.000Z"), removedByUserId: "u1", removalReason: reason })
          .where(eq(chatMessages.id, Number(posted.id)));

        const page = await listMessages(db, { leagueId: "l1" });
        // Exactly what `GET /api/leagues/[leagueId]/chat` serializes into its response body.
        const onTheWire = JSON.stringify(page);
        for (const fragment of REASON_FRAGMENTS) {
          expect(onTheWire).not.toContain(fragment);
        }
        // The author's own words are withheld too — the same rule, proven on the same bytes.
        expect(onTheWire).not.toContain("the words the room keeps");
      }
    });

    it("withholds a removed GIF message's url too — the stamp covers it by construction", async () => {
      const bus = recorder();
      const posted = await postMessage(db, { leagueId: "l1", userId: "u1", body: TOUCHDOWN_GIF.alt, gif: TOUCHDOWN_GIF, publish: bus.publish });
      await db
        .update(chatMessages)
        .set({ removedAt: new Date("2026-08-20T00:00:00.000Z"), removedByUserId: "u1", removalReason: "other" })
        .where(eq(chatMessages.id, Number(posted.id)));

      const page = await listMessages(db, { leagueId: "l1" });
      expect(page.messages[0]?.gif).toBeNull();
      expect(page.messages[0]?.body).toBe("");
    });

    it("reports removal: null for every message that stands", async () => {
      const bus = recorder();
      await postMessage(db, { leagueId: "l1", userId: "u1", body: "still here", publish: bus.publish });
      const page = await listMessages(db, { leagueId: "l1" });
      expect(page.messages[0]?.removal).toBeNull();
    });
  });
});

describe("toggleReaction", () => {
  it("adds, then removes, the same reaction and publishes both transitions", async () => {
    const bus = recorder();
    const message = await postMessage(db, { leagueId: "l1", userId: "u1", body: "clutch", publish: bus.publish });

    const added = await toggleReaction(db, { leagueId: "l1", messageId: message.id, userId: "u2", emoji: "🔥", publish: bus.publish });
    expect(added).toEqual({ ok: true, action: "added" });

    const removed = await toggleReaction(db, { leagueId: "l1", messageId: message.id, userId: "u2", emoji: "🔥", publish: bus.publish });
    expect(removed).toEqual({ ok: true, action: "removed" });

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

  it("does not fail the toggle when publishing fails — the write is authoritative", async () => {
    const bus = recorder();
    const message = await postMessage(db, { leagueId: "l1", userId: "u1", body: "redis is down", publish: bus.publish });

    const result = await toggleReaction(db, {
      leagueId: "l1",
      messageId: message.id,
      userId: "u2",
      emoji: "🔥",
      publish: async () => {
        throw new Error("redis unreachable");
      },
    });

    expect(result).toEqual({ ok: true, action: "added" });
  });

  it("routes a publish failure through the injected error sink instead of console.error", async () => {
    const bus = recorder();
    const message = await postMessage(db, { leagueId: "l1", userId: "u1", body: "sink me", publish: bus.publish });
    const failures: Array<{ readonly error: unknown; readonly type: string; readonly leagueId: string }> = [];

    const result = await toggleReaction(db, {
      leagueId: "l1",
      messageId: message.id,
      userId: "u2",
      emoji: "🔥",
      publish: async () => {
        throw new Error("redis unreachable");
      },
      onPublishError: (error, event) => {
        failures.push({ error, type: event.type, leagueId: event.leagueId });
      },
    });

    expect(failures).toEqual([{ error: expect.any(Error), type: "chat.reaction", leagueId: "l1" }]);
    expect(result).toEqual({ ok: true, action: "added" });
  });
});

describe("toggleReaction — atomic transition", () => {
  it('reports "removed" when another writer already holds the reaction', async () => {
    const bus = recorder();
    const message = await postMessage(db, { leagueId: "l1", userId: "u1", body: "already there", publish: bus.publish });
    // Bypasses the service, simulating a reaction some other writer already committed.
    await db.insert(chatReactions).values({ messageId: Number(message.id), userId: "u2", emoji: "🔥" });

    const result = await toggleReaction(db, { leagueId: "l1", messageId: message.id, userId: "u2", emoji: "🔥", publish: bus.publish });
    expect(result).toEqual({ ok: true, action: "removed" });
  });

  it('reports "added" when nothing is there yet', async () => {
    const bus = recorder();
    const message = await postMessage(db, { leagueId: "l1", userId: "u1", body: "nothing yet", publish: bus.publish });

    const result = await toggleReaction(db, { leagueId: "l1", messageId: message.id, userId: "u2", emoji: "🔥", publish: bus.publish });
    expect(result).toEqual({ ok: true, action: "added" });
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
    expect(r1).toEqual({ ok: true, action: "removed" });
    expect(r2).toEqual({ ok: true, action: "removed" });

    const reactionEvents = bus.sent.filter((event) => event.type === "chat.reaction");
    expect(reactionEvents).toEqual([
      { type: "chat.reaction", leagueId: "l1", payload: { messageId: message.id, emoji: "🔥", userId: "u2", action: "removed" } },
    ]);
  });
});
