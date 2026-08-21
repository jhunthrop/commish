import { and, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { Db, DbTx } from "@/db/client";
import { auditEvents, chatMessageReports, chatMessages, drafts, integrityFlags, leagues, memberNotices, players, playerStatLines, reviewReports, reviews, rosterSlots, teams, tradeProposals, users } from "@/db/schema";
import { countingDb, createTestDb, truncateAll } from "@/db/test-db";
import type { AuditEventType, JsonObject } from "@/domain/audit";
import { copyViolations } from "@/integrity/copy-rules";
import { INTEGRITY_CONFIG } from "@/integrity/config";
import type { FlagType } from "@/integrity/flags";
import { REVIEW_CONFIG } from "@/reviews/config";
import { listLeagueActivity } from "./activity";
import { createLeague } from "@/league-service/creation";
import { acceptTrade, proposeTrade } from "@/league-service/trades";
import { createAuditLogger, type AuditLogger } from "./audit-logger";
import { notifyAffectedMember } from "./notify";
import { flagDetail, listPendingFlags, pendingFlagQuery, raiseFlag, removeSubject, resolveFlag } from "./flags";

const db = createTestDb();
const NOW = "2026-08-20T18:00:00.000Z";

let eventCounter = 0;
const logger = createAuditLogger({ newId: () => `evt_${(eventCounter += 1)}` });

async function seedUser(id: string, isAdmin = false): Promise<void> {
  await db.insert(users).values({ id, email: `${id}@test.local`, displayName: id, isAdmin });
}

async function seedLeague(id: string, commissionerUserId: string): Promise<void> {
  await db.insert(leagues).values({ id, name: id, format: "snake", teamCount: 10, commissionerUserId });
}

/** One ACCEPTED `trade_proposals` row, inserted directly — a real subject for `subjectFor`'s
 *  trade branch (Task 6) to resolve, without needing a full propose/accept flow for tests that
 *  only care about the row it reads back. */
async function seedAcceptedTrade(opts: {
  readonly id: string;
  readonly leagueId: string;
  readonly proposerTeamId: string;
  readonly counterpartyTeamId: string;
  readonly acceptedAt: string;
}): Promise<void> {
  const acceptedAt = new Date(opts.acceptedAt);
  await db.insert(tradeProposals).values({
    id: opts.id,
    leagueId: opts.leagueId,
    proposerTeamId: opts.proposerTeamId,
    counterpartyTeamId: opts.counterpartyTeamId,
    weekNumber: 4,
    proposerAssets: [{ kind: "player", playerId: "p_gave" }],
    counterpartyAssets: [{ kind: "player", playerId: "p_got" }],
    fingerprint: `fp_${opts.id}`,
    note: null,
    status: "accepted",
    proposedAt: acceptedAt,
    expiresAt: new Date(acceptedAt.getTime() + 72 * 60 * 60 * 1000),
    settledAt: acceptedAt,
    settledByUserId: null,
  });
}

beforeEach(async () => {
  await truncateAll(db);
  eventCounter = 0;
});

afterAll(async () => {
  await truncateAll(db);
});

describe("raiseFlag", () => {
  let flagCounter = 0;
  const newFlagId = (): string => `flag_${(flagCounter += 1)}`;

  beforeEach(() => {
    flagCounter = 0;
  });

  it("raises a new flag and records flag_raised on the platform chain with a system actor", async () => {
    await seedUser("u_commish");
    await seedLeague("league_x", "u_commish");

    const flag = await db.transaction((tx) =>
      raiseFlag(tx, {
        flagType: "multi_account",
        subjectId: "u1_u2",
        leagueId: "league_x",
        evidence: { sharedSignals: ["device_id"] },
        raisedByUserId: null,
        occurredAt: NOW,
        newId: newFlagId,
        audit: logger,
      }),
    );
    expect(flag).toEqual({
      id: "flag_1",
      flagType: "multi_account",
      subjectType: "account_pair",
      subjectId: "u1_u2",
      leagueId: "league_x",
      evidence: { sharedSignals: ["device_id"] },
      raisedAt: NOW,
    });

    const [row] = await db.select().from(integrityFlags).where(eq(integrityFlags.id, "flag_1"));
    expect(row).toMatchObject({ subjectType: "account_pair", subjectId: "u1_u2", leagueId: "league_x", resolvedAt: null });

    const [event] = await db.select().from(auditEvents).where(eq(auditEvents.eventType, "flag_raised"));
    expect(event).toMatchObject({ chainScope: "platform", leagueId: null, actorId: null, actorType: "system" });
    expect(event!.payload).toEqual({ flagId: "flag_1", flagType: "multi_account", subjectType: "account_pair", leagueId: "league_x" });
  });

  it("records a user actor when a reporter, not a sweep, raised the flag", async () => {
    await seedUser("u_reporter");

    await db.transaction((tx) =>
      raiseFlag(tx, {
        flagType: "chat_report",
        subjectId: "msg_1",
        leagueId: null,
        evidence: { reason: "spam" },
        raisedByUserId: "u_reporter",
        occurredAt: NOW,
        newId: newFlagId,
        audit: logger,
      }),
    );

    const [event] = await db.select().from(auditEvents).where(eq(auditEvents.eventType, "flag_raised"));
    expect(event).toMatchObject({ actorId: "u_reporter", actorType: "user", leagueId: null });
  });

  it("returns the open flag and writes no second event when the same subject is reported twice", async () => {
    await seedUser("u_reporter_a");
    await seedUser("u_reporter_b");

    const input = (raisedByUserId: string) => ({
      flagType: "chat_report" as const,
      subjectId: "msg_dup",
      leagueId: null,
      evidence: { reason: "spam" },
      raisedByUserId,
      occurredAt: NOW,
      newId: newFlagId,
      audit: logger,
    });

    const first = await db.transaction((tx) => raiseFlag(tx, input("u_reporter_a")));
    const second = await db.transaction((tx) => raiseFlag(tx, input("u_reporter_b")));

    expect(second).toEqual(first);
    expect(await db.select().from(integrityFlags)).toHaveLength(1);
    expect(await db.select().from(auditEvents).where(eq(auditEvents.eventType, "flag_raised"))).toHaveLength(1);
  });

  it("raises a NEW flag for a subject whose previous flag was resolved", async () => {
    await seedUser("u_reporter");

    const input = {
      flagType: "chat_report" as const,
      subjectId: "msg_reraised",
      leagueId: null,
      evidence: { reason: "spam" },
      raisedByUserId: "u_reporter",
      occurredAt: NOW,
      newId: newFlagId,
      audit: logger,
    };

    const first = await db.transaction((tx) => raiseFlag(tx, input));
    // Task 3 owns resolveFlag; this stamps the column directly to put the row in the state the
    // partial unique index (WHERE resolved_at IS NULL) treats as answered and out of the way.
    await db.update(integrityFlags).set({ resolvedAt: new Date(NOW) }).where(eq(integrityFlags.id, first.id));

    const second = await db.transaction((tx) => raiseFlag(tx, input));

    expect(second.id).not.toBe(first.id);
    expect(await db.select().from(integrityFlags)).toHaveLength(2);
    expect(await db.select().from(auditEvents).where(eq(auditEvents.eventType, "flag_raised"))).toHaveLength(2);
  });

  it("rolls back the flag insert when the audit append fails — ruling 4, the same guard grantAdmin holds", async () => {
    await seedUser("u_commish");
    await seedLeague("league_y", "u_commish");

    const brokenAudit = { ...logger, record: async () => { throw new Error("audit append failed"); } };
    await expect(
      db.transaction((tx) =>
        raiseFlag(tx, {
          flagType: "multi_account",
          subjectId: "u3_u4",
          leagueId: "league_y",
          evidence: {},
          raisedByUserId: null,
          occurredAt: NOW,
          newId: newFlagId,
          audit: brokenAudit,
        }),
      ),
    ).rejects.toThrow("audit append failed");

    // No orphan row: the integrity_flags insert commits with the audit append, or not at all.
    expect(await db.select().from(integrityFlags)).toHaveLength(0);
    expect(await db.select().from(auditEvents)).toHaveLength(0);
  });

  /**
   * `existingOpenFlagFor`'s impossible-state guard. Real Postgres cannot reach it: the conflict
   * that routes `raiseFlag` here is proof an open row exists for this subject. A stub `DbTx` is
   * the only way to put the code in the state it defends against — same shape as
   * `AuditLogger.record`'s `lockAnchor` guard in `audit-logger.test.ts`.
   */
  it("refuses to invent a flag when the conflicting row is somehow not there on read-back", async () => {
    const stub = {
      insert: () => ({ values: () => ({ onConflictDoNothing: () => ({ returning: async () => [] }) }) }),
      select: () => ({ from: () => ({ where: async () => [] }) }),
    } as unknown as DbTx;

    await expect(
      raiseFlag(stub, {
        flagType: "chat_report",
        subjectId: "msg_ghost",
        leagueId: null,
        evidence: {},
        raisedByUserId: null,
        occurredAt: NOW,
        newId: newFlagId,
        audit: logger,
      }),
    ).rejects.toThrow("raiseFlag conflicted on an open flag for chat_message:msg_ghost that is no longer there.");
  });
});

describe("resolveFlag", () => {
  let flagSeq = 0;

  beforeEach(() => {
    flagSeq = 0;
  });

  async function ensureUser(id: string): Promise<void> {
    await db.insert(users).values({ id, email: `${id}@test.local`, displayName: id }).onConflictDoNothing();
  }

  async function ensureLeague(id: string, commissionerUserId: string): Promise<void> {
    await ensureUser(commissionerUserId);
    await db.insert(leagues).values({ id, name: id, format: "snake", teamCount: 10, commissionerUserId }).onConflictDoNothing();
  }

  interface OpenFlagOptions {
    readonly flagType: FlagType;
    readonly subjectAuthor?: string;
    readonly leagueId?: string;
    /** Reuse an EXISTING subject row rather than creating a fresh one — the "a member reports the
     *  same content again after it was removed" case (final review, MEDIUM 8). */
    readonly subjectId?: string;
  }

  /**
   * Raises a real, OPEN flag whose subject is a real row — a chat message or a review — so
   * `resolveFlag`'s member lookup (`affectedMemberFor`) has something real to find rather than a
   * bare id nothing backs. `multi_account` and `trade_fairness` get a bare subject id instead,
   * since neither has a content row this plan's decisions ever remove or notice the author of.
   */
  async function openFlag(opts: OpenFlagOptions): Promise<{ readonly id: string }> {
    flagSeq += 1;
    const author = opts.subjectAuthor ?? `u_subject_${flagSeq}`;
    await ensureUser(author);

    let subjectId: string;
    let leagueId: string | null = null;
    if (opts.flagType === "review_report") {
      subjectId = `review_${flagSeq}`;
      await db.insert(reviews).values({ id: subjectId, userId: author, rating: 4, body: `review body ${flagSeq}`, createdAt: new Date(NOW), updatedAt: new Date(NOW) });
    } else if (opts.flagType === "chat_report") {
      leagueId = opts.leagueId ?? `lg_auto_${flagSeq}`;
      await ensureLeague(leagueId, author);
      if (opts.subjectId !== undefined) {
        subjectId = opts.subjectId;
      } else {
        const [message] = await db.insert(chatMessages).values({ leagueId, authorUserId: author, body: `message ${flagSeq}` }).returning({ id: chatMessages.id });
        subjectId = String(message!.id);
      }
    } else if (opts.flagType === "multi_account") {
      subjectId = `${author}_pair_${flagSeq}`;
      if (opts.leagueId !== undefined) {
        leagueId = opts.leagueId;
        await ensureLeague(leagueId, author);
      }
    } else {
      subjectId = `trade_${flagSeq}`;
    }

    const flagId = `flag_resolve_${flagSeq}`;
    await db.transaction((tx) =>
      raiseFlag(tx, {
        flagType: opts.flagType,
        subjectId,
        leagueId,
        evidence: {},
        raisedByUserId: null,
        occurredAt: NOW,
        newId: () => flagId,
        audit: logger,
      }),
    );
    return { id: flagId };
  }

  async function noticesFor(userId: string) {
    return db.select().from(memberNotices).where(eq(memberNotices.userId, userId));
  }

  async function auditEventsOn(scope: string, eventType: AuditEventType) {
    return db.select().from(auditEvents).where(and(eq(auditEvents.chainScope, scope), eq(auditEvents.eventType, eventType)));
  }

  /**
   * An OPEN `review_report` flag naming a specific `reviewId`, so `content_removed`'s review
   * branch has a real row to remove — unlike `openFlag` above, which mints its own subject id.
   * `alreadyRemoved` seeds the review already stamped removed, putting `removeReviewInTx`'s own
   * no-re-stamp `WHERE` in the zero-rows branch `resolveFlag` must roll its whole stamp back for.
   */
  async function reportedReview(opts: { readonly reviewId: string; readonly authorUserId?: string; readonly alreadyRemoved?: boolean }): Promise<{ readonly id: string }> {
    const author = opts.authorUserId ?? `u_review_author_${opts.reviewId}`;
    await ensureUser(author);
    await db
      .insert(reviews)
      .values({ id: opts.reviewId, userId: author, rating: 3, body: `review body ${opts.reviewId}`, createdAt: new Date(NOW), updatedAt: new Date(NOW) })
      .onConflictDoNothing();
    if (opts.alreadyRemoved === true) {
      await db.update(reviews).set({ removedAt: new Date(NOW), removedByUserId: author, removalReason: "spam" }).where(eq(reviews.id, opts.reviewId));
    }

    flagSeq += 1;
    const flagId = `flag_resolve_${flagSeq}`;
    await db.transaction((tx) =>
      raiseFlag(tx, {
        flagType: "review_report",
        subjectId: opts.reviewId,
        leagueId: null,
        evidence: {},
        raisedByUserId: null,
        occurredAt: NOW,
        newId: () => flagId,
        audit: logger,
      }),
    );
    return { id: flagId };
  }

  async function isRemoved(reviewId: string): Promise<boolean> {
    const [row] = await db.select({ removedAt: reviews.removedAt }).from(reviews).where(eq(reviews.id, reviewId));
    return row?.removedAt != null;
  }

  async function isMessageRemoved(messageId: string): Promise<boolean> {
    const [row] = await db.select({ removedAt: chatMessages.removedAt }).from(chatMessages).where(eq(chatMessages.id, Number(messageId)));
    return row?.removedAt != null;
  }

  async function isOpen(flagId: string): Promise<boolean> {
    const [row] = await db.select({ resolvedAt: integrityFlags.resolvedAt }).from(integrityFlags).where(eq(integrityFlags.id, flagId));
    return row !== undefined && row.resolvedAt === null;
  }

  it("records a decision, stamps the flag once, and writes the audit event that IS the record", async () => {
    await ensureUser("u_op");
    const flag = await openFlag({ flagType: "review_report" });

    const result = await resolveFlag(db, {
      flagId: flag.id,
      decision: "no_action",
      note: "Two reports, both from the same league, review reads as a real opinion.",
      operatorUserId: "u_op",
    });
    expect(result.ok).toBe(true);

    const events = await auditEventsOn("platform", "flag_resolved");
    expect(events).toHaveLength(1);
    expect(events[0]!.payload).toMatchObject({ flagId: flag.id, decision: "no_action" });
    expect(events[0]!.actorId).toBe("u_op");

    const [row] = await db.select().from(integrityFlags).where(eq(integrityFlags.id, flag.id));
    expect(row).toMatchObject({ resolvedByUserId: "u_op", resolution: "no_action", resolutionNote: "Two reports, both from the same league, review reads as a real opinion." });
    expect(row!.resolvedAt).not.toBeNull();
  });

  it("refuses a second decision on the same flag, and says which one already stands", async () => {
    await ensureUser("u_op");
    await ensureUser("u_two");
    const flag = await openFlag({ flagType: "review_report" });

    await resolveFlag(db, { flagId: flag.id, decision: "no_action", note: "n", operatorUserId: "u_op" });
    const second = await resolveFlag(db, { flagId: flag.id, decision: "warned_user", note: "n", operatorUserId: "u_two" });

    expect(second).toEqual({ ok: false, status: 409, reason: 'That flag was already resolved as "no action". A different decision is a new flag, not an edit.' });
    expect(await auditEventsOn("platform", "flag_resolved")).toHaveLength(1);
  });

  it("serializes two operators resolving at the same instant, and exactly one wins", async () => {
    // The guard is in the UPDATE's own WHERE. A prior read would let both pass it.
    await ensureUser("u_op1");
    await ensureUser("u_op2");
    const flag = await openFlag({ flagType: "chat_report", subjectAuthor: "u_member_race", leagueId: "lg_race" });

    const [a, b] = await Promise.all([
      resolveFlag(db, { flagId: flag.id, decision: "no_action", note: "n", operatorUserId: "u_op1" }),
      resolveFlag(db, { flagId: flag.id, decision: "warned_user", note: "n", operatorUserId: "u_op2" }),
    ]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    expect(await auditEventsOn("platform", "flag_resolved")).toHaveLength(1);
  });

  it("refuses a decision no plan in this phase owns", async () => {
    await ensureUser("u_op");
    const flag = await openFlag({ flagType: "review_report" });

    const result = await resolveFlag(db, { flagId: flag.id, decision: "trade_reversed", note: "n", operatorUserId: "u_op" });
    expect(result).toEqual({ ok: false, status: 400, reason: "This product can't reverse a trade yet." });
    expect(await auditEventsOn("platform", "flag_resolved")).toHaveLength(0);
  });

  it("tells the member in the operator's own words when the decision is a warning", async () => {
    await ensureUser("u_op");
    const flag = await openFlag({ flagType: "chat_report", subjectAuthor: "u_member", leagueId: "lg_1" });

    await resolveFlag(db, { flagId: flag.id, decision: "warned_user", note: "Keep the trash talk about the teams.", operatorUserId: "u_op" });

    const [notice] = await noticesFor("u_member");
    expect(notice!.noticeType).toBe("operator_warning");
    expect(notice!.context).toMatchObject({ note: "Keep the trash talk about the teams." });
    expect(copyViolations(`${notice!.title} ${notice!.body}`)).toEqual([]);
    expect(notice!.auditEventId).not.toBeNull();
  });

  it("tells NOBODY when the decision is no_action", async () => {
    // Ruling 6, and the one deliberate exception to this plan's own rule that every operator
    // action notices the affected member. An investigation that closed with nothing happening is
    // not an event in that member's life, and "we looked into you and found nothing" is precisely
    // the accusation INTEGRITY_CONFIG.notices.accusatoryTerms exists to keep out of this product.
    await ensureUser("u_op");
    const flag = await openFlag({ flagType: "multi_account", subjectAuthor: "u_member2" });

    await resolveFlag(db, { flagId: flag.id, decision: "no_action", note: "Roommates. Same wifi, different drafts.", operatorUserId: "u_op" });

    expect(await noticesFor("u_member2")).toEqual([]);
    expect(await auditEventsOn("platform", "flag_resolved")).toHaveLength(1); // the record still exists
  });

  it("refuses a note past the length cap, before opening a transaction", async () => {
    await ensureUser("u_op");
    const flag = await openFlag({ flagType: "review_report" });
    const tooLong = "x".repeat(INTEGRITY_CONFIG.moderation.noteMaxLength + 1);

    const result = await resolveFlag(db, { flagId: flag.id, decision: "no_action", note: tooLong, operatorUserId: "u_op" });
    expect(result).toEqual({
      ok: false,
      status: 400,
      reason: `Keep the note to ${INTEGRITY_CONFIG.moderation.noteMaxLength} characters or fewer. The member reads it.`,
    });

    const [row] = await db.select().from(integrityFlags).where(eq(integrityFlags.id, flag.id));
    expect(row!.resolvedAt).toBeNull();
  });

  it("refuses a flagId that doesn't exist, distinctly from an already-resolved one", async () => {
    await ensureUser("u_op");
    const result = await resolveFlag(db, { flagId: "flag_ghost", decision: "no_action", note: "n", operatorUserId: "u_op" });
    expect(result).toEqual({ ok: false, status: 404, reason: 'No flag with id "flag_ghost".' });
  });

  it("notices a review's own author, falling back to a generic league name for a leagueless flag", async () => {
    // Reviews are platform-scoped (no league), so this is also the leagueId === null branch of
    // the notice's own leagueName lookup — a combination no caller exercises today, but the
    // notice-composing code must not crash if an operator ever picks it.
    await ensureUser("u_op");
    const flag = await openFlag({ flagType: "review_report", subjectAuthor: "u_reviewer" });

    await resolveFlag(db, { flagId: flag.id, decision: "warned_user", note: "Keep it about the platform, not other members.", operatorUserId: "u_op" });

    const [notice] = await noticesFor("u_reviewer");
    expect(notice!.noticeType).toBe("operator_warning");
    expect(notice!.leagueId).toBeNull();
    expect(notice!.context).toMatchObject({ leagueName: "your league", note: "Keep it about the platform, not other members." });
  });

  it("throws rather than guess who to notice for a subject with no single affected member", async () => {
    await ensureUser("u_op");
    const flag = await openFlag({ flagType: "multi_account", subjectAuthor: "u_pair_a" });

    await expect(
      resolveFlag(db, { flagId: flag.id, decision: "warned_user", note: "n", operatorUserId: "u_op" }),
    ).rejects.toThrow('resolveFlag: "account_pair" has no single affected member to notice.');

    const [row] = await db.select().from(integrityFlags).where(eq(integrityFlags.id, flag.id));
    expect(row!.resolvedAt).toBeNull(); // the throw rolled the stamp back with it
    expect(await auditEventsOn("platform", "flag_resolved")).toHaveLength(0);
  });

  /**
   * Final review, LOW 13. This used to be a `rejects.toThrow` on a plain `Error`, which
   * `withAdmin` turned into a 500: admin-only and fail-safe, since the transaction rolled back —
   * but a crash is not a refusal, and `decisionsFor` at the page level was the only thing
   * preventing it. The boundary now says no in the product's own words, BEFORE any write.
   */
  it("refuses content_removed for a subject type nothing removes content for, cleanly and before any write", async () => {
    await ensureUser("u_op");
    const flag = await openFlag({ flagType: "multi_account", subjectAuthor: "u_pair_cr" });

    const result = await resolveFlag(db, { flagId: flag.id, decision: "content_removed", note: "spam", operatorUserId: "u_op" });
    expect(result).toEqual({
      ok: false,
      status: 400,
      reason: "There is no content to remove on this flag. Close it with no action, or warn the member.",
    });

    const [row] = await db.select().from(integrityFlags).where(eq(integrityFlags.id, flag.id));
    expect(row!.resolvedAt).toBeNull();
    expect(await auditEventsOn("platform", "flag_resolved")).toHaveLength(0);
  });

  /**
   * `removeSubject`'s own backstop, driven directly because `resolveFlag` can no longer reach it:
   * the pre-transaction `contentRemovalIsWiredFor` check refuses an unwired subject type before
   * this function is called at all. A guard nothing exercises is a guard nobody knows still
   * works, and this one is what would catch a future subject type added to
   * `CONTENT_REMOVAL_WIRED_FOR` before its remover is wired here.
   */
  it("removeSubject itself still throws for a subject type with no remover, as the backstop", async () => {
    await expect(
      db.transaction((tx) =>
        removeSubject(tx, "account_pair", {
          subjectId: "u_a_u_b",
          flagId: "flag_backstop",
          operatorUserId: "u_op",
          reason: "spam",
          clock: { now: () => NOW },
          audit: logger,
          notify: notifyAffectedMember,
          publish: async () => null,
        }),
      ),
    ).rejects.toThrow('resolveFlag: content_removed has no remover wired for subject type "account_pair".');
  });

  /** The unresolvable-flag half of MEDIUM 8, at the service level: `resolveFlag`'s refusal is the
   *  BACKSTOP the queue page's withheld decision sits in front of, and it still holds. */
  it("still refuses content_removed on content that is already removed, and rolls the stamp back with it", async () => {
    await ensureUser("u_op");
    const flag = await openFlag({ flagType: "chat_report", subjectAuthor: "u_chat_twice", leagueId: "lg_chat_twice" });

    const first = await resolveFlag(db, { flagId: flag.id, decision: "content_removed", note: "spam", operatorUserId: "u_op" });
    expect(first.ok).toBe(true);

    // A member reports the tombstone; a FRESH flag opens on the same subject, which the
    // open-subject unique index permits because the first one is resolved.
    const [firstRow] = await db.select().from(integrityFlags).where(eq(integrityFlags.id, flag.id));
    const reopened = await openFlag({ flagType: "chat_report", subjectAuthor: "u_chat_twice", leagueId: "lg_chat_twice", subjectId: firstRow!.subjectId });

    const second = await resolveFlag(db, { flagId: reopened.id, decision: "content_removed", note: "spam again", operatorUserId: "u_op" });
    expect(second).toEqual({ ok: false, status: 409, reason: `Message "${firstRow!.subjectId}" is already removed.` });

    const [reopenedRow] = await db.select().from(integrityFlags).where(eq(integrityFlags.id, reopened.id));
    expect(reopenedRow!.resolvedAt).toBeNull();
  });

  it("removes the chat message and resolves the flag in one transaction, or neither — Task 6's chat branch", async () => {
    await ensureUser("u_op");
    const flag = await openFlag({ flagType: "chat_report", subjectAuthor: "u_chat_author", leagueId: "lg_chat_cr" });

    const result = await resolveFlag(db, { flagId: flag.id, decision: "content_removed", note: "spam", operatorUserId: "u_op" });
    expect(result).toEqual({ ok: true, flagId: flag.id, decision: "content_removed" });

    const [row] = await db.select().from(integrityFlags).where(eq(integrityFlags.id, flag.id));
    expect(await isMessageRemoved(row!.subjectId)).toBe(true);
    const [notice] = await noticesFor("u_chat_author");
    expect(notice!.noticeType).toBe("chat_message_removed");
    expect(notice!.leagueId).toBe("lg_chat_cr");

    // The removal's own audit event is `admin_action` on the PLATFORM chain (ruling 1) — never a
    // league-scoped event, even though the message itself lived in a league.
    const [removalEvent] = await auditEventsOn("platform", "admin_action");
    expect(removalEvent!.payload).toMatchObject({ action: "chat_message_removed", messageId: row!.subjectId, leagueId: "lg_chat_cr", flagId: flag.id });
  });

  it("leaves the flag open when the chat removal itself fails — already removed a minute earlier", async () => {
    await ensureUser("u_op");
    const flag = await openFlag({ flagType: "chat_report", subjectAuthor: "u_chat_author2", leagueId: "lg_chat_cr2" });
    const [row] = await db.select().from(integrityFlags).where(eq(integrityFlags.id, flag.id));
    await db.update(chatMessages).set({ removedAt: new Date(NOW), removedByUserId: "u_op", removalReason: "spam" }).where(eq(chatMessages.id, Number(row!.subjectId)));

    const result = await resolveFlag(db, { flagId: flag.id, decision: "content_removed", note: "spam", operatorUserId: "u_op" });
    expect(result.ok).toBe(false);
    expect(await isOpen(flag.id)).toBe(true);
    expect(await auditEventsOn("platform", "flag_resolved")).toHaveLength(0);
  });

  it("refuses a content_removed note past the shared removal-reason cap for a chat message too", async () => {
    await ensureUser("u_op");
    const flag = await openFlag({ flagType: "chat_report", subjectAuthor: "u_chat_author3", leagueId: "lg_chat_cr3" });
    const tooLong = "x".repeat(REVIEW_CONFIG.removalReason.maxLength + 1);

    const result = await resolveFlag(db, { flagId: flag.id, decision: "content_removed", note: tooLong, operatorUserId: "u_op" });
    expect(result).toEqual({
      ok: false,
      status: 400,
      reason: `Notes on a removal are limited to ${REVIEW_CONFIG.removalReason.maxLength} characters.`,
    });
    expect(await isOpen(flag.id)).toBe(true);
  });

  it("removes the review and resolves the flag in one transaction, or neither — Task 4's review branch", async () => {
    await ensureUser("u_op");
    const flag = await reportedReview({ reviewId: "r_1", authorUserId: "u_author" });

    const result = await resolveFlag(db, { flagId: flag.id, decision: "content_removed", note: "spam", operatorUserId: "u_op" });
    expect(result).toEqual({ ok: true, flagId: flag.id, decision: "content_removed" });

    expect(await isRemoved("r_1")).toBe(true);
    const [notice] = await noticesFor("u_author");
    expect(notice!.noticeType).toBe("review_removed");

    // The removal's own audit event carries the flag id that triggered it, and the flag's own
    // resolution event names the same flag — two records, one traceable decision.
    const [removalEvent] = await auditEventsOn("platform", "review_removed");
    expect(removalEvent!.payload).toMatchObject({ reviewId: "r_1", flagId: flag.id });
  });

  it("leaves the flag open when the removal itself fails — already removed a minute earlier", async () => {
    await ensureUser("u_op");
    // Already removed by the script a minute earlier: removeReviewInTx's own WHERE matches zero rows.
    const flag = await reportedReview({ reviewId: "r_2", authorUserId: "u_author2", alreadyRemoved: true });

    const result = await resolveFlag(db, { flagId: flag.id, decision: "content_removed", note: "spam", operatorUserId: "u_op" });
    expect(result.ok).toBe(false);
    expect(await isOpen(flag.id)).toBe(true);
    expect(await auditEventsOn("platform", "flag_resolved")).toHaveLength(0);
  });

  it("refuses a content_removed note past the review's own removal-reason cap, with PRODUCT copy, before any write", async () => {
    // Fix round 1, FIX 1: `resolveFlag`'s note is bound by `INTEGRITY_CONFIG.moderation.
    // noteMaxLength` (500) in general, but on the `content_removed` branch it becomes a REMOVAL
    // REASON — `removeReviewInTx`'s own tighter `REVIEW_CONFIG.removalReason.maxLength` (200) is
    // what it is actually bound by. A 201-char note must be refused HERE, with product copy, not
    // reach `removeReviewInTx` and surface that function's CLI-flavored message.
    await ensureUser("u_op");
    const flag = await reportedReview({ reviewId: "r_3", authorUserId: "u_author3" });
    const tooLong = "x".repeat(REVIEW_CONFIG.removalReason.maxLength + 1);

    const result = await resolveFlag(db, { flagId: flag.id, decision: "content_removed", note: tooLong, operatorUserId: "u_op" });
    expect(result).toEqual({
      ok: false,
      status: 400,
      reason: `Notes on a removal are limited to ${REVIEW_CONFIG.removalReason.maxLength} characters.`,
    });

    // Refused before the transaction even opens: neither the flag nor the review moved at all.
    expect(await isOpen(flag.id)).toBe(true);
    expect(await isRemoved("r_3")).toBe(false);
    // The script's OWN door is untouched and still answers with its CLI-flavored message — see
    // `reviews.test.ts`'s "refuses a reason longer than REVIEW_CONFIG.removalReason.maxLength,
    // before any write", which calls `removeReview` directly and is unmodified by this fix.
  });

  it("rolls back the review's removal too when the flag_resolved audit write fails after it lands", async () => {
    // Fix round 1, FIX 2: the removal (review_removed, the FIRST audit append) can succeed while
    // the SECOND append (flag_resolved, the anchor) fails — both still happen inside `resolveFlag`'s
    // one transaction, so the removal must roll back WITH the stamp, not stay committed.
    await ensureUser("u_op");
    const flag = await reportedReview({ reviewId: "r_4", authorUserId: "u_author4" });

    let calls = 0;
    const audit: AuditLogger = {
      ...logger,
      record: async (tx, event) => {
        calls += 1;
        if (calls === 2) throw new Error("audit append failed");
        return logger.record(tx, event);
      },
    };

    await expect(
      resolveFlag(db, { flagId: flag.id, decision: "content_removed", note: "spam", operatorUserId: "u_op", audit }),
    ).rejects.toThrow("audit append failed");

    expect(await isRemoved("r_4")).toBe(false);
    expect(await isOpen(flag.id)).toBe(true);
    expect(await auditEventsOn("platform", "review_removed")).toHaveLength(0);
    expect(await auditEventsOn("platform", "flag_resolved")).toHaveLength(0);
  });

  it("rolls back the stamp when the audit append fails — ruling 4, the same guard every prior site holds", async () => {
    await ensureUser("u_op");
    const flag = await openFlag({ flagType: "review_report" });
    const brokenAudit = { ...logger, record: async () => { throw new Error("audit append failed"); } };

    await expect(
      resolveFlag(db, { flagId: flag.id, decision: "no_action", note: "n", operatorUserId: "u_op", audit: brokenAudit }),
    ).rejects.toThrow("audit append failed");

    const [row] = await db.select().from(integrityFlags).where(eq(integrityFlags.id, flag.id));
    expect(row!.resolvedAt).toBeNull();
  });

  it("rolls back the stamp and the notice when the notice write fails — the notice-before-anchor lock order still commits atomically", async () => {
    await ensureUser("u_op");
    const flag = await openFlag({ flagType: "chat_report", subjectAuthor: "u_member4", leagueId: "lg_notify_fail" });
    const brokenNotify: typeof notifyAffectedMember = async () => {
      throw new Error("notice write failed");
    };

    await expect(
      resolveFlag(db, { flagId: flag.id, decision: "warned_user", note: "n", operatorUserId: "u_op", notify: brokenNotify }),
    ).rejects.toThrow("notice write failed");

    const [row] = await db.select().from(integrityFlags).where(eq(integrityFlags.id, flag.id));
    expect(row!.resolvedAt).toBeNull();
    expect(await auditEventsOn("platform", "flag_resolved")).toHaveLength(0);
  });

  /**
   * `alreadyResolvedOrMissing`'s impossible-state guard. Real Postgres cannot reach it: `resolution`
   * is set atomically with `resolved_at` in the same statement, so a resolved row always carries a
   * recognizable decision. A stub `Db`/`DbTx` pair is the only way to put the code in the state it
   * defends against — same shape as `raiseFlag`'s `existingOpenFlagFor` guard above.
   */
  it("refuses to invent a decision label when a resolved flag's own resolution is unrecognizable", async () => {
    const stubTx = {
      update: () => ({ set: () => ({ where: () => ({ returning: async () => [] }) }) }),
      select: () => ({ from: () => ({ where: async () => [{ resolution: "not_a_real_decision" }] }) }),
    } as unknown as DbTx;
    const stubDb = { transaction: (fn: (tx: DbTx) => Promise<unknown>) => fn(stubTx) } as unknown as Db;

    await expect(
      resolveFlag(stubDb, { flagId: "flag_ghost", decision: "no_action", note: "n", operatorUserId: "u_op" }),
    ).rejects.toThrow('resolveFlag: flag "flag_ghost" is resolved with no recognizable decision recorded — this should be impossible.');
  });

  /**
   * `affectedMemberFor`'s and `leagueNameForFlag`'s own impossible-state guards. Neither `reviews`
   * nor `chat_messages` carries a foreign key back from `integrity_flags.subject_id` (it is plain
   * text, not a reference — see the schema's own docblock), so a stamped flag whose subject row is
   * gone is not provably impossible the way an already-resolved flag with no decision is. Real
   * callers never hit this (nothing in this product hard-deletes a review or a chat message), but
   * the lookup must not crash confusingly if one ever does — proved here with a stub `Db`/`DbTx`
   * pair, same discipline as the guard immediately above.
   */
  function stubbedResolveRow(overrides: Partial<Record<string, unknown>>): Record<string, unknown> {
    return {
      id: "flag_stub",
      flagType: "chat_report",
      subjectType: "chat_message",
      subjectId: "999",
      leagueId: null,
      resolvedAt: new Date(NOW),
      resolvedByUserId: "u_op",
      resolution: "warned_user",
      resolutionNote: "n",
      ...overrides,
    };
  }

  /** A `DbTx` stub whose stamp `UPDATE` always "succeeds", and whose `SELECT`s answer by table. */
  function stubTxFor(row: Record<string, unknown>, answers: { readonly reviewAuthor?: string; readonly chatAuthor?: string; readonly leagueName?: string }): DbTx {
    return {
      update: () => ({ set: () => ({ where: () => ({ returning: async () => [row] }) }) }),
      select: () => ({
        from: (table: unknown) => ({
          where: async () => {
            if (table === reviews) return answers.reviewAuthor === undefined ? [] : [{ userId: answers.reviewAuthor }];
            if (table === chatMessages) return answers.chatAuthor === undefined ? [] : [{ authorUserId: answers.chatAuthor }];
            if (table === leagues) return answers.leagueName === undefined ? [] : [{ name: answers.leagueName }];
            return [];
          },
        }),
      }),
    } as unknown as DbTx;
  }

  function stubDbFor(tx: DbTx): Db {
    return { transaction: (fn: (tx: DbTx) => Promise<unknown>) => fn(tx) } as unknown as Db;
  }

  it("throws rather than notice a ghost when a review named as a flag's subject is somehow gone", async () => {
    const row = stubbedResolveRow({ flagType: "review_report", subjectType: "review", subjectId: "review_ghost" });
    const stubDb = stubDbFor(stubTxFor(row, {}));

    await expect(
      resolveFlag(stubDb, { flagId: "flag_stub", decision: "warned_user", note: "n", operatorUserId: "u_op" }),
    ).rejects.toThrow('resolveFlag: no review "review_ghost" for a flag that named it as the subject.');
  });

  it("throws rather than notice a ghost when a chat message named as a flag's subject is somehow gone", async () => {
    const row = stubbedResolveRow({ subjectId: "999" });
    const stubDb = stubDbFor(stubTxFor(row, {}));

    await expect(
      resolveFlag(stubDb, { flagId: "flag_stub", decision: "warned_user", note: "n", operatorUserId: "u_op" }),
    ).rejects.toThrow('resolveFlag: no chat message "999" for a flag that named it as the subject.');
  });

  it("falls back to the leagueId itself when a flag's own league row is somehow gone", async () => {
    // No FK is missing here — `integrity_flags.league_id` really does reference `leagues` — but
    // the fallback exists for the same "must not crash" reason as the two tests above, so it is
    // proved the same way. `notify` is stubbed to CAPTURE the composed context and then stop
    // execution before it (or the real `audit.record` after it) would need a fuller stub tx.
    let capturedLeagueName: unknown;
    const spyNotify: typeof notifyAffectedMember = async (_tx, input) => {
      capturedLeagueName = (input.context as { readonly leagueName?: unknown }).leagueName;
      throw new Error("test probe stop");
    };
    const row = stubbedResolveRow({ leagueId: "lg_ghost" });
    const stubDb = stubDbFor(stubTxFor(row, { chatAuthor: "u_member" }));

    await expect(
      resolveFlag(stubDb, { flagId: "flag_stub", decision: "warned_user", note: "n", operatorUserId: "u_op", notify: spyNotify }),
    ).rejects.toThrow("test probe stop");
    expect(capturedLeagueName).toBe("lg_ghost");
  });
});

describe("pendingFlagQuery / listPendingFlags — the queue's own read model", () => {
  const ALL_TABLE_NAMES = ["integrity_flags", "reviews", "chat_messages", "users", "audit_events", "review_reports", "leagues"] as const;
  function tablesIn(sqlText: string): readonly string[] {
    return ALL_TABLE_NAMES.filter((name) => sqlText.includes(`"${name}"`)).sort();
  }

  async function raiseTestFlag(opts: {
    readonly id: string;
    readonly flagType: FlagType;
    readonly subjectId: string;
    readonly leagueId?: string | null;
    readonly occurredAt: string;
    readonly evidence?: JsonObject;
    readonly raisedByUserId?: string | null;
  }) {
    return db.transaction((tx) =>
      raiseFlag(tx, {
        flagType: opts.flagType,
        subjectId: opts.subjectId,
        leagueId: opts.leagueId ?? null,
        evidence: opts.evidence ?? {},
        raisedByUserId: opts.raisedByUserId ?? null,
        occurredAt: opts.occurredAt,
        newId: () => opts.id,
        audit: logger,
      }),
    );
  }

  it("touches only integrity_flags — evidence and the resolution note are never fetched to leak", () => {
    expect(tablesIn(pendingFlagQuery(db, {}).toSQL().sql)).toEqual(["integrity_flags"]);
  });

  it("lists open flags oldest first with no severity sort, and never a resolved one", async () => {
    await seedUser("u_author1");
    await seedUser("u_author2");
    await seedUser("u_author3");
    await seedUser("u_op");
    await db.insert(reviews).values([
      { id: "queue_r_old", userId: "u_author1", rating: 3, body: "old", createdAt: new Date(NOW), updatedAt: new Date(NOW) },
      { id: "queue_r_new", userId: "u_author2", rating: 3, body: "new", createdAt: new Date(NOW), updatedAt: new Date(NOW) },
      { id: "queue_r_done", userId: "u_author3", rating: 3, body: "already handled", createdAt: new Date(NOW), updatedAt: new Date(NOW) },
    ]);

    await raiseTestFlag({ id: "queue_flag_old", flagType: "review_report", subjectId: "queue_r_old", occurredAt: "2026-08-01T00:00:00.000Z" });
    await raiseTestFlag({ id: "queue_flag_new", flagType: "review_report", subjectId: "queue_r_new", occurredAt: "2026-08-02T00:00:00.000Z" });
    const done = await raiseTestFlag({ id: "queue_flag_done", flagType: "review_report", subjectId: "queue_r_done", occurredAt: "2026-08-03T00:00:00.000Z" });
    await resolveFlag(db, { flagId: done.id, decision: "no_action", note: "n", operatorUserId: "u_op", audit: logger });

    const page = await listPendingFlags(db, {});
    expect(page.rows.map((r) => r.flagId)).toEqual(["queue_flag_old", "queue_flag_new"]);
    expect(page.rows[0]).toMatchObject({ question: "A member reported a review", about: "A review by u_author1" });
    expect(page.nextBefore).toBeNull();
  });

  it("pages with a cursor, holding oldest-first order across the boundary", async () => {
    await seedUser("u_page_author1");
    await seedUser("u_page_author2");
    await db.insert(reviews).values([
      { id: "queue_page_r1", userId: "u_page_author1", rating: 3, body: "a", createdAt: new Date(NOW), updatedAt: new Date(NOW) },
      { id: "queue_page_r2", userId: "u_page_author2", rating: 3, body: "b", createdAt: new Date(NOW), updatedAt: new Date(NOW) },
    ]);
    await raiseTestFlag({ id: "queue_page_flag1", flagType: "review_report", subjectId: "queue_page_r1", occurredAt: "2026-08-01T00:00:00.000Z" });
    await raiseTestFlag({ id: "queue_page_flag2", flagType: "review_report", subjectId: "queue_page_r2", occurredAt: "2026-08-02T00:00:00.000Z" });

    const first = await listPendingFlags(db, { limit: 1 });
    expect(first.rows.map((r) => r.flagId)).toEqual(["queue_page_flag1"]);
    expect(first.nextBefore).not.toBeNull();

    const second = await listPendingFlags(db, { limit: 1, before: first.nextBefore! });
    expect(second.rows.map((r) => r.flagId)).toEqual(["queue_page_flag2"]);
    expect(second.nextBefore).toBeNull();
  });

  it("describes an account-pair flag by both accounts' names, batched rather than per-row", async () => {
    await seedUser("u_pair_a");
    await seedUser("u_pair_b");
    await raiseTestFlag({ id: "queue_pair_flag", flagType: "multi_account", subjectId: "u_pair_a:u_pair_b", occurredAt: "2026-08-01T00:00:00.000Z", evidence: { device: 0.9 } });

    const page = await listPendingFlags(db, {});
    expect(page.rows[0]).toMatchObject({ question: "The platform flagged two accounts that may be the same person", about: "u_pair_a and u_pair_b" });
  });

  it("describes a chat_report flag by the message's author, batched the same way a review's is", async () => {
    await seedUser("u_chat_author");
    await seedUser("u_chat_commish");
    await seedLeague("lg_queue_chat", "u_chat_commish");
    const [message] = await db.insert(chatMessages).values({ leagueId: "lg_queue_chat", authorUserId: "u_chat_author", body: "trash talk" }).returning({ id: chatMessages.id });
    await raiseTestFlag({ id: "queue_chat_flag", flagType: "chat_report", subjectId: String(message!.id), leagueId: "lg_queue_chat", occurredAt: "2026-08-01T00:00:00.000Z" });

    const page = await listPendingFlags(db, {});
    expect(page.rows[0]).toMatchObject({ question: "A member reported a message", about: "A message from u_chat_author" });
  });

  it("names a review's author honestly even when the review itself is somehow gone", async () => {
    await raiseTestFlag({ id: "queue_ghost_review_flag", flagType: "review_report", subjectId: "review_that_does_not_exist_in_queue", occurredAt: "2026-08-01T00:00:00.000Z" });

    const page = await listPendingFlags(db, {});
    expect(page.rows[0]).toMatchObject({ about: "A review by a former member" });
  });

  it("names a message's author honestly even when the message itself is somehow gone", async () => {
    await raiseTestFlag({ id: "queue_ghost_chat_flag", flagType: "chat_report", subjectId: "999999", occurredAt: "2026-08-01T00:00:00.000Z" });

    const page = await listPendingFlags(db, {});
    expect(page.rows[0]).toMatchObject({ about: "A message from a former member" });
  });

  it("names an account pair honestly when it is malformed (no separator) or names accounts that don't resolve", async () => {
    await raiseTestFlag({ id: "queue_lone_pair_flag", flagType: "multi_account", subjectId: "u_lone_only", occurredAt: "2026-08-01T00:00:00.000Z" });
    await raiseTestFlag({ id: "queue_ghost_pair_flag", flagType: "multi_account", subjectId: "u_ghost_1:u_ghost_2", occurredAt: "2026-08-02T00:00:00.000Z" });

    const page = await listPendingFlags(db, {});
    const lone = page.rows.find((r) => r.flagId === "queue_lone_pair_flag");
    const ghost = page.rows.find((r) => r.flagId === "queue_ghost_pair_flag");
    expect(lone?.about).toBe("A former member and a former member");
    expect(ghost?.about).toBe("A former member and a former member");
  });

  it("describes a trade_fairness flag by its bare subject id honestly when its trade row is gone", async () => {
    await raiseTestFlag({ id: "queue_trade_flag", flagType: "trade_fairness", subjectId: "trade_9", occurredAt: "2026-08-01T00:00:00.000Z" });

    const page = await listPendingFlags(db, {});
    expect(page.rows[0]).toMatchObject({ question: "The platform flagged a trade for a fairness review", about: "A trade (trade_9)" });
  });

  it("describes a trade_fairness flag by both teams' names once its trade row resolves — Task 6", async () => {
    await seedUser("u_trade_about_a");
    await seedUser("u_trade_about_b");
    await seedLeague("lg_trade_about", "u_trade_about_a");
    await db.insert(teams).values([
      { id: "team_trade_about_a", leagueId: "lg_trade_about", userId: "u_trade_about_a", name: "Alpha Squad" },
      { id: "team_trade_about_b", leagueId: "lg_trade_about", userId: "u_trade_about_b", name: "Beta Crew" },
    ]);
    await seedAcceptedTrade({
      id: "trade_about_1",
      leagueId: "lg_trade_about",
      proposerTeamId: "team_trade_about_a",
      counterpartyTeamId: "team_trade_about_b",
      acceptedAt: NOW,
    });
    await raiseTestFlag({ id: "queue_trade_flag2", flagType: "trade_fairness", subjectId: "trade_about_1", leagueId: "lg_trade_about", occurredAt: "2026-08-01T00:00:00.000Z" });

    const page = await listPendingFlags(db, {});
    const row = page.rows.find((r) => r.flagId === "queue_trade_flag2");
    expect(row).toMatchObject({ question: "The platform flagged a trade for a fairness review", about: "Alpha Squad and Beta Crew" });
  });
});

describe("flagDetail — bounded, and the trail includes what happened to this flag", () => {
  it("returns null for a flag id that names nothing", async () => {
    expect(await flagDetail(db, "flag_does_not_exist")).toBeNull();
  });

  it("assembles the subject, the reporters and the trail, in a bounded number of queries", async () => {
    await seedUser("u_detail_author");
    await seedUser("u_detail_reporter");
    await seedUser("u_detail_op");
    await db.insert(reviews).values({ id: "detail_r1", userId: "u_detail_author", rating: 2, body: "meh", createdAt: new Date(NOW), updatedAt: new Date(NOW) });

    const flag = await db.transaction((tx) =>
      raiseFlag(tx, {
        flagType: "review_report",
        subjectId: "detail_r1",
        leagueId: null,
        evidence: { note: "auto-flagged" },
        raisedByUserId: "u_detail_reporter",
        occurredAt: "2026-08-01T00:00:00.000Z",
        newId: () => "detail_flag_1",
        audit: logger,
      }),
    );
    await db.insert(reviewReports).values({ reviewId: "detail_r1", reporterUserId: "u_detail_reporter", reason: "spam", createdAt: new Date("2026-08-01T00:00:01.000Z") });

    const counted = countingDb(db);
    const detail = await flagDetail(counted.db, flag.id);
    expect(counted.selectCount()).toBeLessThanOrEqual(5);

    expect(detail).not.toBeNull();
    expect(detail!.flagId).toBe("detail_flag_1");
    expect(detail!.evidence).toEqual({ note: "auto-flagged" });
    expect(detail!.subject).toEqual({ kind: "review", reviewId: "detail_r1", body: "meh", authorName: "u_detail_author", removedAt: null });
    expect(detail!.reporters).toEqual([{ userId: "u_detail_reporter", name: "u_detail_reporter", reason: "spam", reportedAt: "2026-08-01T00:00:01.000Z" }]);
    expect(detail!.trail.map((r) => r.headline)).toEqual(["This flag was opened."]);
    expect(detail!.decisions).toEqual(["no_action", "warned_user", "content_removed"]);

    await resolveFlag(db, { flagId: flag.id, decision: "no_action", note: "n", operatorUserId: "u_detail_op", audit: logger });

    const resolvedCounted = countingDb(db);
    const afterResolve = await flagDetail(resolvedCounted.db, flag.id);
    // Fix round 1, FIX 5: one query more than the open-flag bound above — `resolverNameFor`,
    // run only once `resolution` is known non-null.
    expect(resolvedCounted.selectCount()).toBeLessThanOrEqual(6);
    expect(afterResolve!.trail.map((r) => r.headline)).toEqual(["This flag was opened.", "An operator closed this flag with no action."]);
    expect(afterResolve!.decisions).toEqual([]);
    expect(afterResolve!.resolution).toEqual({
      decision: "no_action",
      note: "n",
      resolvedAt: expect.any(String),
      resolvedByUserId: "u_detail_op",
      resolvedByName: "u_detail_op",
    });
  });

  it("cannot ever stamp a flag resolved by an operator id that names nobody — the foreign key refuses it, which is why resolverNameFor needs no fallback", async () => {
    await seedUser("u_ghost_op_author");
    const flag = await db.transaction((tx) =>
      raiseFlag(tx, {
        flagType: "review_report",
        subjectId: "review_that_does_not_exist_for_ghost_op",
        leagueId: null,
        evidence: {},
        raisedByUserId: null,
        occurredAt: "2026-08-01T00:00:00.000Z",
        newId: () => "detail_flag_ghost_op",
        audit: logger,
      }),
    );
    // `integrity_flags.resolved_by_user_id` carries a real FK onto `users.id` — Postgres itself
    // is the proof `flags.ts`'s `resolverNameFor` leans on: this write cannot land, so
    // `flagDetail`'s resolution summary never needs a "the operator is gone" fallback.
    // `code: "23503"` is Postgres's own SQLSTATE for a foreign key violation; Drizzle wraps the
    // real `PostgresError` (which carries `code`/`constraint_name`) as this rejection's `.cause`.
    await expect(
      db
        .update(integrityFlags)
        .set({ resolvedAt: new Date(NOW), resolvedByUserId: "u_ghost_operator_id", resolution: "no_action", resolutionNote: "n" })
        .where(eq(integrityFlags.id, flag.id)),
    ).rejects.toMatchObject({ cause: { code: "23503", constraint_name: "integrity_flags_resolved_by_user_id_users_id_fk" } });
  });

  it("falls back honestly when the subject row is gone", async () => {
    await seedUser("u_ghost_reporter");
    const flag = await db.transaction((tx) =>
      raiseFlag(tx, {
        flagType: "review_report",
        subjectId: "review_that_does_not_exist",
        leagueId: null,
        evidence: {},
        raisedByUserId: "u_ghost_reporter",
        occurredAt: "2026-08-01T00:00:00.000Z",
        newId: () => "detail_flag_ghost",
        audit: logger,
      }),
    );

    const detail = await flagDetail(db, flag.id);
    expect(detail!.subject).toEqual({ kind: "review", reviewId: "review_that_does_not_exist", body: "This review is no longer here.", authorName: "A former member", removedAt: null });
  });

  it("reads a chat_report flag's subject, found and gone", async () => {
    await seedUser("u_chat_detail_author");
    await seedUser("u_chat_commish");
    await seedLeague("lg_chat_detail", "u_chat_commish");
    const [message] = await db
      .insert(chatMessages)
      .values({ leagueId: "lg_chat_detail", authorUserId: "u_chat_detail_author", body: "trash talk" })
      .returning({ id: chatMessages.id });

    const found = await db.transaction((tx) =>
      raiseFlag(tx, {
        flagType: "chat_report",
        subjectId: String(message!.id),
        leagueId: "lg_chat_detail",
        evidence: {},
        raisedByUserId: "u_chat_detail_author",
        occurredAt: "2026-08-01T00:00:00.000Z",
        newId: () => "detail_flag_chat",
        audit: logger,
      }),
    );
    const foundDetail = await flagDetail(db, found.id);
    expect(foundDetail!.subject).toEqual({ kind: "chat_message", messageId: String(message!.id), body: "trash talk", authorName: "u_chat_detail_author", removedAt: null });

    const ghost = await db.transaction((tx) =>
      raiseFlag(tx, {
        flagType: "chat_report",
        subjectId: "999999",
        leagueId: "lg_chat_detail",
        evidence: {},
        raisedByUserId: "u_chat_detail_author",
        occurredAt: "2026-08-01T00:00:01.000Z",
        newId: () => "detail_flag_chat_ghost",
        audit: logger,
      }),
    );
    const ghostDetail = await flagDetail(db, ghost.id);
    expect(ghostDetail!.subject).toEqual({ kind: "chat_message", messageId: "999999", body: null, authorName: "A former member", removedAt: null });
  });

  /**
   * Fix round 1 (review HIGH): `reportersFor` never had a `chat_message` branch —
   * `chat_message_reports` was populated correctly by `reportMessage` from Task 6's first
   * commit, but the operator queue's detail view showed zero reporters for every chat flag no
   * matter how many people reported it. Mirrors "assembles the subject, the reporters and the
   * trail" above, itemized (never aggregated into a count), in report order — the same shape
   * `review_report`'s own branch already had.
   */
  it("reads a chat_report flag's reporters, itemized in report order — the sibling of the review branch", async () => {
    await seedUser("u_chat_reporters_author");
    await seedUser("u_chat_reporter_a");
    await seedUser("u_chat_reporter_b");
    await seedLeague("lg_chat_reporters", "u_chat_reporters_author");
    const [message] = await db
      .insert(chatMessages)
      .values({ leagueId: "lg_chat_reporters", authorUserId: "u_chat_reporters_author", body: "trash talk" })
      .returning({ id: chatMessages.id });
    const messageId = String(message!.id);

    const flag = await db.transaction((tx) =>
      raiseFlag(tx, {
        flagType: "chat_report",
        subjectId: messageId,
        leagueId: null,
        evidence: {},
        raisedByUserId: "u_chat_reporter_a",
        occurredAt: "2026-08-01T00:00:00.000Z",
        newId: () => "detail_flag_chat_reporters",
        audit: logger,
      }),
    );
    await db.insert(chatMessageReports).values([
      { messageId: message!.id, reporterUserId: "u_chat_reporter_a", reason: "spam", createdAt: new Date("2026-08-01T00:00:01.000Z") },
      { messageId: message!.id, reporterUserId: "u_chat_reporter_b", reason: "abusive", createdAt: new Date("2026-08-01T00:00:02.000Z") },
    ]);

    const counted = countingDb(db);
    const detail = await flagDetail(counted.db, flag.id);
    expect(counted.selectCount()).toBeLessThanOrEqual(5);
    expect(detail!.reporters).toEqual([
      { userId: "u_chat_reporter_a", name: "u_chat_reporter_a", reason: "spam", reportedAt: "2026-08-01T00:00:01.000Z" },
      { userId: "u_chat_reporter_b", name: "u_chat_reporter_b", reason: "abusive", reportedAt: "2026-08-01T00:00:02.000Z" },
    ]);
  });

  it("reads a trade_fairness flag's subject honestly when its trade row is gone — no remover, no reporter", async () => {
    const flag = await db.transaction((tx) =>
      raiseFlag(tx, {
        flagType: "trade_fairness",
        subjectId: "trade_1",
        leagueId: null,
        evidence: {},
        raisedByUserId: null,
        occurredAt: "2026-08-01T00:00:00.000Z",
        newId: () => "detail_flag_trade",
        audit: logger,
      }),
    );
    const detail = await flagDetail(db, flag.id);
    expect(detail!.subject).toEqual({
      kind: "trade",
      tradeId: "trade_1",
      proposerTeamName: "A former team",
      counterpartyTeamName: "A former team",
      gave: [],
      got: [],
      acceptedAt: "",
      reversedAt: null,
      // Empty evidence predates basis tracking too — the honest "we don't know" sentence,
      // Task 6 fix round 1 (review MEDIUM 1).
      valuationBasis: "This flag predates valuation-basis tracking, so the method isn't recorded.",
    });
    expect(detail!.reporters).toEqual([]);
  });

  it("reads a real trade_fairness flag's subject — both teams, both sides' assets straight from evidence, and when it was accepted", async () => {
    await seedUser("u_trade_detail_a");
    await seedUser("u_trade_detail_b");
    await seedLeague("lg_trade_detail", "u_trade_detail_a");
    await db.insert(teams).values([
      { id: "team_trade_detail_a", leagueId: "lg_trade_detail", userId: "u_trade_detail_a", name: "Dynasty Alpha" },
      { id: "team_trade_detail_b", leagueId: "lg_trade_detail", userId: "u_trade_detail_b", name: "Dynasty Beta" },
    ]);
    const acceptedAt = "2026-08-05T00:00:00.000Z";
    await seedAcceptedTrade({
      id: "trade_detail_real",
      leagueId: "lg_trade_detail",
      proposerTeamId: "team_trade_detail_a",
      counterpartyTeamId: "team_trade_detail_b",
      acceptedAt,
    });

    const evidence: JsonObject = {
      verdict: "lopsided",
      flags: ["value_gap_over_threshold"],
      givingValue: 60,
      receivingValue: 0,
      gap: 60,
      threshold: 20,
      giving: [{ playerId: "p_gave", name: "Gave Guy", position: "RB", averagePoints: 60 }],
      receiving: [{ playerId: "p_got", name: "Got Guy", position: "WR", averagePoints: 0 }],
      basis: "sweep_rederivation",
    };
    const flag = await db.transaction((tx) =>
      raiseFlag(tx, {
        flagType: "trade_fairness",
        subjectId: "trade_detail_real",
        leagueId: "lg_trade_detail",
        evidence,
        raisedByUserId: null,
        occurredAt: "2026-08-06T00:00:00.000Z",
        newId: () => "detail_flag_trade_real",
        audit: logger,
      }),
    );

    const detail = await flagDetail(db, flag.id);
    expect(detail!.subject).toEqual({
      kind: "trade",
      tradeId: "trade_detail_real",
      proposerTeamName: "Dynasty Alpha",
      counterpartyTeamName: "Dynasty Beta",
      gave: [{ playerId: "p_gave", name: "Gave Guy", position: "RB", averagePoints: 60 }],
      got: [{ playerId: "p_got", name: "Got Guy", position: "WR", averagePoints: 0 }],
      acceptedAt,
      reversedAt: null,
      // Fix round 1 (review MEDIUM 1): the operator-facing plain-language restatement of
      // `evidence.basis`, computed by `subjectFor` rather than left for a future page to guess.
      valuationBasis: "The fairness sweep valued this trade later, from the rosters as they stood when it ran.",
    });
    expect(detail!.reporters).toEqual([]);
    // ADMIN-ONLY: the raw score lives in evidence, and never anywhere a member can reach it —
    // proved generically by `flag_raised`'s own "hidden" visibility below.
    expect(detail!.evidence).toEqual(evidence);
  });

  it("drops malformed entries from evidence's giving/receiving arrays rather than half-rendering them", async () => {
    await seedUser("u_trade_malformed_a");
    await seedUser("u_trade_malformed_b");
    await seedLeague("lg_trade_malformed", "u_trade_malformed_a");
    await db.insert(teams).values([
      { id: "team_trade_malformed_a", leagueId: "lg_trade_malformed", userId: "u_trade_malformed_a", name: "Malformed A" },
      { id: "team_trade_malformed_b", leagueId: "lg_trade_malformed", userId: "u_trade_malformed_b", name: "Malformed B" },
    ]);
    await seedAcceptedTrade({
      id: "trade_malformed_1",
      leagueId: "lg_trade_malformed",
      proposerTeamId: "team_trade_malformed_a",
      counterpartyTeamId: "team_trade_malformed_b",
      acceptedAt: NOW,
    });

    const evidence: JsonObject = {
      giving: [
        "not an object",
        null,
        { name: "No Id", position: "RB", averagePoints: 5 },
        { playerId: "p1", position: "RB", averagePoints: 5 }, // missing name
        { playerId: "p1", name: "No Points", position: "RB" }, // missing averagePoints
        { playerId: "p1", name: "No Position", averagePoints: 5 }, // no `position` field at all — reads as null
      ],
      receiving: "not an array",
    };
    const flag = await db.transaction((tx) =>
      raiseFlag(tx, {
        flagType: "trade_fairness",
        subjectId: "trade_malformed_1",
        leagueId: "lg_trade_malformed",
        evidence,
        raisedByUserId: null,
        occurredAt: "2026-08-06T00:00:00.000Z",
        newId: () => "detail_flag_trade_malformed",
        audit: logger,
      }),
    );

    const detail = await flagDetail(db, flag.id);
    expect(detail!.subject).toMatchObject({
      kind: "trade",
      gave: [{ playerId: "p1", name: "No Position", position: null, averagePoints: 5 }],
      got: [],
    });
  });

  it("pulls the league chain's own events for an account-pair flag's subject, alongside the platform chain by flag id", async () => {
    await seedUser("u_commish_detail");
    await seedLeague("lg_detail_pair", "u_commish_detail");
    await seedUser("u_pair_detail_a");
    await seedUser("u_pair_detail_b");
    await db.transaction((tx) => logger.record(tx, { eventType: "member_joined", actorId: "u_pair_detail_a", actorType: "user", leagueId: "lg_detail_pair", payload: {}, occurredAt: "2026-08-01T00:00:00.000Z" }));
    await db.transaction((tx) => logger.record(tx, { eventType: "member_joined", actorId: "u_pair_detail_b", actorType: "user", leagueId: "lg_detail_pair", payload: {}, occurredAt: "2026-08-01T00:00:01.000Z" }));

    const flag = await db.transaction((tx) =>
      raiseFlag(tx, {
        flagType: "multi_account",
        subjectId: "u_pair_detail_a:u_pair_detail_b",
        leagueId: "lg_detail_pair",
        evidence: { device: 0.9 },
        raisedByUserId: null,
        occurredAt: "2026-08-02T00:00:00.000Z",
        newId: () => "detail_flag_pair",
        audit: logger,
      }),
    );

    const detail = await flagDetail(db, flag.id);
    expect(detail!.subject).toEqual({ kind: "account_pair", userIds: ["u_pair_detail_a", "u_pair_detail_b"], names: ["u_pair_detail_a", "u_pair_detail_b"] });
    expect(detail!.trail.map((r) => r.headline)).toEqual(["This account joined the league.", "This account joined the league.", "This flag was opened."]);
    // No reporters for a platform-detected pair — nothing in this plan raises a report for one.
    expect(detail!.reporters).toEqual([]);
  });

  it("reads a malformed account-pair subject (no separator) honestly — one real id, one blank", async () => {
    await seedUser("u_lone_detail");
    const flag = await db.transaction((tx) =>
      raiseFlag(tx, {
        flagType: "multi_account",
        subjectId: "u_lone_detail",
        leagueId: null,
        evidence: {},
        raisedByUserId: null,
        occurredAt: "2026-08-01T00:00:00.000Z",
        newId: () => "detail_flag_lone_pair",
        audit: logger,
      }),
    );

    const detail = await flagDetail(db, flag.id);
    expect(detail!.subject).toEqual({ kind: "account_pair", userIds: ["u_lone_detail", ""], names: ["u_lone_detail", "A former member"] });
  });

  it("skips the league-chain trail query for an account-pair flag whose subject id names nobody at all", async () => {
    await seedUser("u_blank_pair_commish");
    await seedLeague("lg_blank_pair", "u_blank_pair_commish");
    const flag = await db.transaction((tx) =>
      raiseFlag(tx, {
        flagType: "multi_account",
        subjectId: "",
        leagueId: "lg_blank_pair",
        evidence: {},
        raisedByUserId: null,
        occurredAt: "2026-08-01T00:00:00.000Z",
        newId: () => "detail_flag_blank_pair",
        audit: logger,
      }),
    );

    const detail = await flagDetail(db, flag.id);
    expect(detail!.trail.map((r) => r.headline)).toEqual(["This flag was opened."]);
  });
});

/**
 * Task 6's trade branch, end to end: a real `proposeTrade` → `acceptTrade` flow, so the trail's
 * events carry real actor ids and a real `roster_move` payload rather than a hand-written fixture
 * standing in for one. This is also the sharpest statement of ruling 1 available: the SAME
 * afternoon produces one row the league reads (`trade_accepted`, on the league feed) and one row
 * it cannot reach (`flag_raised`, platform-scoped) — and the difference is which chain each event
 * landed on, not a filter applied at read time.
 */
describe("the trade branch's operator trail, end to end (Task 6)", () => {
  const TRAIL_SLOTS = [
    { slot: "RB" as const, count: 1, eligiblePositions: ["RB" as const] },
    { slot: "BENCH" as const, count: 1, eligiblePositions: ["RB" as const] },
  ];
  const trailClock = { now: () => "2026-08-10T00:00:00.000Z" };

  async function seedLopsidedTradeLeague(): Promise<{ readonly leagueId: string; readonly teamA: string; readonly teamB: string }> {
    await db.insert(users).values([
      { id: "u_trail_alice", email: "u_trail_alice@test.local", displayName: "Alice" },
      { id: "u_trail_bob", email: "u_trail_bob@test.local", displayName: "Bob" },
    ]);
    const created = await createLeague({ db, clock: trailClock, newId: () => "lg_trail" }, {
      name: "Trail League",
      format: "snake",
      teamCount: 2,
      scoringPreset: "standard",
      auctionBudget: null,
      rosterSlots: TRAIL_SLOTS,
      commissionerUserId: "u_trail_alice",
      teamName: "Team Alice",
      experienceTier: "beginner",
      stakeTier: 0,
      isPublicMatchmade: false,
    });
    if (!created.ok) throw new Error(created.reason);
    const teamB = "team_trail_bob";
    await db.insert(teams).values({ id: teamB, leagueId: created.leagueId, userId: "u_trail_bob", name: "Team Bob" });
    await db.update(drafts).set({ status: "complete" }).where(eq(drafts.leagueId, created.leagueId));
    await db.insert(players).values([
      { id: "p_trail_star", name: "Trail Star", position: "RB", nflTeam: "KC" },
      { id: "p_trail_scrub", name: "Trail Scrub", position: "RB", nflTeam: "SF" },
    ]);
    await db.insert(rosterSlots).values([
      { teamId: created.teamId, slot: "RB", slotIndex: 0, playerId: "p_trail_star" },
      { teamId: teamB, slot: "RB", slotIndex: 0, playerId: "p_trail_scrub" },
    ]);
    await db.insert(playerStatLines).values([1, 2, 3].map((week) => ({ playerId: "p_trail_star", week, rushingYards: 300, rushingTouchdowns: 5 })));
    return { leagueId: created.leagueId, teamA: created.teamId, teamB };
  }

  it("shows an operator the whole propose-to-accept sequence for the flagged trade", async () => {
    const league = await seedLopsidedTradeLeague();

    const proposed = await proposeTrade(db, {
      leagueId: league.leagueId,
      userId: "u_trail_alice",
      counterpartyTeamId: league.teamB,
      weekNumber: 4,
      proposerAssets: [{ kind: "player", playerId: "p_trail_star" }],
      counterpartyAssets: [{ kind: "player", playerId: "p_trail_scrub" }],
      note: null,
      clock: trailClock,
      deliver: async () => {},
    });
    expect(proposed).toMatchObject({ ok: true });
    if (!proposed.ok) return;

    const accepted = await acceptTrade(db, { tradeId: proposed.tradeId, leagueId: league.leagueId, userId: "u_trail_bob", clock: trailClock, deliver: async () => {} });
    expect(accepted).toMatchObject({ ok: true, fairness: { flagWorthy: true } });

    const [flagRow] = await db.select().from(integrityFlags).where(eq(integrityFlags.subjectId, proposed.tradeId));
    expect(flagRow).toBeDefined();

    // Fix round 1 (review MEDIUM 2): `trailFor`'s own docblock claims "bounded at two queries
    // for trade" — proved here, the same `countingDb` idiom the `chat_report` reporters test
    // uses (`flags.test.ts`, "reads a chat_report flag's reporters..."), rather than left as
    // prose only. The bound: the flag row itself (1), `subjectFor`'s trade branch (the trade row
    // plus its two team names, 2), `reportersFor` (0 — the trade branch answers synchronously),
    // and `trailFor`'s own claimed two (the trade's own league-chain rows, plus the batched
    // actor-name lookup) = 5.
    const counted = countingDb(db);
    const detail = await flagDetail(counted.db, flagRow!.id);
    expect(counted.selectCount()).toBeLessThanOrEqual(5);
    expect(detail!.trail.map((row) => row.headline)).toEqual(["Alice offered this trade.", "Bob accepted it.", "Two players changed teams."]);
  });

  /**
   * No REAL trade-lifecycle event is ever written with a null actor — `proposeTrade` and
   * `acceptTrade` both stamp `actorId: input.userId`, always a real signed-in caller. Driven
   * directly (`logger.record`, bypassing both services) the same "narrow test puts the code in a
   * state production can't produce" discipline this file's other impossible-state guards use,
   * so `trailActorName`'s own `null` branch is proved rather than merely written.
   */
  it("names a trade trail event's actor honestly if actorId is somehow null", async () => {
    const league = await seedLopsidedTradeLeague();
    await db.transaction((tx) =>
      logger.record(tx, {
        eventType: "trade_proposed",
        actorId: null,
        actorType: "system",
        leagueId: league.leagueId,
        payload: { tradeId: "trade_trail_null_actor", proposerTeamId: league.teamA, counterpartyTeamId: league.teamB },
        occurredAt: "2026-08-10T00:00:00.000Z",
      }),
    );
    const flag = await db.transaction((tx) =>
      raiseFlag(tx, {
        flagType: "trade_fairness",
        subjectId: "trade_trail_null_actor",
        leagueId: league.leagueId,
        evidence: {},
        raisedByUserId: null,
        occurredAt: "2026-08-11T00:00:00.000Z",
        newId: () => "detail_flag_trail_null_actor",
        audit: logger,
      }),
    );

    const detail = await flagDetail(db, flag.id);
    expect(detail!.trail.map((row) => row.headline)).toEqual(["A former member offered this trade."]);
  });

  it("shows a member of that league nothing about the flag at all — the allowlist proof, completed for the third flag type", async () => {
    const league = await seedLopsidedTradeLeague();

    const proposed = await proposeTrade(db, {
      leagueId: league.leagueId,
      userId: "u_trail_alice",
      counterpartyTeamId: league.teamB,
      weekNumber: 4,
      proposerAssets: [{ kind: "player", playerId: "p_trail_star" }],
      counterpartyAssets: [{ kind: "player", playerId: "p_trail_scrub" }],
      note: null,
      clock: trailClock,
      deliver: async () => {},
    });
    expect(proposed).toMatchObject({ ok: true });
    if (!proposed.ok) return;
    await acceptTrade(db, { tradeId: proposed.tradeId, leagueId: league.leagueId, userId: "u_trail_bob", clock: trailClock, deliver: async () => {} });

    const page = await listLeagueActivity(db, { leagueId: league.leagueId, viewerUserId: "u_trail_alice" });
    // Not "the scores are filtered out" — `flag_raised` is on the platform chain and
    // `listLeagueActivity` never reads it at all.
    expect(JSON.stringify(page.rows)).not.toMatch(/fairness|lopsided|flag/i);
    // …while the trade itself IS there, because a trade is league news and a flag is not.
    expect(page.rows.some((row) => row.headline.includes("trade"))).toBe(true);
  });
});
