import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { leagues, memberNotices, users } from "@/db/schema";
import { createTestDb, truncateAll } from "@/db/test-db";
import type { AuditEventInput } from "@/domain/audit";
import { INTEGRITY_CONFIG } from "@/integrity/config";
import { NOTICE_TEMPLATES } from "@/integrity/notices";
import { createAuditLogger } from "./audit-logger";
import { listNotices, markNoticesRead, notifyAffectedMember, type MemberNotice, type NotifyInput } from "./notify";

const db = createTestDb();
const NOW = "2026-08-20T18:00:00.000Z";
const LATER = "2026-08-20T19:00:00.000Z";

let eventCounter = 0;
let noticeCounter = 0;
const logger = createAuditLogger({ newId: () => `evt_${(eventCounter += 1)}` });

function autoPickEvent(): AuditEventInput {
  return {
    eventType: "draft_pick",
    actorId: null,
    actorType: "system",
    leagueId: "league_1",
    payload: { draftId: "draft_1", teamId: "team_1", playerId: "bijan", position: "RB", round: 3, pickNumber: 24, slot: "RB", slotIndex: 0, price: null, auto: true },
    occurredAt: "2026-08-20T17:00:00.000Z",
  };
}

function autoPickNotice(): NotifyInput<"draft_auto_picked"> {
  return {
    leagueId: "league_1",
    userId: "user_bob",
    noticeType: "draft_auto_picked",
    context: { leagueName: "Sunday Money", pickNumber: 24, playerName: "Bijan Robinson", position: "RB" },
    occurredAt: "2026-08-20T17:00:00.000Z",
    auditEventId: "evt_placeholder",
  };
}

async function seedOneNotice(): Promise<MemberNotice> {
  return db.transaction(async (tx) => {
    const event = await logger.record(tx, autoPickEvent());
    return notifyAffectedMember(tx, { ...autoPickNotice(), auditEventId: event.eventId });
  });
}

/** `count` notices for `userId`, strictly increasing timestamps and ids "notice_1", "notice_2", … */
async function seedNotices(userId: string, count: number): Promise<void> {
  for (let i = 0; i < count; i += 1) {
    noticeCounter += 1;
    const id = `notice_${noticeCounter}`;
    const occurredAt = new Date(Date.parse(NOW) + noticeCounter * 1000).toISOString();
    await db.transaction(async (tx) => {
      const event = await logger.record(tx, autoPickEvent());
      await notifyAffectedMember(tx, { ...autoPickNotice(), userId, occurredAt, auditEventId: event.eventId }, { newId: () => id });
    });
  }
}

beforeEach(async () => {
  await truncateAll(db);
  eventCounter = 0;
  noticeCounter = 0;
  // `member_notices` carries real FKs (unlike `audit_events` — see its docblock), so every
  // notice's `userId`/`leagueId` needs a row to point at.
  await db.insert(users).values([
    { id: "user_bob", email: "user_bob@test.local", displayName: "Bob" },
    { id: "user_alice", email: "user_alice@test.local", displayName: "Alice" },
  ]);
  await db.insert(leagues).values({ id: "league_1", name: "Sunday Money", format: "snake", teamCount: 2, commissionerUserId: "user_bob" });
});

afterAll(async () => {
  await truncateAll(db);
});

describe("notifyAffectedMember", () => {
  it("writes the rendered copy, the context and the audit event it explains", async () => {
    const notice = await db.transaction(async (tx) => {
      const event = await logger.record(tx, autoPickEvent());
      return notifyAffectedMember(
        tx,
        {
          leagueId: "league_1",
          userId: "user_bob",
          noticeType: "draft_auto_picked",
          context: { leagueName: "Sunday Money", pickNumber: 24, playerName: "Bijan Robinson", position: "RB" },
          occurredAt: "2026-08-20T17:00:00.000Z",
          auditEventId: event.eventId,
        },
        { newId: () => "notice_1" },
      );
    });

    const [row] = await db.select().from(memberNotices);
    expect(row).toMatchObject({
      id: "notice_1", userId: "user_bob", leagueId: "league_1", noticeType: "draft_auto_picked",
      title: "Your pick was made automatically", auditEventId: expect.any(String), readAt: null,
    });
    expect(row!.body).toContain("Bijan Robinson");
    expect(row!.context).toEqual(notice.context);
  });

  it("commits with the write it explains, and is lost with it", async () => {
    await expect(
      db.transaction(async (tx) => {
        await notifyAffectedMember(tx, autoPickNotice(), { newId: () => "notice_1" });
        throw new Error("the action this notice explains failed");
      }),
    ).rejects.toThrow();
    expect(await db.select().from(memberNotices)).toHaveLength(0);
  });

  it("only ever stores a type the template registry knows", async () => {
    expect(Object.keys(NOTICE_TEMPLATES)).toContain((await seedOneNotice()).noticeType);
  });
});

describe("listNotices and markNoticesRead", () => {
  it("returns only the caller's own notices, newest first, capped by config", async () => {
    await seedNotices("user_bob", INTEGRITY_CONFIG.notices.inboxSize + 5);
    await seedNotices("user_alice", 2);
    const page = await listNotices(db, "user_bob");
    expect(page.notices).toHaveLength(INTEGRITY_CONFIG.notices.inboxSize);
    expect(page.notices.every((notice) => notice.userId === "user_bob")).toBe(true);
    expect(page.notices[0]!.createdAt > page.notices[1]!.createdAt).toBe(true);
  });

  it("counts unread over the same bounded page rather than the whole table", async () => {
    await seedNotices("user_bob", 3);
    expect((await listNotices(db, "user_bob")).unreadCount).toBe(3);
    await markNoticesRead(db, { userId: "user_bob", noticeIds: ["notice_1"], readAt: NOW });
    expect((await listNotices(db, "user_bob")).unreadCount).toBe(2);
  });

  it("cannot stamp somebody else's notice read", async () => {
    await seedNotices("user_alice", 1);
    const stamped = await markNoticesRead(db, { userId: "user_bob", noticeIds: ["notice_1"], readAt: NOW });
    expect(stamped).toBe(0);
    const [row] = await db.select().from(memberNotices).where(eq(memberNotices.id, "notice_1"));
    expect(row!.readAt).toBeNull();
  });

  it("does not re-stamp a notice that is already read", async () => {
    await seedNotices("user_bob", 1);
    await markNoticesRead(db, { userId: "user_bob", noticeIds: ["notice_1"], readAt: NOW });
    expect(await markNoticesRead(db, { userId: "user_bob", noticeIds: ["notice_1"], readAt: LATER })).toBe(0);
  });
});
