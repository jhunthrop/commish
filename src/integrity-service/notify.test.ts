import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { leagues, memberNotices, users } from "@/db/schema";
import { createTestDb, truncateAll } from "@/db/test-db";
import type { AuditEventInput } from "@/domain/audit";
import { INTEGRITY_CONFIG } from "@/integrity/config";
import { NOTICE_TEMPLATES } from "@/integrity/notices";
import { REMOVAL_REASON_VALUES, removalPhraseFor } from "@/reviews/config";
import { chatRemovalPhraseFor } from "@/moderation/removal";
import type { PublishToUserFn } from "@/lib/realtime/publish";
import { createAuditLogger } from "./audit-logger";
import { deliverNotice, listNotices, markNoticesRead, notifyAffectedMember, quoteFor, type MemberNotice, type NotifyInput } from "./notify";

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
      title: "We made your pick for you", auditEventId: expect.any(String), readAt: null,
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

  /**
   * HIGH-2's belt. The braces are the boundary schemas, which now refuse a league or team name
   * carrying a bidi override, so nothing written from today forward reaches here dirty. This is
   * for what is ALREADY in Postgres: ruling 12 freezes the copy composed here and never
   * re-renders it, so a `U+202E` that reached `body` would reverse the platform's own sentence in
   * a member's inbox for the life of the row, and repairing that row is what ruling 12 forbids.
   */
  it("strips characters a reader cannot see out of the copy it freezes, wherever the name came from", async () => {
    const rtlOverride = String.fromCharCode(0x202e);
    const zeroWidth = String.fromCharCode(0x200b);
    const notice = await db.transaction(async (tx) => {
      const event = await logger.record(tx, autoPickEvent());
      return notifyAffectedMember(
        tx,
        {
          ...autoPickNotice(),
          context: { leagueName: `${rtlOverride}Sunday Money`, pickNumber: 24, playerName: `Bijan${zeroWidth} Robinson`, position: "RB" },
          auditEventId: event.eventId,
        },
        { newId: () => "notice_1" },
      );
    });

    const [row] = await db.select().from(memberNotices);
    expect(row!.body).toContain("in Sunday Money");
    expect(row!.body).toContain("Bijan Robinson");
    expect(row!.body).not.toContain(rtlOverride);
    expect(row!.body).not.toContain(zeroWidth);
    expect(notice.body).toBe(row!.body);
    // `context` keeps what it was rendered FROM, untouched: it is provenance, not copy, and a
    // sanitized copy of the input would make a template change unauditable.
    expect(row!.context).toMatchObject({ leagueName: `${rtlOverride}Sunday Money` });
  });
});

describe("deliverNotice — ruling 13's live half", () => {
  function published(): { calls: Parameters<PublishToUserFn>[0][]; publish: PublishToUserFn } {
    const calls: Parameters<PublishToUserFn>[0][] = [];
    const publish: PublishToUserFn = async (input) => {
      calls.push(input);
      return "1-0";
    };
    return { calls, publish };
  }

  it("publishes a content-free frame to the notice's own user, addressed by its league", async () => {
    const notice = await seedOneNotice();
    const { calls, publish } = published();
    await deliverNotice(notice, publish);
    expect(calls).toEqual([
      { userId: "user_bob", leagueId: "league_1", type: "notice.created", payload: { noticeId: notice.id, noticeType: "draft_auto_picked" } },
    ]);
  });

  it("never publishes a notice with no league — the frame exists to nudge an open page, and a league-less notice has none", async () => {
    const leagueLess: MemberNotice = {
      id: "notice_review_removed",
      userId: "user_bob",
      leagueId: null,
      noticeType: "review_removed",
      title: "Your review was removed",
      body: "…",
      context: { reason: "off topic" },
      auditEventId: "evt_1",
      createdAt: NOW,
      readAt: null,
    };
    const { calls, publish } = published();
    await deliverNotice(leagueLess, publish);
    expect(calls).toHaveLength(0);
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

  it("is a no-op for an empty id list, without touching the database", async () => {
    // The same "a caller sending nothing is a no-op, not a query" shape `recordAll`'s empty-batch
    // guard uses. Asserted by NOT seeding anything: a query issued against an empty table would
    // still return 0, so the only way to tell "skipped" from "queried and matched nothing" is to
    // leave nothing there to match.
    expect(await markNoticesRead(db, { userId: "user_bob", noticeIds: [], readAt: NOW })).toBe(0);
  });
});

describe("quoteFor", () => {
  /** HIGH-3: the blockquote used to print the stored enum, so an author's inbox read "other". */
  it("renders the AUTHOR-FACING PHRASE for every reason in the closed vocabulary, never the token", () => {
    for (const reason of REMOVAL_REASON_VALUES) {
      const notice: MemberNotice = {
        id: "notice_1", userId: "user_bob", leagueId: null, noticeType: "review_removed",
        title: "We removed your review", body: "...", context: { reason },
        auditEventId: "evt_1", createdAt: NOW, readAt: null,
      };
      expect(quoteFor(notice)).toBe(removalPhraseFor(reason));
      expect(quoteFor(notice)).not.toBe(reason);
    }
  });

  /**
   * The chat sibling of the test above — the SAME branch shape, but through `chatRemovalPhraseFor`
   * (fix round 1), NOT `removalPhraseFor`: the two domains' generic fallback differs.
   */
  it("renders the AUTHOR-FACING PHRASE for a chat_message_removed notice too, through chat's OWN mapper, never the token", () => {
    for (const reason of REMOVAL_REASON_VALUES) {
      const notice: MemberNotice = {
        id: "notice_1", userId: "user_bob", leagueId: "league_1", noticeType: "chat_message_removed",
        title: "We removed one of your messages", body: "...", context: { leagueName: "Sunday Money", reason },
        auditEventId: "evt_1", createdAt: NOW, readAt: null,
      };
      expect(quoteFor(notice)).toBe(chatRemovalPhraseFor(reason));
      expect(quoteFor(notice)).not.toBe(reason);
    }
  });

  /** Direct regression guard (fix round 1): "other" used to render reviews' own catch-all phrase. */
  it("never renders reviews' own catch-all phrase for a chat_message_removed notice", () => {
    const notice: MemberNotice = {
      id: "notice_1", userId: "user_bob", leagueId: "league_1", noticeType: "chat_message_removed",
      title: "We removed one of your messages", body: "...", context: { leagueName: "Sunday Money", reason: "other" },
      auditEventId: "evt_1", createdAt: NOW, readAt: null,
    };
    expect(quoteFor(notice)).toBe("breaking the chat rules");
    expect(quoteFor(notice)).not.toBe("breaking the review rules");
  });

  it("is null for a chat_message_removed notice whose context reason is not a string", () => {
    const notice: MemberNotice = {
      id: "notice_1", userId: "user_bob", leagueId: "league_1", noticeType: "chat_message_removed",
      title: "We removed one of your messages", body: "…", context: { leagueName: "Sunday Money" },
      auditEventId: "evt_1", createdAt: NOW, readAt: null,
    };
    expect(quoteFor(notice)).toBeNull();
  });

  it("falls back to the generic phrase for a stored value from outside that vocabulary", () => {
    // Rows written by hand in SQL, or before the script constrained `--reason`. The mapper's own
    // docblock has always said a stored value must not be printed raw; this is that rule holding.
    const notice: MemberNotice = {
      id: "notice_1", userId: "user_bob", leagueId: null, noticeType: "review_removed",
      title: "We removed your review", body: "...", context: { reason: "internal note: ticket 4821" },
      auditEventId: "evt_1", createdAt: NOW, readAt: null,
    };
    expect(quoteFor(notice)).toBe("breaking the review rules");
  });

  it("is null for a review_removed notice whose context reason is not a string", () => {
    const notice: MemberNotice = {
      id: "notice_1", userId: "user_bob", leagueId: null, noticeType: "review_removed",
      title: "Your review was removed", body: "…", context: {},
      auditEventId: "evt_1", createdAt: NOW, readAt: null,
    };
    expect(quoteFor(notice)).toBeNull();
  });

  it("is null for any other notice type", async () => {
    expect(quoteFor(await seedOneNotice())).toBeNull();
  });

  it("renders the operator's own note VERBATIM for operator_warning, not through a mapper", () => {
    const notice: MemberNotice = {
      id: "notice_1", userId: "user_bob", leagueId: "league_1", noticeType: "operator_warning",
      title: "An operator left you a note", body: "...",
      context: { leagueName: "Sunday Money", note: "Keep the trash talk about the teams." },
      auditEventId: "evt_1", createdAt: NOW, readAt: null,
    };
    expect(quoteFor(notice)).toBe("Keep the trash talk about the teams.");
  });

  /**
   * Operators are trusted with what they choose to SAY, not with what a bidi override or a
   * zero-width character would make a reader's browser DO with it — the same HIGH-2 belt
   * `notifyAffectedMember`'s own composed `title`/`body` gets, applied here because `context.note`
   * is stored unstripped (it is provenance) and this is the one place it is ever rendered.
   */
  it("strips characters a reader cannot see out of the operator's note at render time", () => {
    const rtlOverride = String.fromCharCode(0x202e);
    const zeroWidth = String.fromCharCode(0x200b);
    const notice: MemberNotice = {
      id: "notice_1", userId: "user_bob", leagueId: "league_1", noticeType: "operator_warning",
      title: "An operator left you a note", body: "...",
      context: { leagueName: "Sunday Money", note: `${rtlOverride}Keep the trash${zeroWidth} talk about the teams.` },
      auditEventId: "evt_1", createdAt: NOW, readAt: null,
    };
    const quoted = quoteFor(notice);
    expect(quoted).toBe("Keep the trash talk about the teams.");
    expect(quoted).not.toContain(rtlOverride);
    expect(quoted).not.toContain(zeroWidth);
    // `context` itself keeps what it was rendered FROM, untouched — the strip is at render, not at
    // the write, the same provenance-vs-copy split `notifyAffectedMember`'s own docblock draws.
    expect(notice.context.note).toBe(`${rtlOverride}Keep the trash${zeroWidth} talk about the teams.`);
  });

  it("is null for an operator_warning notice whose context note is not a string", () => {
    const notice: MemberNotice = {
      id: "notice_1", userId: "user_bob", leagueId: "league_1", noticeType: "operator_warning",
      title: "An operator left you a note", body: "...",
      context: { leagueName: "Sunday Money" },
      auditEventId: "evt_1", createdAt: NOW, readAt: null,
    };
    expect(quoteFor(notice)).toBeNull();
  });
});
