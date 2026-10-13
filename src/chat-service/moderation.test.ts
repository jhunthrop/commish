import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { eq, isNull } from "drizzle-orm";
import type { Db } from "@research-ts/db/client";
import { auditEvents, chatMessageReports, chatMessages, integrityFlags, memberNotices, users } from "@/db/schema";
import type { Clock } from "@research-ts/domain/timing";
import { createAuditLogger } from "@/integrity-service/audit-logger";
import { quoteFor, type MemberNotice } from "@/integrity-service/notify";
import { REVIEW_CONFIG } from "@/reviews/config";
import { chatRemovalPhraseFor } from "@/moderation/removal";
import { REASON_FRAGMENTS } from "@/moderation/test-support";
import { createTestDb } from "@research-ts/db/test-db";
import { truncateAll } from "@/db/test-db";
import type { RealtimeEventType } from "@/lib/realtime/events";
import { postMessage } from "./chat";
import { removeChatMessageInTx, reportMessage } from "./moderation";
import { chatLeagueFixture } from "./test-support";

const db: Db = createTestDb();

const at = (iso: string): Clock => ({ now: () => iso });

let counter = 0;
const logger = createAuditLogger({ newId: () => `evt_${(counter += 1)}` });

interface Published {
  readonly type: RealtimeEventType;
  readonly leagueId: string;
  readonly payload: unknown;
}

function recorder() {
  const sent: Published[] = [];
  return { sent, publish: async (input: Published) => { sent.push(input); return "1-0"; } };
}

const noopPublish = async () => null;

/**
 * The exact bytes an open `EventSource` receives for one published frame — `src/lib/realtime/
 * sse.ts`'s own `frame()`, reproduced over a recorded publish. The wire-privacy guards below
 * assert on THIS, not on a field of a parsed object: the leak they exist to catch (final review,
 * HIGH 1) was invisible at the render level and visible in exactly this string.
 */
function sseFrameFor(published: Published): string {
  const event = { id: "1-0", type: published.type, leagueId: published.leagueId, payload: published.payload, timestamp: "2026-08-04T00:00:00.000Z" };
  return `id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

beforeEach(async () => {
  await truncateAll(db);
  counter = 0;
  await chatLeagueFixture(db);
});

afterAll(async () => {
  await truncateAll(db);
});

async function postAndGetId(userId = "u1", body = "spam it up"): Promise<string> {
  const message = await postMessage(db, { leagueId: "l1", userId, body, publish: noopPublish });
  return message.id;
}

describe("reportMessage", () => {
  it("is idempotent by primary key: reporting twice is the same report, not an error", async () => {
    const messageId = await postAndGetId();
    const first = await reportMessage(db, { messageId, leagueId: "l1", reporterUserId: "u2", reason: "spam", clock: at("2026-08-02T00:00:00Z") });
    expect(first).toEqual({ ok: true });
    const second = await reportMessage(db, { messageId, leagueId: "l1", reporterUserId: "u2", reason: "spam", clock: at("2026-08-03T00:00:00Z") });
    expect(second).toEqual({ ok: true });
  });

  it("answers not-found for a message id that doesn't exist", async () => {
    const result = await reportMessage(db, { messageId: "999999", leagueId: "l1", reporterUserId: "u2", reason: "spam" });
    expect(result).toEqual({ ok: false, status: 404, reason: "That message is no longer here." });
  });

  it("answers not-found for a message that belongs to a DIFFERENT league — you may report what you can see, and only that", async () => {
    const messageId = await postAndGetId();
    const result = await reportMessage(db, { messageId, leagueId: "l_other", reporterUserId: "u2", reason: "spam" });
    expect(result).toEqual({ ok: false, status: 404, reason: "That message is no longer here." });
  });

  async function openFlags() {
    return db.select().from(integrityFlags).where(isNull(integrityFlags.resolvedAt));
  }

  async function reportCount(messageId: string): Promise<number> {
    const rows = await db.select({ reporterUserId: chatMessageReports.reporterUserId }).from(chatMessageReports).where(eq(chatMessageReports.messageId, Number(messageId)));
    return rows.length;
  }

  it("raises exactly one open flag however many people report the same message", async () => {
    const messageId = await postAndGetId();
    await reportMessage(db, { messageId, leagueId: "l1", reporterUserId: "u2", reason: "spam" });
    // A second, distinct reporter — u1 already exists (the author); seed a third member.
    await db.insert(users).values({ id: "u3", email: "u3@test.local", displayName: "Casey Park" });
    await reportMessage(db, { messageId, leagueId: "l1", reporterUserId: "u3", reason: "abusive" });

    const flags = await openFlags();
    expect(flags).toHaveLength(1);
    expect(flags[0]).toMatchObject({ flagType: "chat_report", subjectType: "chat_message", subjectId: messageId, leagueId: null });
    expect(await reportCount(messageId)).toBe(2);
  });

  it("still treats a second report from the SAME reporter as confirmation, not an error", async () => {
    const messageId = await postAndGetId();
    await reportMessage(db, { messageId, leagueId: "l1", reporterUserId: "u2", reason: "spam" });
    expect(await reportMessage(db, { messageId, leagueId: "l1", reporterUserId: "u2", reason: "spam" })).toEqual({ ok: true });
    expect(await openFlags()).toHaveLength(1);
  });

  it("raises the flag and the report row together, or neither — the transaction proof", async () => {
    const messageId = await postAndGetId();
    const brokenAudit = { ...logger, record: async () => { throw new Error("audit append failed"); } };
    await expect(reportMessage(db, { messageId, leagueId: "l1", reporterUserId: "u2", reason: "spam", audit: brokenAudit })).rejects.toThrow("audit append failed");

    expect(await reportCount(messageId)).toBe(0);
    expect(await openFlags()).toHaveLength(0);
  });
});

describe("removeChatMessageInTx", () => {
  async function remove(input: Parameters<typeof removeChatMessageInTx>[1]) {
    return db.transaction((tx) => removeChatMessageInTx(tx, input));
  }

  it("stamps removal and returns the record, and publishes the removal on the existing chat.message frame", async () => {
    const messageId = await postAndGetId();
    const bus = recorder();

    const result = await remove({ messageId, removedByUserId: "u1", reason: "spam", clock: at("2026-08-04T00:00:00Z"), publish: bus.publish });
    expect(result).toEqual({
      ok: true,
      record: { messageId, leagueId: "l1", userId: "u1", removedByUserId: "u1", reason: "spam", removedAt: "2026-08-04T00:00:00.000Z" },
    });

    expect(bus.sent).toHaveLength(1);
    expect(bus.sent[0]?.type).toBe("chat.message");
    const payload = bus.sent[0]?.payload as { readonly message: { readonly body: string; readonly gif: unknown; readonly removal: unknown } };
    expect(payload.message.body).toBe("");
    expect(payload.message.gif).toBeNull();
    expect(payload.message.removal).toEqual({ at: "2026-08-04T00:00:00.000Z" });
  });

  /**
   * THE WIRE-LEVEL GUARD for the live half (final review, HIGH 1). `removal.phrase` used to ride
   * on this frame, broadcast to the whole league's stream — unrendered, but readable off the SSE
   * connection by any member. Asserted on the serialized frame itself, for every reason in the
   * closed vocabulary, because that string is where the disclosure actually happened.
   */
  it("broadcasts no removal reason on the live frame, in any form, for any reason in the vocabulary", async () => {
    for (const reason of ["spam", "abusive", "other"]) {
      await truncateAll(db);
      await chatLeagueFixture(db);
      counter = 0;
      const messageId = await postAndGetId("u1", "the words the room keeps");
      const bus = recorder();

      await remove({ messageId, removedByUserId: "u1", reason, clock: at("2026-08-04T00:00:00Z"), publish: bus.publish, audit: logger });

      const frame = sseFrameFor(bus.sent[0]!);
      for (const fragment of REASON_FRAGMENTS) {
        expect(frame).not.toContain(fragment);
      }
      // ...and the author's private notice still carries it, so the reason was not simply lost.
      const [notice] = await db.select().from(memberNotices);
      expect(notice!.context).toEqual({ leagueName: "Sunday Money", reason });
    }
  });

  it("refuses a message id that doesn't exist", async () => {
    const result = await remove({ messageId: "999999", removedByUserId: "u1", reason: "spam" });
    expect(result).toEqual({ ok: false, reason: 'No message with id "999999".' });
  });

  it("refuses a reason longer than REVIEW_CONFIG.removalReason.maxLength, before any write", async () => {
    const tooLong = "x".repeat(REVIEW_CONFIG.removalReason.maxLength + 1);
    const result = await remove({ messageId: "999999", removedByUserId: "u1", reason: tooLong });
    expect(result).toEqual({ ok: false, reason: `Notes on a removal are limited to ${REVIEW_CONFIG.removalReason.maxLength} characters.` });
  });

  it("refuses to re-stamp an already-removed message — the no-re-stamp invariant, enforced here", async () => {
    const messageId = await postAndGetId();
    const first = await remove({ messageId, removedByUserId: "u1", reason: "spam", clock: at("2026-08-04T00:00:00Z") });
    expect(first.ok).toBe(true);

    const second = await remove({ messageId, removedByUserId: "u2", reason: "abusive", clock: at("2026-08-05T00:00:00Z") });
    expect(second).toEqual({ ok: false, reason: `Message "${messageId}" is already removed.` });

    const [row] = await db.select().from(chatMessages).where(eq(chatMessages.id, Number(messageId)));
    expect(row).toMatchObject({ removedByUserId: "u1", removalReason: "spam" });
    expect(row?.removedAt?.toISOString()).toBe("2026-08-04T00:00:00.000Z");
  });

  it("records admin_action on the platform chain, never a league-scoped event", async () => {
    const messageId = await postAndGetId("u1");
    await remove({ messageId, removedByUserId: "u2", reason: "abusive", clock: at("2026-08-04T00:00:00Z"), audit: logger });

    const [event] = await db.select().from(auditEvents).where(eq(auditEvents.eventType, "admin_action"));
    expect(event).toMatchObject({ chainScope: "platform", leagueId: null, actorId: "u2", actorType: "user" });
    expect(event!.payload).toEqual({ action: "chat_message_removed", messageId, leagueId: "l1", authorUserId: "u1", reason: "abusive", flagId: null });

    // No-re-stamp means a second attempt records nothing.
    await remove({ messageId, removedByUserId: "u1", reason: "spam", clock: at("2026-08-05T00:00:00Z"), audit: logger });
    expect(await db.select().from(auditEvents).where(eq(auditEvents.eventType, "admin_action"))).toHaveLength(1);
  });

  it("records nothing when there is no message to remove", async () => {
    await remove({ messageId: "999999", removedByUserId: "u1", reason: "spam", audit: logger });
    expect(await db.select().from(auditEvents)).toHaveLength(0);
  });

  it("rolls back the removal stamp when the audit append fails", async () => {
    const messageId = await postAndGetId();
    const brokenAudit = { ...logger, record: async () => { throw new Error("audit append failed"); } };
    await expect(remove({ messageId, removedByUserId: "u1", reason: "spam", clock: at("2026-08-04T00:00:00Z"), audit: brokenAudit })).rejects.toThrow("audit append failed");

    const [row] = await db.select().from(chatMessages).where(eq(chatMessages.id, Number(messageId)));
    expect(row?.removedAt).toBeNull();
  });

  describe("notices", () => {
    it("writes the notice the removed message's author can read, with a real league name", async () => {
      const messageId = await postAndGetId("u1");
      await remove({ messageId, removedByUserId: "u2", reason: "other", clock: at("2026-08-04T00:00:00Z"), audit: logger });

      const [event] = await db.select().from(auditEvents).where(eq(auditEvents.eventType, "admin_action"));
      const [notice] = await db.select().from(memberNotices);
      expect(notice).toMatchObject({
        userId: "u1",
        leagueId: "l1",
        noticeType: "chat_message_removed",
        title: "We removed one of your messages",
        auditEventId: event!.eventId,
        readAt: null,
      });
      expect(notice!.body).toBe(
        "An operator removed a message you posted in Sunday Money. Your leaguemates can see that the message went and who posted it, and they can no longer read it. We keep your words on file exactly as you wrote them. There is no reply to this message.",
      );
      expect(notice!.context).toEqual({ leagueName: "Sunday Money", reason: "other" });
    });

    it("maps the reason through chat's OWN phrase mapper, for every value in the closed vocabulary — never reviews' own words", async () => {
      for (const reason of ["spam", "abusive", "other"]) {
        await truncateAll(db);
        await chatLeagueFixture(db);
        counter = 0;
        const messageId = await postAndGetId("u1");
        await remove({ messageId, removedByUserId: "u2", reason, clock: at("2026-08-04T00:00:00Z"), audit: logger });

        const [row] = await db.select().from(memberNotices);
        const stored: MemberNotice = {
          id: row!.id, userId: row!.userId, leagueId: row!.leagueId, noticeType: "chat_message_removed",
          title: row!.title, body: row!.body, context: row!.context, auditEventId: row!.auditEventId,
          createdAt: row!.createdAt.toISOString(), readAt: null,
        };
        expect(quoteFor(stored)).toBe(chatRemovalPhraseFor(reason));
        expect(quoteFor(stored)).not.toBe(reason);
      }
    });

    /**
     * Fix round 1 (review HIGH, direct regression guard): the "other" reason used to render
     * reviews' own catch-all phrase, "breaking the review rules", in a CHAT notice — a
     * reviews-domain sentence in a chat surface. This is the exact case that broke.
     */
    it("never renders reviews' own catch-all phrase in a chat removal notice", async () => {
      const messageId = await postAndGetId("u1");
      await remove({ messageId, removedByUserId: "u2", reason: "other", clock: at("2026-08-04T00:00:00Z"), audit: logger });

      const [row] = await db.select().from(memberNotices);
      const stored: MemberNotice = {
        id: row!.id, userId: row!.userId, leagueId: row!.leagueId, noticeType: "chat_message_removed",
        title: row!.title, body: row!.body, context: row!.context, auditEventId: row!.auditEventId,
        createdAt: row!.createdAt.toISOString(), readAt: null,
      };
      expect(quoteFor(stored)).toBe("breaking the chat rules");
      expect(quoteFor(stored)).not.toBe("breaking the review rules");
    });

    it("writes no notice when there is nothing to remove", async () => {
      await remove({ messageId: "999999", removedByUserId: "u1", reason: "spam", audit: logger });
      expect(await db.select().from(memberNotices)).toHaveLength(0);
    });

    it("rolls back the removal stamp and its audit event when the notice write fails", async () => {
      const messageId = await postAndGetId();
      const brokenNotify: Parameters<typeof removeChatMessageInTx>[1]["notify"] = async () => {
        throw new Error("notice write failed");
      };
      await expect(
        remove({ messageId, removedByUserId: "u1", reason: "spam", clock: at("2026-08-04T00:00:00Z"), audit: logger, notify: brokenNotify }),
      ).rejects.toThrow("notice write failed");

      const [row] = await db.select().from(chatMessages).where(eq(chatMessages.id, Number(messageId)));
      expect(row?.removedAt).toBeNull();
      expect(await db.select().from(auditEvents)).toHaveLength(0);
    });
  });

  describe("publish failure", () => {
    it("does not fail the removal when publishing fails — Postgres is authoritative", async () => {
      const messageId = await postAndGetId();
      const result = await remove({
        messageId,
        removedByUserId: "u1",
        reason: "spam",
        clock: at("2026-08-04T00:00:00Z"),
        publish: async () => {
          throw new Error("redis unreachable");
        },
      });
      expect(result.ok).toBe(true);
    });

    it("routes a publish failure through the injected error sink instead of console.error", async () => {
      const messageId = await postAndGetId();
      const failures: Array<{ readonly type: string; readonly leagueId: string }> = [];
      await remove({
        messageId,
        removedByUserId: "u1",
        reason: "spam",
        clock: at("2026-08-04T00:00:00Z"),
        publish: async () => {
          throw new Error("redis unreachable");
        },
        onPublishError: (_error, event) => failures.push({ type: event.type, leagueId: event.leagueId }),
      });
      expect(failures).toEqual([{ type: "chat.message", leagueId: "l1" }]);
    });
  });
});
