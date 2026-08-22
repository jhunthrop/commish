import { readFileSync } from "node:fs";
import { join } from "node:path";
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
import { currentWeekOf } from "@/league-service/schedule";
import { seasonCurrentWeek } from "@/league-service/test-support";
import { acceptTrade, proposeTrade, releaseHeldTradeInTx } from "@/league-service/trades";
import { createAuditLogger, type AuditLogger } from "./audit-logger";
import { notifyAffectedMember } from "./notify";
import { flagDetail, leagueModerationSummary, listPendingFlags, MODERATION_SUMMARY_FIELDS, pendingFlagQuery, raiseFlag, removeSubject, resolveFlag } from "./flags";
import { raiseFlag as raiseFlagReExported } from "./raise-flag";
import { closeSupersededHoldFlag } from "./trade-fairness";

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

describe("one raiseFlag, one home (fix round 1, LOW — the raise-flag.ts move)", () => {
  it("is the same function object trade-fairness.ts and multi-account.ts call, not a copy that could drift", () => {
    // The same identity-pin idiom Task 1 established for `tradeBalance`'s move to `src/trades/
    // fairness.ts` (`src/trades/fairness.test.ts`) — a re-export satisfies "it still works" even
    // if a second implementation gets pasted in beside it later; only object identity proves this
    // is a de-duplication, not a fork.
    expect(raiseFlagReExported).toBe(raiseFlag);
  });

  it("leaves no second implementation behind in flags.ts", () => {
    // A grep, not an import check — the same belt Task 1's own move test uses.
    const source = readFileSync(join(process.cwd(), "src", "integrity-service", "flags.ts"), "utf8");
    expect(source).not.toContain("onConflictDoNothing({ target: [integrityFlags.subjectType");
    expect(source).not.toContain("function existingOpenFlagFor");
  });
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

  it("refuses trade_reversed for a subject that isn't a trade, before any write (Task 7)", async () => {
    // `trade_reversed` is real now — this is the subject-aware refusal that replaces the old
    // blanket "not owned by this plan" message, mirroring `content_removed`'s own unwired-subject
    // check just above.
    await ensureUser("u_op");
    const flag = await openFlag({ flagType: "review_report" });

    const result = await resolveFlag(db, { flagId: flag.id, decision: "trade_reversed", note: "n", operatorUserId: "u_op" });
    expect(result).toEqual({
      ok: false,
      status: 400,
      reason: "There is no trade on this flag to reverse. Close it with no action, or warn the member.",
    });
    expect(await auditEventsOn("platform", "flag_resolved")).toHaveLength(0);

    const [row] = await db.select().from(integrityFlags).where(eq(integrityFlags.id, flag.id));
    expect(row!.resolvedAt).toBeNull();
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

  /**
   * Fix round 2, F1 — THE ACCUSATORY-NOTE SEAM, one guard shared by every decision whose note
   * reaches someone other than the operator who wrote it. `warned_user`'s own note quotes
   * VERBATIM in the member's notice, so this is the most direct case.
   */
  it("refuses a warned_user note containing an accusatory term, before opening a transaction, naming the term", async () => {
    await ensureUser("u_op");
    const flag = await openFlag({ flagType: "chat_report", subjectAuthor: "u_member_accusatory", leagueId: "lg_accusatory" });

    const result = await resolveFlag(db, { flagId: flag.id, decision: "warned_user", note: "This looks like cheating to me.", operatorUserId: "u_op" });
    expect(result).toEqual({
      ok: false,
      status: 400,
      reason: 'Your note can\'t include "cheating". Describe what happened without naming what you suspect, then try again.',
    });

    const [row] = await db.select().from(integrityFlags).where(eq(integrityFlags.id, flag.id));
    expect(row!.resolvedAt).toBeNull();
    expect(await noticesFor("u_member_accusatory")).toEqual([]);
  });

  it("refuses a content_removed note containing an accusatory term — the note becomes the permanent removal reason", async () => {
    await ensureUser("u_op");
    const flag = await openFlag({ flagType: "review_report", subjectAuthor: "u_review_accusatory" });

    const result = await resolveFlag(db, { flagId: flag.id, decision: "content_removed", note: "Suspected of abuse in the league chat too.", operatorUserId: "u_op" });
    expect(result).toEqual({
      ok: false,
      status: 400,
      reason: 'Your note can\'t include "suspected". Describe what happened without naming what you suspect, then try again.',
    });

    const [row] = await db.select().from(integrityFlags).where(eq(integrityFlags.id, flag.id));
    expect(row!.resolvedAt).toBeNull();
  });

  it("never guards no_action's own note — ruling 6 notices nobody, so there is no one to protect from it", async () => {
    await ensureUser("u_op");
    const flag = await openFlag({ flagType: "review_report" });

    const result = await resolveFlag(db, { flagId: flag.id, decision: "no_action", note: "Looked into the cheating allegation, found nothing.", operatorUserId: "u_op" });
    expect(result).toMatchObject({ ok: true, decision: "no_action" });
  });

  /**
   * THE SWEEP: proves the guard reads `INTEGRITY_CONFIG.notices.accusatoryTerms` itself, not a
   * hand-copied subset that could drift from it — every term the real config list declares must
   * be caught, for every decision the guard actually covers.
   */
  it("catches every term in the REAL accusatoryTerms config list, for every guarded decision", async () => {
    await ensureUser("u_op_sweep");
    for (const term of INTEGRITY_CONFIG.notices.accusatoryTerms) {
      for (const decision of ["warned_user", "content_removed", "trade_reversed"] as const) {
        const flag = await openFlag({ flagType: "review_report" });
        const result = await resolveFlag(db, { flagId: flag.id, decision, note: `This is a note about ${term} happening.`, operatorUserId: "u_op_sweep" });
        expect(result).toMatchObject({ ok: false, status: 400, reason: expect.stringContaining(`"${term}"`) });
      }
    }
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

describe("resolveFlag's trade_reversed branch (Task 7)", () => {
  const trClock = { now: () => "2026-08-25T00:00:00.000Z" };
  const TR_SLOTS = [
    { slot: "RB" as const, count: 1, eligiblePositions: ["RB" as const] },
    { slot: "WR" as const, count: 1, eligiblePositions: ["WR" as const] },
    { slot: "BENCH" as const, count: 1, eligiblePositions: ["RB" as const, "WR" as const] },
  ];

  /** A real accepted trade (Alice's RB for Bob's WR), plus a `trade_fairness` flag naming it. */
  async function acceptedTradeWithFlag(suffix: string): Promise<{
    readonly leagueId: string;
    readonly teamA: string;
    readonly teamB: string;
    readonly userA: string;
    readonly userB: string;
    readonly tradeId: string;
    readonly flagId: string;
  }> {
    const userA = `u_tr_alice_${suffix}`;
    const userB = `u_tr_bob_${suffix}`;
    await db.insert(users).values([
      { id: userA, email: `${userA}@test.local`, displayName: "Alice" },
      { id: userB, email: `${userB}@test.local`, displayName: "Bob" },
    ]);
    const created = await createLeague({ db, clock: trClock, newId: () => `lg_tr_${suffix}_${crypto.randomUUID()}` }, {
      name: "Reversal Integration League",
      format: "snake",
      teamCount: 2,
      scoringPreset: "ppr",
      auctionBudget: null,
      rosterSlots: TR_SLOTS,
      commissionerUserId: userA,
      teamName: "Team Alice",
      experienceTier: "beginner",
      stakeTier: 0,
      isPublicMatchmade: false,
    });
    if (!created.ok) throw new Error(created.reason);
    const teamB = `team_tr_bob_${suffix}`;
    await db.insert(teams).values({ id: teamB, leagueId: created.leagueId, userId: userB, name: "Team Bob" });
    await db.update(drafts).set({ status: "complete" }).where(eq(drafts.leagueId, created.leagueId));
    await db
      .insert(players)
      .values([
        { id: `p_tr_rb_${suffix}`, name: "Star RB", position: "RB", nflTeam: "KC" },
        { id: `p_tr_wr_${suffix}`, name: "Bench WR", position: "WR", nflTeam: "SF" },
      ])
      .onConflictDoNothing();
    await db.insert(rosterSlots).values([
      { teamId: created.teamId, slot: "RB", slotIndex: 0, playerId: `p_tr_rb_${suffix}` },
      { teamId: teamB, slot: "WR", slotIndex: 0, playerId: `p_tr_wr_${suffix}` },
    ]);

    const proposed = await proposeTrade(db, {
      leagueId: created.leagueId,
      userId: userA,
      counterpartyTeamId: teamB,
      proposerAssets: [{ kind: "player", playerId: `p_tr_rb_${suffix}` }],
      counterpartyAssets: [{ kind: "player", playerId: `p_tr_wr_${suffix}` }],
      note: null,
      clock: trClock,
      deliver: async () => {},
    });
    if (!proposed.ok) throw new Error(proposed.reason);
    const accepted = await acceptTrade(db, { tradeId: proposed.tradeId, leagueId: created.leagueId, userId: userB, clock: trClock, deliver: async () => {} });
    if (!accepted.ok) throw new Error(accepted.reason);

    const flagId = `flag_tr_${suffix}`;
    await db.transaction((tx) =>
      raiseFlag(tx, {
        flagType: "trade_fairness",
        subjectId: proposed.tradeId,
        leagueId: created.leagueId,
        evidence: {},
        raisedByUserId: null,
        occurredAt: trClock.now(),
        newId: () => flagId,
        audit: logger,
      }),
    );

    return { leagueId: created.leagueId, teamA: created.teamId, teamB, userA, userB, tradeId: proposed.tradeId, flagId };
  }

  async function isOpenFlag(flagId: string): Promise<boolean> {
    const [row] = await db.select({ resolvedAt: integrityFlags.resolvedAt }).from(integrityFlags).where(eq(integrityFlags.id, flagId));
    return row !== undefined && row.resolvedAt === null;
  }

  async function tradeRow(tradeId: string) {
    const [row] = await db.select().from(tradeProposals).where(eq(tradeProposals.id, tradeId));
    return row!;
  }

  async function auditEventsOn(scope: string, eventType: AuditEventType) {
    return db.select().from(auditEvents).where(and(eq(auditEvents.chainScope, scope), eq(auditEvents.eventType, eventType)));
  }

  /** The resolving operator — a real `users` row, since `integrity_flags.resolved_by_user_id`
   *  carries a real foreign key. */
  async function ensureOperator(id: string): Promise<void> {
    await db.insert(users).values({ id, email: `${id}@test.local`, displayName: id }).onConflictDoNothing();
  }

  /**
   * Fix round 2, F1, on a REAL trade flag (the sweep in `resolveFlag`'s own describe block above
   * proves the guard against every real config term, on a stand-in subject; this proves it fires
   * BEFORE `reverseTradeInTx` ever opens a transaction for the one decision this whole task
   * built). `trade_reversed`'s own notice quotes the note VERBATIM to both managers, which is
   * exactly what Persona 3/4's panel finding named as the uncontrolled channel this guard closes.
   */
  it("refuses a trade_reversed note containing an accusatory term, before the reversal's own transaction ever opens", async () => {
    await ensureOperator("u_op");
    const fx = await acceptedTradeWithFlag("accusatory");

    const result = await resolveFlag(db, {
      flagId: fx.flagId,
      decision: "trade_reversed",
      note: "This trade looks like a violation of the collusion rules.",
      operatorUserId: "u_op",
      clock: trClock,
    });
    expect(result).toEqual({
      ok: false,
      status: 400,
      reason: 'Your note can\'t include "violation". Describe what happened without naming what you suspect, then try again.',
    });

    expect(await isOpenFlag(fx.flagId)).toBe(true);
    const row = await tradeRow(fx.tradeId);
    expect(row.reversedAt).toBeNull(); // the reversal never ran at all
    expect(await auditEventsOn(fx.leagueId, "roster_move")).toHaveLength(1); // the original trade only
  });

  it("puts the reversal on the LEAGUE chain and the decision on the platform chain — the two-class sentence, driven", async () => {
    await ensureOperator("u_op");
    const fx = await acceptedTradeWithFlag("chain");
    const result = await resolveFlag(db, {
      flagId: fx.flagId,
      decision: "trade_reversed",
      note: "Two accounts, one household, and this trade is why we looked.",
      operatorUserId: "u_op",
      clock: trClock,
    });
    expect(result).toMatchObject({ ok: true, flagId: fx.flagId, decision: "trade_reversed" });

    // The league can SEE two rosters change back, so the roster_move is theirs: the trade, then
    // the reversal — two rows, one chain.
    expect(await auditEventsOn(fx.leagueId, "roster_move")).toHaveLength(2);
    // The investigation that ordered it is not the league's business: one flag_resolved, on the
    // platform chain, and NONE on the league's.
    expect(await auditEventsOn("platform", "flag_resolved")).toHaveLength(1);
    expect(await auditEventsOn(fx.leagueId, "flag_resolved")).toHaveLength(0);

    const row = await tradeRow(fx.tradeId);
    expect(row.status).toBe("accepted");
    expect(row.reversedAt).not.toBeNull();
    expect(row.reversedByFlagId).toBe(fx.flagId);

    // (The cache eviction this same commit adds has its own case below.)

    // The moved-again read is skipped once the trade IS already reversed — `subjectIsAlreadyReversed`
    // withholds the decision for that reason already, so the preview reads honestly `false`
    // without spending a roster query on a question the page won't ask anyway.
    const detail = await flagDetail(db, fx.flagId);
    expect(detail!.subject).toMatchObject({ kind: "trade", reversedAt: expect.any(String), playersMovedAgain: false });
  });

  it("refuses when a traded player has since moved on, leaves the flag OPEN, and stamps nothing at all", async () => {
    await ensureOperator("u_op");
    const fx = await acceptedTradeWithFlag("moved");
    // A third manager: Bob moves the player he got from Alice onward to Carol.
    const userC = "u_tr_carol_moved";
    await db.insert(users).values({ id: userC, email: `${userC}@test.local`, displayName: "Carol" });
    const teamC = "team_tr_carol_moved";
    await db.insert(teams).values({ id: teamC, leagueId: fx.leagueId, userId: userC, name: "Team Carol" });
    await db.insert(players).values({ id: "p_tr_carol_1", name: "Carol's Player", position: "RB", nflTeam: "LAC" });
    await db.insert(rosterSlots).values({ teamId: teamC, slot: "BENCH", slotIndex: 0, playerId: "p_tr_carol_1" });
    const secondProposed = await proposeTrade(db, {
      leagueId: fx.leagueId,
      userId: fx.userB,
      counterpartyTeamId: teamC,
      proposerAssets: [{ kind: "player", playerId: "p_tr_rb_moved" }],
      counterpartyAssets: [{ kind: "player", playerId: "p_tr_carol_1" }],
      note: null,
      clock: trClock,
      deliver: async () => {},
    });
    if (!secondProposed.ok) throw new Error(secondProposed.reason);
    const secondAccepted = await acceptTrade(db, { tradeId: secondProposed.tradeId, leagueId: fx.leagueId, userId: userC, clock: trClock, deliver: async () => {} });
    expect(secondAccepted.ok).toBe(true);

    const result = await resolveFlag(db, { flagId: fx.flagId, decision: "trade_reversed", note: "n", operatorUserId: "u_op", clock: trClock });
    expect(result).toEqual({
      ok: false,
      status: 409,
      reason: "One of these players has been traded again since. Undoing this trade would take a player off a third team, so it needs a different decision.",
    });
    expect(await isOpenFlag(fx.flagId)).toBe(true); // the question stays open
    expect(await auditEventsOn("platform", "flag_resolved")).toHaveLength(0);
  });

  /**
   * F3 (LOW, M8 discipline): the precomputed preview `flagDetail` gives the queue detail page —
   * `false` before a traded player moves on, `true` after, using the SAME ownership check
   * `reverseTradeInTx`'s own STEP 4 makes (`tradePlayersHaveMovedAgain`), so the two can never
   * disagree about what "moved again" means.
   */
  it("previews playersMovedAgain honestly — false while the trade is still reversible, true once a player has moved on", async () => {
    const fx = await acceptedTradeWithFlag("preview");
    const before = await flagDetail(db, fx.flagId);
    expect(before!.subject).toMatchObject({ kind: "trade", playersMovedAgain: false });

    const userC = "u_tr_carol_preview";
    await db.insert(users).values({ id: userC, email: `${userC}@test.local`, displayName: "Carol" });
    const teamC = "team_tr_carol_preview";
    await db.insert(teams).values({ id: teamC, leagueId: fx.leagueId, userId: userC, name: "Team Carol" });
    await db.insert(players).values({ id: "p_tr_carol_preview_1", name: "Carol's Player", position: "RB", nflTeam: "LAC" });
    await db.insert(rosterSlots).values({ teamId: teamC, slot: "BENCH", slotIndex: 0, playerId: "p_tr_carol_preview_1" });
    const secondProposed = await proposeTrade(db, {
      leagueId: fx.leagueId,
      userId: fx.userB,
      counterpartyTeamId: teamC,
      proposerAssets: [{ kind: "player", playerId: "p_tr_rb_preview" }],
      counterpartyAssets: [{ kind: "player", playerId: "p_tr_carol_preview_1" }],
      note: null,
      clock: trClock,
      deliver: async () => {},
    });
    if (!secondProposed.ok) throw new Error(secondProposed.reason);
    await acceptTrade(db, { tradeId: secondProposed.tradeId, leagueId: fx.leagueId, userId: userC, clock: trClock, deliver: async () => {} });

    const after = await flagDetail(db, fx.flagId);
    expect(after!.subject).toMatchObject({ kind: "trade", playersMovedAgain: true });
    // The preview and the service's own refusal agree, because they run the identical check.
    expect(after!.decisions).not.toContain("trade_reversed");
  });

  /**
   * STATE 3 (fix round 1, F1's three-state discrimination): reversed via a DIFFERENT flag. Not
   * the same flag retrying its own work (the healing test above, state 2) — a genuinely SECOND
   * flag, opened by a fresh report after the first already reversed the trade, gets the ordinary
   * double-reversal refusal, and its own attempt stays open (a different decision, or no_action,
   * is what actually closes it).
   */
  it("refuses a second reversal of the same trade across two different flags, and the second flag stays open", async () => {
    await ensureOperator("u_op");
    await ensureOperator("u_op2");
    const fx = await acceptedTradeWithFlag("twice");
    const first = await resolveFlag(db, { flagId: fx.flagId, decision: "trade_reversed", note: "n", operatorUserId: "u_op", clock: trClock });
    expect(first).toMatchObject({ ok: true });

    // A second report on the same trade opens a NEW flag — the open-subject index only dedupes
    // OPEN flags, and this one is already resolved.
    const reReportedId = "flag_tr_twice_again";
    await db.transaction((tx) =>
      raiseFlag(tx, {
        flagType: "trade_fairness",
        subjectId: fx.tradeId,
        leagueId: fx.leagueId,
        evidence: {},
        raisedByUserId: null,
        occurredAt: trClock.now(),
        newId: () => reReportedId,
        audit: logger,
      }),
    );

    const second = await resolveFlag(db, { flagId: reReportedId, decision: "trade_reversed", note: "n", operatorUserId: "u_op2", clock: trClock });
    expect(second).toMatchObject({ ok: false, status: 409, reason: "This trade has already been reversed." });
    expect(await isOpenFlag(reReportedId)).toBe(true); // still open — a different decision, or no_action, can close it
  });

  /**
   * FINAL REVIEW, MEDIUM 4. `acceptTrade` evicts after commit, matching `setLineup` and
   * `finalizeWeek` — the codebase's cache-invalidating writers. The reversal is the FOURTH roster
   * mutator on the same path and evicted nothing, so an operator's reversal left
   * `crossLeagueHome`'s cached scores stale until TTL. It even returned the `weekNumber` nobody
   * consumed. Same scope as `acceptTrade`'s: the league's derived current week, post-commit.
   */
  it("evicts the score cache for the league's current week after the reversal commits", async () => {
    await ensureOperator("u_op");
    const fx = await acceptedTradeWithFlag("cache");
    const calls: { readonly leagueId: string; readonly week: number }[] = [];
    const cache = {
      invalidate: async (leagueId: string, week: number) => {
        calls.push({ leagueId, week });
      },
    };

    const result = await resolveFlag(db, { flagId: fx.flagId, decision: "trade_reversed", note: "n", operatorUserId: "u_op", clock: trClock, cache });
    expect(result).toMatchObject({ ok: true });
    expect(calls).toEqual([{ leagueId: fx.leagueId, week: await currentWeekOf(db, fx.leagueId) }]);
  });

  it("never fails a reversal that already committed because the cache eviction failed", async () => {
    await ensureOperator("u_op");
    const fx = await acceptedTradeWithFlag("cachefail");
    const cache = {
      invalidate: async () => {
        throw new Error("redis is down");
      },
    };

    const errors: unknown[] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]) => {
      errors.push(args);
    };
    let result: Awaited<ReturnType<typeof resolveFlag>>;
    try {
      result = await resolveFlag(db, { flagId: fx.flagId, decision: "trade_reversed", note: "n", operatorUserId: "u_op", clock: trClock, cache });
    } finally {
      console.error = originalError;
    }

    // The rosters really moved back and the flag really closed — a stale cache key is one read
    // bounded by its own TTL, never worth failing a resolution that already landed.
    expect(result).toMatchObject({ ok: true, decision: "trade_reversed" });
    expect((await tradeRow(fx.tradeId)).reversedAt).not.toBeNull();
    expect(await isOpenFlag(fx.flagId)).toBe(false);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("[integrity-service] score cache invalidation failed after a trade reversal");
  });

  /** Every OTHER decision leaves the cache alone: nothing moved, so nothing is stale. */
  it("evicts nothing for a decision that moves no roster", async () => {
    await ensureOperator("u_op");
    const fx = await acceptedTradeWithFlag("nocache");
    const calls: unknown[] = [];
    const cache = { invalidate: async () => void calls.push(1) };

    await resolveFlag(db, { flagId: fx.flagId, decision: "no_action", note: "Looked, found nothing.", operatorUserId: "u_op", clock: trClock, cache });
    expect(calls).toEqual([]);
  });

  it("tells BOTH managers, and the note travels as their own words", async () => {
    await ensureOperator("u_op");
    const fx = await acceptedTradeWithFlag("both");
    await resolveFlag(db, { flagId: fx.flagId, decision: "trade_reversed", note: "Two accounts, one household.", operatorUserId: "u_op", clock: trClock });

    const aliceReversal = (await db.select().from(memberNotices).where(eq(memberNotices.userId, fx.userA))).find((n) => n.noticeType === "trade_reversed");
    const bobReversal = (await db.select().from(memberNotices).where(eq(memberNotices.userId, fx.userB))).find((n) => n.noticeType === "trade_reversed");
    expect(aliceReversal).toBeDefined();
    expect(bobReversal).toBeDefined();
  });

  async function ownerTeamOf(playerId: string): Promise<string | null> {
    const [row] = await db.select({ teamId: rosterSlots.teamId }).from(rosterSlots).where(eq(rosterSlots.playerId, playerId));
    return row?.teamId ?? null;
  }

  /**
   * THE FAILURE INJECTION AND ITS HEALING (dispatch instruction, binding; fix round 1, HIGH).
   * `reverseTradeInTx`'s own transaction commits FIRST; `resolveFlag`'s own (the platform-chain
   * stamp) opens only after. An `audit` that lets a LEAGUE-scoped append through (the reversal
   * succeeds and commits) but throws on a PLATFORM-scoped one (this function's own
   * `flag_resolved`) proves that first half directly: the trade is genuinely reversed, the flag
   * stays open, and nothing is silently swallowed — the failure propagates as a rejected promise.
   * A RETRY of the identical decision, with a working `audit`, must then HEAL that partial state
   * rather than getting stuck behind `reverseTradeInTx`'s own already-reversed guard: it recognizes
   * the trade as this SAME flag's own completed work (`reversedByFlagId` already names it),
   * skips the transfer (it already ran, exactly once), and lets `resolveFlag` reach its own stamp.
   */
  it("heals a stuck-open flag on retry after a partial resolveFlag failure — the reversal completes exactly once", async () => {
    await ensureOperator("u_op");
    const fx = await acceptedTradeWithFlag("heal");
    const failingAudit: AuditLogger = {
      record: async (tx, input) => {
        if (input.leagueId === null) throw new Error("injected platform-chain failure");
        return logger.record(tx, input);
      },
      recordAll: async (tx, inputs) => {
        if (inputs.some((i) => i.leagueId === null)) throw new Error("injected platform-chain failure");
        return logger.recordAll(tx, inputs);
      },
    };

    // FIRST ATTEMPT: the reversal's own (earlier, separate) transaction commits; this function's
    // own platform-chain stamp then fails.
    await expect(
      resolveFlag(db, { flagId: fx.flagId, decision: "trade_reversed", note: "n", operatorUserId: "u_op", clock: trClock, audit: failingAudit }),
    ).rejects.toThrow("injected platform-chain failure");
    expect(await isOpenFlag(fx.flagId)).toBe(true);
    expect(await auditEventsOn("platform", "flag_resolved")).toHaveLength(0);

    // RETRY, with a working audit: heals rather than refuses.
    const retry = await resolveFlag(db, { flagId: fx.flagId, decision: "trade_reversed", note: "n", operatorUserId: "u_op", clock: trClock });
    expect(retry).toMatchObject({ ok: true, flagId: fx.flagId, decision: "trade_reversed" });

    // The flag is actually resolved now, not stuck.
    expect(await isOpenFlag(fx.flagId)).toBe(false);
    expect(await auditEventsOn("platform", "flag_resolved")).toHaveLength(1);

    // The trade is reversed exactly once — stamped by the FIRST attempt, untouched by the retry.
    const row = await tradeRow(fx.tradeId);
    expect(row.reversedAt).not.toBeNull();
    expect(row.reversedByFlagId).toBe(fx.flagId);

    // The rosters are correct — the retry never re-ran the transfer.
    expect(await ownerTeamOf("p_tr_rb_heal")).toBe(fx.teamA);
    expect(await ownerTeamOf("p_tr_wr_heal")).toBe(fx.teamB);

    // Exactly ONE reversal roster_move exists on the league chain (plus the original trade's own),
    // never two — the retry's skip-the-transfer branch never appends a second one.
    const moves = await auditEventsOn(fx.leagueId, "roster_move");
    expect(moves).toHaveLength(2); // the original trade, then the reversal — once each
    const reversalMoves = moves.filter((m) => (m.payload as { readonly reason?: string }).reason === "trade_reversed");
    expect(reversalMoves).toHaveLength(1);
  });

  /**
   * `reverseTradeInTx`'s own `applyTradeInTx` re-check can throw `TransferRefusedError` for a
   * genuine roster-space conflict (never for "already reversed" or "moved again", both of which
   * `reverseTradeInTx` answers as a plain refusal) — `resolveFlag`'s own `catch` around the
   * reversal's transaction is what converts that throw into a clean 409 rather than an uncaught
   * rejection reaching the route. Bob's WR slot and its one BENCH slot (also WR-eligible) both get
   * filled by unrelated players between accept and reversal, leaving no home for the WR the
   * reversal would return to him.
   */
  it("converts a genuine roster-space TransferRefusedError into a clean 409, not an uncaught throw", async () => {
    await ensureOperator("u_op");
    const fx = await acceptedTradeWithFlag("noroom");
    await db.insert(players).values([
      { id: "p_tr_filler_wr", name: "Filler WR", position: "WR", nflTeam: "DAL" },
      { id: "p_tr_filler_bench", name: "Filler Bench", position: "WR", nflTeam: "MIA" },
    ]);
    await db.update(rosterSlots).set({ playerId: "p_tr_filler_wr" }).where(and(eq(rosterSlots.teamId, fx.teamB), eq(rosterSlots.slot, "WR"), eq(rosterSlots.slotIndex, 0)));
    await db.update(rosterSlots).set({ playerId: "p_tr_filler_bench" }).where(and(eq(rosterSlots.teamId, fx.teamB), eq(rosterSlots.slot, "BENCH"), eq(rosterSlots.slotIndex, 0)));

    const result = await resolveFlag(db, { flagId: fx.flagId, decision: "trade_reversed", note: "n", operatorUserId: "u_op", clock: trClock });
    expect(result).toMatchObject({ ok: false, status: 409 });
    expect(await isOpenFlag(fx.flagId)).toBe(true);
    const row = await tradeRow(fx.tradeId);
    expect(row.reversedAt).toBeNull(); // the whole reversal transaction rolled back
  });

  /**
   * The `catch` block's OTHER branch: anything that isn't `TransferRefusedError` propagates as a
   * rejected promise rather than becoming a graceful `{ ok: false }` — the identical discipline
   * `acceptTrade`'s own `catch` around `applyTradeInTx` holds to. A throwing `notify`, injected
   * into the reversal via `resolveFlag`'s own `input.notify` (threaded straight through to
   * `reverseTradeInTx`), stands in for any unexpected failure inside that transaction.
   */
  it("rethrows anything that is NOT a TransferRefusedError from the reversal's own transaction", async () => {
    await ensureOperator("u_op");
    const fx = await acceptedTradeWithFlag("rethrow");
    const throwingNotify: typeof notifyAffectedMember = async () => {
      throw new Error("unexpected reversal-transaction failure");
    };

    await expect(
      resolveFlag(db, { flagId: fx.flagId, decision: "trade_reversed", note: "n", operatorUserId: "u_op", clock: trClock, notify: throwingNotify }),
    ).rejects.toThrow("unexpected reversal-transaction failure");

    expect(await isOpenFlag(fx.flagId)).toBe(true);
    const row = await tradeRow(fx.tradeId);
    expect(row.reversedAt).toBeNull(); // the whole reversal transaction rolled back, not just the notice
  });

  it("falls through to the ordinary 404 for a flagId that names nothing at all, even for trade_reversed", async () => {
    await ensureOperator("u_op");
    const result = await resolveFlag(db, { flagId: "flag_tr_ghost", decision: "trade_reversed", note: "n", operatorUserId: "u_op", clock: trClock });
    expect(result).toEqual({ ok: false, status: 404, reason: 'No flag with id "flag_tr_ghost".' });
  });
});

describe("resolveFlag's trade_released/trade_blocked branches (Plan D, Task 5)", () => {
  const hClock = { now: () => "2026-08-26T00:00:00.000Z" };
  const H_SLOTS = [
    { slot: "RB" as const, count: 1, eligiblePositions: ["RB" as const] },
    { slot: "WR" as const, count: 1, eligiblePositions: ["WR" as const] },
    { slot: "BENCH" as const, count: 1, eligiblePositions: ["RB" as const, "WR" as const] },
  ];

  /**
   * A real HELD trade (Alice's RB for Bob's WR), plus its own `trade_hold` flag — the exact state
   * `holdTradeInTx` (`@/league-service/trades`) produces, built directly rather than through a
   * real lopsided `acceptTrade`: this suite holds the trade it wants without also re-proving the
   * threshold math Task 5's own `trades.test.ts` already covers end to end.
   */
  async function heldTradeWithFlag(suffix: string): Promise<{
    readonly leagueId: string;
    readonly teamA: string;
    readonly teamB: string;
    readonly userA: string;
    readonly userB: string;
    readonly tradeId: string;
    readonly flagId: string;
    readonly gavePlayerId: string;
    readonly gotPlayerId: string;
  }> {
    const userA = `u_ht_alice_${suffix}`;
    const userB = `u_ht_bob_${suffix}`;
    await db.insert(users).values([
      { id: userA, email: `${userA}@test.local`, displayName: "Alice" },
      { id: userB, email: `${userB}@test.local`, displayName: "Bob" },
    ]);
    const created = await createLeague({ db, clock: hClock, newId: () => `lg_ht_${suffix}_${crypto.randomUUID()}` }, {
      name: "Held Trade Integration League",
      format: "snake",
      teamCount: 2,
      scoringPreset: "ppr",
      auctionBudget: null,
      rosterSlots: H_SLOTS,
      commissionerUserId: userA,
      teamName: "Team Alice",
      experienceTier: "beginner",
      stakeTier: 0,
      isPublicMatchmade: true,
    });
    if (!created.ok) throw new Error(created.reason);
    const teamB = `team_ht_bob_${suffix}`;
    await db.insert(teams).values({ id: teamB, leagueId: created.leagueId, userId: userB, name: "Team Bob" });
    await db.update(drafts).set({ status: "complete" }).where(eq(drafts.leagueId, created.leagueId));
    const gavePlayerId = `p_ht_rb_${suffix}`;
    const gotPlayerId = `p_ht_wr_${suffix}`;
    await db
      .insert(players)
      .values([
        { id: gavePlayerId, name: "Star RB", position: "RB", nflTeam: "KC" },
        { id: gotPlayerId, name: "Bench WR", position: "WR", nflTeam: "SF" },
      ])
      .onConflictDoNothing();
    await db.insert(rosterSlots).values([
      { teamId: created.teamId, slot: "RB", slotIndex: 0, playerId: gavePlayerId },
      { teamId: teamB, slot: "WR", slotIndex: 0, playerId: gotPlayerId },
    ]);

    const tradeId = `trade_ht_${suffix}`;
    const proposedAt = new Date(hClock.now());
    await db.insert(tradeProposals).values({
      id: tradeId,
      leagueId: created.leagueId,
      proposerTeamId: created.teamId,
      counterpartyTeamId: teamB,
      weekNumber: 1,
      proposerAssets: [{ kind: "player", playerId: gavePlayerId }],
      counterpartyAssets: [{ kind: "player", playerId: gotPlayerId }],
      fingerprint: `fp_${tradeId}`,
      note: null,
      status: "held",
      proposedAt,
      expiresAt: new Date(proposedAt.getTime() + 72 * 60 * 60 * 1000),
    });

    const flagId = `flag_ht_${suffix}`;
    await db.transaction((tx) =>
      raiseFlag(tx, {
        flagType: "trade_hold",
        subjectId: tradeId,
        leagueId: created.leagueId,
        evidence: {},
        raisedByUserId: null,
        occurredAt: hClock.now(),
        newId: () => flagId,
        audit: logger,
      }),
    );

    return { leagueId: created.leagueId, teamA: created.teamId, teamB, userA, userB, tradeId, flagId, gavePlayerId, gotPlayerId };
  }

  async function tradeRow(tradeId: string) {
    const [row] = await db.select().from(tradeProposals).where(eq(tradeProposals.id, tradeId));
    return row!;
  }

  async function ownerTeamOf(playerId: string): Promise<string | undefined> {
    const [row] = await db.select({ teamId: rosterSlots.teamId }).from(rosterSlots).where(eq(rosterSlots.playerId, playerId));
    return row?.teamId;
  }

  async function noticeBody(userId: string, noticeType: string): Promise<string | undefined> {
    const rows = await db.select().from(memberNotices).where(eq(memberNotices.userId, userId));
    return rows.find((n) => n.noticeType === noticeType)?.body;
  }

  async function ensureOperator(id: string): Promise<void> {
    await db.insert(users).values({ id, email: `${id}@test.local`, displayName: id }).onConflictDoNothing();
  }

  it("closes any superseded-hold flags with the default system clock when the caller supplies none", async () => {
    // Every OTHER trade_released test in this suite passes `clock: hClock`, which left this one
    // `??` branch (`(input.clock ?? systemClock).now()` feeding `closeSupersededHoldFlagsQuietly`)
    // uncovered — a production call really can omit `clock` (`@/app/api/admin/flags/[flagId]/
    // resolve/route.ts` never supplies one), and this is that path, proven directly rather than
    // inferred from the equivalent fallback elsewhere in this function.
    await ensureOperator("u_op");
    const fx = await heldTradeWithFlag("default-clock");
    const result = await resolveFlag(db, { flagId: fx.flagId, decision: "trade_released", note: "", operatorUserId: "u_op" });
    expect(result).toMatchObject({ ok: true, flagId: fx.flagId, decision: "trade_released" });
    expect((await tradeRow(fx.tradeId)).status).toBe("accepted");
  });

  it("releases a held trade by executing it, then resolves the flag, in that order", async () => {
    await ensureOperator("u_op");
    const fx = await heldTradeWithFlag("release");
    const result = await resolveFlag(db, { flagId: fx.flagId, decision: "trade_released", note: "", operatorUserId: "u_op", clock: hClock });
    expect(result).toMatchObject({ ok: true, flagId: fx.flagId, decision: "trade_released" });

    expect((await tradeRow(fx.tradeId)).status).toBe("accepted");
    expect(await ownerTeamOf(fx.gavePlayerId)).toBe(fx.teamB);
    expect(await ownerTeamOf(fx.gotPlayerId)).toBe(fx.teamA);
    const aliceExecuted = (await db.select().from(memberNotices).where(eq(memberNotices.userId, fx.userA))).find((n) => n.noticeType === "trade_executed");
    expect(aliceExecuted).toBeDefined();
  });

  it("blocks a held trade without moving anything, and tells both managers in the same words", async () => {
    await ensureOperator("u_op");
    const fx = await heldTradeWithFlag("block");
    const result = await resolveFlag(db, {
      flagId: fx.flagId,
      decision: "trade_blocked",
      note: "Both teams belong to one person.",
      operatorUserId: "u_op",
      clock: hClock,
    });
    expect(result).toMatchObject({ ok: true, flagId: fx.flagId, decision: "trade_blocked" });

    expect((await tradeRow(fx.tradeId)).status).toBe("blocked");
    expect(await ownerTeamOf(fx.gavePlayerId)).toBe(fx.teamA);
    expect(await ownerTeamOf(fx.gotPlayerId)).toBe(fx.teamB);
    const aliceBody = await noticeBody(fx.userA, "trade_blocked");
    const bobBody = await noticeBody(fx.userB, "trade_blocked");
    expect(aliceBody).toBe(bobBody);
    expect(aliceBody).toBeDefined();
  });

  it("refuses to release a trade the world has moved past, and says what changed", async () => {
    await ensureOperator("u_op");
    const fx = await heldTradeWithFlag("moved");
    // The world moves on WITHOUT going through the trade system — a raw write standing in for
    // whatever OTHER mechanism could move it. The supersede sweep already covers the "another
    // trade moved it" case (Task 5's own `trades.test.ts`); this is the second way a release can
    // refuse, the identical ownership re-check `acceptTrade`'s own STEP 4 makes.
    await db.update(rosterSlots).set({ playerId: null }).where(eq(rosterSlots.playerId, fx.gavePlayerId));
    const result = await resolveFlag(db, { flagId: fx.flagId, decision: "trade_released", note: "", operatorUserId: "u_op", clock: hClock });
    expect(result).toMatchObject({ ok: false, status: 409 });
    if (!result.ok) expect(result.reason).toContain("has already moved to another team");
    expect((await tradeRow(fx.tradeId)).status).toBe("held");
    // Nothing about the flag changed either — the refusal happened before this function's own
    // transaction ever opened.
    const [flag] = await db.select({ resolvedAt: integrityFlags.resolvedAt }).from(integrityFlags).where(eq(integrityFlags.id, fx.flagId));
    expect(flag!.resolvedAt).toBeNull();
  });

  it("carries the operator's own words to both managers when a trade is blocked, and refuses an accusatory one before any write", async () => {
    await ensureOperator("u_op");
    const fx = await heldTradeWithFlag("cheat");
    const result = await resolveFlag(db, {
      flagId: fx.flagId,
      decision: "trade_blocked",
      note: "This looks like a violation.",
      operatorUserId: "u_op",
      clock: hClock,
    });
    // The SAME accusatory-note guard `trade_reversed`'s own note already passes through
    // (`NOTE_REACHES_SOMEONE_ELSE.trade_blocked` is `true`) — refused here, at 400, matching the
    // exact status/shape that guard answers with everywhere else in this file.
    expect(result).toMatchObject({ ok: false, status: 400 });
    if (!result.ok) expect(result.reason).toContain("violation");
    // Refused before any write: the trade stays held.
    expect((await tradeRow(fx.tradeId)).status).toBe("held");
  });

  it("refuses trade_released for a subject that isn't a held trade, before any write", async () => {
    await ensureOperator("u_op");
    await seedUser("u_pr_author");
    await db.insert(reviews).values({ id: "review_pr_1", userId: "u_pr_author", rating: 4, body: "meh", createdAt: new Date(NOW), updatedAt: new Date(NOW) });
    const flagId = "flag_pr_wrong_subject";
    await db.transaction((tx) =>
      raiseFlag(tx, { flagType: "review_report", subjectId: "review_pr_1", leagueId: null, evidence: {}, raisedByUserId: null, occurredAt: NOW, newId: () => flagId, audit: logger }),
    );
    const result = await resolveFlag(db, { flagId, decision: "trade_released", note: "n", operatorUserId: "u_op" });
    expect(result).toMatchObject({ ok: false, status: 400 });
  });

  // Plan D, Task 5, fix round 1 (Finding 1) — the operator-cannot-speak-the-system-word refusal,
  // at the ONE layer that matters most: `resolveFlag` itself, the function every write actually
  // goes through (`resolveFlagSchema`'s own refusal, `src/integrity-service/schemas.test.ts`, is
  // the HTTP boundary in front of this; this is the backstop behind it, per `resolveFlag`'s own
  // first statement).
  it("refuses superseded_before_review from an operator, before any write — it is the platform's own word", async () => {
    await ensureOperator("u_op");
    const fx = await heldTradeWithFlag("system-word");
    const result = await resolveFlag(db, { flagId: fx.flagId, decision: "superseded_before_review", note: "n", operatorUserId: "u_op", clock: hClock });
    expect(result).toEqual({ ok: false, status: 400, reason: "This decision is the platform's own, and cannot be chosen by an operator." });
    // Nothing moved and nothing was stamped — the refusal happened before this function's own
    // transaction ever opened, the same "before any write" discipline every other pre-write
    // refusal in this suite keeps.
    expect((await tradeRow(fx.tradeId)).status).toBe("held");
    const [flag] = await db.select({ resolvedAt: integrityFlags.resolvedAt }).from(integrityFlags).where(eq(integrityFlags.id, fx.flagId));
    expect(flag!.resolvedAt).toBeNull();
  });

  it("heals a retry once the release already committed but the flag's own stamp never ran", async () => {
    // Mirrors `reverseTradeInTx`'s own healing-branch test: a process dying between the two
    // transactions leaves the trade genuinely released with the flag still open, and a second
    // attempt on the SAME flag must succeed rather than fail on "no longer held". Simulated
    // directly here — `releaseHeldTradeInTx` is exercised on its own, real and successful,
    // standing in for the first attempt's own execution half having already committed.
    await ensureOperator("u_op");
    const fx = await heldTradeWithFlag("heal");
    const firstAttempt = await db.transaction((tx) =>
      releaseHeldTradeInTx(tx, { tradeId: fx.tradeId, leagueId: fx.leagueId, operatorUserId: "u_op", clock: hClock, audit: logger }),
    );
    expect(firstAttempt).toMatchObject({ ok: true });
    expect((await tradeRow(fx.tradeId)).status).toBe("accepted");
    // The flag itself is still open — this is exactly the gap `resolveFlag`'s own docblock
    // describes: the process died before its own (platform-chain) stamp transaction ever opened.
    const [flagBeforeRetry] = await db.select({ resolvedAt: integrityFlags.resolvedAt }).from(integrityFlags).where(eq(integrityFlags.id, fx.flagId));
    expect(flagBeforeRetry!.resolvedAt).toBeNull();

    const retry = await resolveFlag(db, { flagId: fx.flagId, decision: "trade_released", note: "", operatorUserId: "u_op", clock: hClock });
    expect(retry).toMatchObject({ ok: true, flagId: fx.flagId, decision: "trade_released" });
    const [flagAfterRetry] = await db.select({ resolvedAt: integrityFlags.resolvedAt }).from(integrityFlags).where(eq(integrityFlags.id, fx.flagId));
    expect(flagAfterRetry!.resolvedAt).not.toBeNull();
  });

  it("rolls the whole transaction back, flag stamp included, when the block dispatch itself refuses", async () => {
    // The world moved on WITHOUT going through `resolveFlag` at all — the trade is no longer
    // held by the time the block dispatch runs, even though the flag is still open (a raw write
    // standing in for the crash window `sweepSupersededHoldFlags`, `@/integrity-service/trade-
    // fairness`, exists to re-close; simulated directly here to prove `resolveFlag`'s OWN stamp
    // rolls back with it rather than committing a lie).
    await ensureOperator("u_op");
    const fx = await heldTradeWithFlag("refused");
    await db.update(tradeProposals).set({ status: "accepted", settledAt: new Date(hClock.now()) }).where(eq(tradeProposals.id, fx.tradeId));
    const result = await resolveFlag(db, { flagId: fx.flagId, decision: "trade_blocked", note: "", operatorUserId: "u_op", clock: hClock });
    expect(result).toEqual({ ok: false, status: 409, reason: "This trade is no longer waiting on a decision." });
    // The flag's own stamp UPDATE rolled back too — still open.
    const [flag] = await db.select({ resolvedAt: integrityFlags.resolvedAt }).from(integrityFlags).where(eq(integrityFlags.id, fx.flagId));
    expect(flag!.resolvedAt).toBeNull();
  });

  it("passes a TransferRefusedError from the release's own transaction straight through as a 409", async () => {
    // A slot config with no bench and no flex — releasing a trade that swaps an RB for a WR
    // leaves the receiving side with nowhere legal to put the incoming asset, the identical
    // `TransferRefusedError` `acceptTrade`'s own catch already handles.
    await ensureOperator("u_op");
    const TIGHT_SLOTS = [
      { slot: "RB" as const, count: 1, eligiblePositions: ["RB" as const] },
      { slot: "WR" as const, count: 1, eligiblePositions: ["WR" as const] },
    ];
    const userA = "u_ht_alice_tight";
    const userB = "u_ht_bob_tight";
    await db.insert(users).values([
      { id: userA, email: `${userA}@test.local`, displayName: "Alice" },
      { id: userB, email: `${userB}@test.local`, displayName: "Bob" },
    ]);
    const created = await createLeague({ db, clock: hClock, newId: () => `lg_ht_tight_${crypto.randomUUID()}` }, {
      name: "Tight Slots League",
      format: "snake",
      teamCount: 2,
      scoringPreset: "ppr",
      auctionBudget: null,
      rosterSlots: TIGHT_SLOTS,
      commissionerUserId: userA,
      teamName: "Team Alice",
      experienceTier: "beginner",
      stakeTier: 0,
      isPublicMatchmade: true,
    });
    if (!created.ok) throw new Error(created.reason);
    const teamB = "team_ht_bob_tight";
    await db.insert(teams).values({ id: teamB, leagueId: created.leagueId, userId: userB, name: "Team Bob" });
    await db.update(drafts).set({ status: "complete" }).where(eq(drafts.leagueId, created.leagueId));
    await db
      .insert(players)
      .values([
        { id: "p_ht_rb_tight", name: "Star RB", position: "RB", nflTeam: "KC" },
        { id: "p_ht_wr_tight", name: "Bench WR", position: "WR", nflTeam: "SF" },
        // Each side's OTHER slot is already occupied by a player not in this trade, so the slot
        // the incoming asset would need is genuinely full, not merely empty-and-eligible.
        { id: "p_ht_other_wr", name: "Other WR", position: "WR", nflTeam: "DAL" },
        { id: "p_ht_other_rb", name: "Other RB", position: "RB", nflTeam: "MIA" },
      ])
      .onConflictDoNothing();
    await db.insert(rosterSlots).values([
      { teamId: created.teamId, slot: "RB", slotIndex: 0, playerId: "p_ht_rb_tight" },
      { teamId: created.teamId, slot: "WR", slotIndex: 0, playerId: "p_ht_other_wr" },
      { teamId: teamB, slot: "WR", slotIndex: 0, playerId: "p_ht_wr_tight" },
      { teamId: teamB, slot: "RB", slotIndex: 0, playerId: "p_ht_other_rb" },
    ]);
    const tradeId = "trade_ht_tight";
    const proposedAt = new Date(hClock.now());
    await db.insert(tradeProposals).values({
      id: tradeId,
      leagueId: created.leagueId,
      proposerTeamId: created.teamId,
      counterpartyTeamId: teamB,
      weekNumber: 1,
      proposerAssets: [{ kind: "player", playerId: "p_ht_rb_tight" }],
      counterpartyAssets: [{ kind: "player", playerId: "p_ht_wr_tight" }],
      fingerprint: "fp_trade_ht_tight",
      note: null,
      status: "held",
      proposedAt,
      expiresAt: new Date(proposedAt.getTime() + 72 * 60 * 60 * 1000),
    });
    const flagId = "flag_ht_tight";
    await db.transaction((tx) =>
      raiseFlag(tx, { flagType: "trade_hold", subjectId: tradeId, leagueId: created.leagueId, evidence: {}, raisedByUserId: null, occurredAt: hClock.now(), newId: () => flagId, audit: logger }),
    );

    const result = await resolveFlag(db, { flagId, decision: "trade_released", note: "", operatorUserId: "u_op", clock: hClock });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(409);
    // Nothing moved, and the flag stays open — the whole release transaction rolled back.
    expect((await tradeRow(tradeId)).status).toBe("held");
    const [flag] = await db.select({ resolvedAt: integrityFlags.resolvedAt }).from(integrityFlags).where(eq(integrityFlags.id, flagId));
    expect(flag!.resolvedAt).toBeNull();
  });

  it("logs and swallows a failed score-cache eviction after a release commits, never failing the decision itself", async () => {
    await ensureOperator("u_op");
    const fx = await heldTradeWithFlag("cache-fail");
    const throwingCache = { invalidate: async () => { throw new Error("redis unreachable"); } };
    const result = await resolveFlag(db, { flagId: fx.flagId, decision: "trade_released", note: "", operatorUserId: "u_op", clock: hClock, cache: throwingCache });
    expect(result).toMatchObject({ ok: true, decision: "trade_released" });
    expect((await tradeRow(fx.tradeId)).status).toBe("accepted"); // the release itself still landed
  });

  it("falls through to the ordinary 404 for a flagId that names nothing at all, even for trade_released", async () => {
    await ensureOperator("u_op");
    const result = await resolveFlag(db, { flagId: "flag_rl_ghost", decision: "trade_released", note: "n", operatorUserId: "u_op", clock: hClock });
    expect(result).toEqual({ ok: false, status: 404, reason: 'No flag with id "flag_rl_ghost".' });
  });

  it("re-throws a non-TransferRefusedError from the release's own transaction rather than swallowing it", async () => {
    await ensureOperator("u_op");
    const fx = await heldTradeWithFlag("notify-fails");
    const throwingNotify: typeof notifyAffectedMember = async () => {
      throw new Error("notify exploded");
    };
    await expect(
      resolveFlag(db, { flagId: fx.flagId, decision: "trade_released", note: "", operatorUserId: "u_op", clock: hClock, notify: throwingNotify }),
    ).rejects.toThrow("notify exploded");
    // The whole release transaction rolled back — still held, and nothing this function's own
    // stamp transaction never reached.
    expect((await tradeRow(fx.tradeId)).status).toBe("held");
    const [flag] = await db.select({ resolvedAt: integrityFlags.resolvedAt }).from(integrityFlags).where(eq(integrityFlags.id, fx.flagId));
    expect(flag!.resolvedAt).toBeNull();
  });

  it("carries a held trade's own subject through flagDetail — both managers' standing, both sides valued", async () => {
    const userA = "u_ht_alice_detail";
    const userB = "u_ht_bob_detail";
    await db.insert(users).values([
      { id: userA, email: `${userA}@test.local`, displayName: "Alice" },
      { id: userB, email: `${userB}@test.local`, displayName: "Bob" },
    ]);
    const created = await createLeague({ db, clock: hClock, newId: () => `lg_ht_detail_${crypto.randomUUID()}` }, {
      name: "Held Detail League",
      format: "snake",
      teamCount: 2,
      scoringPreset: "ppr",
      auctionBudget: null,
      rosterSlots: H_SLOTS,
      commissionerUserId: userA,
      teamName: "Team Alice",
      experienceTier: "beginner",
      stakeTier: 0,
      isPublicMatchmade: true,
    });
    if (!created.ok) throw new Error(created.reason);
    const teamB = "team_ht_bob_detail";
    await db.insert(teams).values({ id: teamB, leagueId: created.leagueId, userId: userB, name: "Team Bob" });
    await db.update(drafts).set({ status: "complete" }).where(eq(drafts.leagueId, created.leagueId));
    await db
      .insert(players)
      .values([
        { id: "p_ht_rb_detail", name: "Star RB", position: "RB", nflTeam: "KC" },
        { id: "p_ht_wr_detail", name: "Bench WR", position: "WR", nflTeam: "SF" },
      ])
      .onConflictDoNothing();
    await db.insert(rosterSlots).values([
      { teamId: created.teamId, slot: "RB", slotIndex: 0, playerId: "p_ht_rb_detail" },
      { teamId: teamB, slot: "WR", slotIndex: 0, playerId: "p_ht_wr_detail" },
    ]);
    // A real `member_joined` event for ALICE ONLY — Bob's own `joinedAt` reads honestly as
    // unknown, the same "malformed or missing reads as absent" discipline every other evidence
    // reader in this file holds to.
    await db.transaction((tx) =>
      logger.record(tx, { eventType: "member_joined", actorId: userA, actorType: "user", leagueId: created.leagueId, payload: {}, occurredAt: hClock.now() }),
    );
    const tradeId = "trade_ht_detail";
    const proposedAt = new Date(hClock.now());
    await db.insert(tradeProposals).values({
      id: tradeId,
      leagueId: created.leagueId,
      proposerTeamId: created.teamId,
      counterpartyTeamId: teamB,
      weekNumber: 1,
      proposerAssets: [{ kind: "player", playerId: "p_ht_rb_detail" }],
      counterpartyAssets: [{ kind: "player", playerId: "p_ht_wr_detail" }],
      fingerprint: "fp_trade_ht_detail",
      note: null,
      status: "held",
      proposedAt,
      expiresAt: new Date(proposedAt.getTime() + 72 * 60 * 60 * 1000),
    });
    const flagId = "flag_ht_detail";
    await db.transaction((tx) =>
      raiseFlag(tx, {
        flagType: "trade_hold",
        subjectId: tradeId,
        leagueId: created.leagueId,
        evidence: { verdict: "lopsided", flags: [], givingValue: 40, receivingValue: 5, gap: 35, threshold: 35, basis: "accept_evaluation" },
        raisedByUserId: null,
        occurredAt: hClock.now(),
        newId: () => flagId,
        audit: logger,
      }),
    );

    const detail = await flagDetail(db, flagId);
    expect(detail).not.toBeNull();
    expect(detail!.subject.kind).toBe("held_trade");
    if (detail!.subject.kind === "held_trade") {
      expect(detail!.subject.proposerTeamName).toBe("Team Alice");
      expect(detail!.subject.counterpartyTeamName).toBe("Team Bob");
      expect(detail!.subject.proposerManager.joinedAt).not.toBeNull();
      expect(detail!.subject.counterpartyManager.joinedAt).toBeNull();
      expect(detail!.subject.proposerManager.completedSeasons).toBe(0);
    }

    // Once released, the trail carries a real actor-named row too — `trade_accepted`/
    // `roster_move`, both stamped with the operator's own id — proving `trailFor`'s held_trade
    // branch resolves a real name rather than leaving an id unresolved.
    await db.insert(users).values({ id: "u_op_detail", email: "u_op_detail@test.local", displayName: "Op Detail" }).onConflictDoNothing();
    const released = await resolveFlag(db, { flagId, decision: "trade_released", note: "", operatorUserId: "u_op_detail", clock: hClock });
    expect(released).toMatchObject({ ok: true, decision: "trade_released" });

    const afterRelease = await flagDetail(db, flagId);
    const acceptedRow = afterRelease!.trail.find((row) => row.headline === "Op Detail accepted it.");
    expect(acceptedRow).toBeDefined();
  });

  it("flagDetail reads a SYSTEM resolution honestly — resolvedByName is 'The platform', never a lookup with nothing to find", async () => {
    // Plan D, Task 5, fix round 1 (Finding 1) — the review's own bug trace, proved directly:
    // `closeSupersededHoldFlag` (`@/integrity-service/trade-fairness`) stamps
    // `resolvedByUserId: null`, and this is the read that must recognize that as RESOLVED, with an
    // honest actor, rather than the collision that used to render live Release/Block buttons over
    // an already-superseded trade.
    await ensureOperator("u_op");
    const fx = await heldTradeWithFlag("system-detail");
    await db.update(tradeProposals).set({ status: "superseded" }).where(eq(tradeProposals.id, fx.tradeId));
    const closed = await closeSupersededHoldFlag(db, { tradeId: fx.tradeId, leagueId: fx.leagueId, occurredAt: hClock.now(), audit: logger });
    expect(closed).toBe(true);

    const detail = await flagDetail(db, fx.flagId);
    expect(detail).not.toBeNull();
    expect(detail!.decisions).toEqual([]); // no live decision — nothing left for an operator to choose
    expect(detail!.resolution).toMatchObject({
      decision: "superseded_before_review",
      resolvedByUserId: null,
      resolvedByName: "The platform",
    });
  });

  it("reads a held_trade subject honestly when the named trade row is somehow gone", async () => {
    // Trade rows are never deleted in this product, so this is defensive — the identical
    // "FK-guaranteed, but read honestly anyway" discipline the `trade` branch's own fallback
    // above already keeps.
    await seedUser("u_ht_ghost_commish");
    await seedLeague("lg_ht_ghost", "u_ht_ghost_commish");
    const flagId = "flag_ht_ghost";
    await db.transaction((tx) =>
      raiseFlag(tx, { flagType: "trade_hold", subjectId: "trade_ht_nonexistent", leagueId: "lg_ht_ghost", evidence: {}, raisedByUserId: null, occurredAt: NOW, newId: () => flagId, audit: logger }),
    );
    const detail = await flagDetail(db, flagId);
    expect(detail).not.toBeNull();
    expect(detail!.subject).toMatchObject({
      kind: "held_trade",
      tradeId: "trade_ht_nonexistent",
      proposerTeamName: "A former team",
      counterpartyTeamName: "A former team",
    });
    if (detail!.subject.kind === "held_trade") {
      expect(detail!.subject.proposerManager).toEqual({ userId: "", name: "A former member", joinedAt: null, completedSeasons: 0 });
    }
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
      // Empty evidence predates gap tracking too — fix round 2, F3's own honest fallback.
      fairnessGapSummary: "This flag predates gap tracking, so the number isn't recorded.",
      // No trade row at all — the moved-again read is skipped rather than asked of nothing.
      playersMovedAgain: false,
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
      // Fix round 2, F3: the operator-facing plain-language restatement of `evidence.gap`/
      // `.threshold` — the number that actually raised this flag.
      fairnessGapSummary: "The two sides differ by 60 points per week, at or past the 20-point threshold that raised this flag.",
      // Fix round 1 (LOW, M8 discipline): honestly `true` here — this fixture seeds the trade row
      // directly (`seedAcceptedTrade`), never the real `roster_slots` rows `p_gave`/`p_got` would
      // need to be found on either team, so the same read `reverseTradeInTx` would make finds
      // neither player anywhere and reports the trade unreversible, exactly as it should for a
      // trade this fixture never actually gave either team.
      playersMovedAgain: true,
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
      // Fix round 2, F3: a string `gap` and a non-finite `threshold` both read the same honest
      // "not recorded" way `numberFromEvidence` holds every malformed field to.
      gap: "not a number",
      threshold: Number.POSITIVE_INFINITY,
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
      fairnessGapSummary: "This flag predates gap tracking, so the number isn't recorded.",
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
    // Weeks 1-3 scored, week 4 live: `acceptTrade` derives the week it values at from the league's
    // own schedule (final review, CRITICAL 1), and it is that week's trend window (`ADVISOR_CONFIG
    // .trendWeeks` weeks before it) which makes `p_trail_star`'s monster line price this trade
    // grotesquely lopsided at all.
    await seasonCurrentWeek(db, { leagueId: created.leagueId, homeTeamId: created.teamId, awayTeamId: teamB, week: 4 });
    return { leagueId: created.leagueId, teamA: created.teamId, teamB };
  }

  it("shows an operator the whole propose-to-accept sequence for the flagged trade", async () => {
    const league = await seedLopsidedTradeLeague();

    const proposed = await proposeTrade(db, {
      leagueId: league.leagueId,
      userId: "u_trail_alice",
      counterpartyTeamId: league.teamB,
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
    // plus its two team names, 2, plus fix round 1's own `tradePlayersHaveMovedAgain` roster read,
    // 1 more = 3), `reportersFor` (0 — the trade branch answers synchronously), and `trailFor`'s
    // own claimed two (the trade's own league-chain rows, plus the batched actor-name lookup) = 6.
    const counted = countingDb(db);
    const detail = await flagDetail(counted.db, flagRow!.id);
    expect(counted.selectCount()).toBeLessThanOrEqual(6);
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

/**
 * Plan D, Task 8 step 2: the commissioner's own window onto platform moderation in their league.
 * Plan B's Task 6 persona panel raised it as a MEDIUM and ruled it out of its own scope by name —
 * see `leagueModerationSummary`'s own docblock for the exact ruling. Every test here builds its
 * own league from scratch rather than sharing one across `it` blocks, so a count in one test can
 * never be a fixture another test half-seeded.
 */
describe("leagueModerationSummary", () => {
  // Every fixture's own remover, seeded once per test — `beforeEach` at the top of this file
  // already truncated everything, so one seed per test is enough even for the tests that build
  // more than one league (`seedLeagueWith` no longer seeds it, to stay safe against being called
  // twice in one test).
  beforeEach(async () => {
    await seedUser("u_mod_operator", true);
  });

  async function seedLeagueWith(leagueId: string, commissionerUserId: string, memberUserIds: readonly string[] = []): Promise<void> {
    await seedUser(commissionerUserId);
    await seedLeague(leagueId, commissionerUserId);
    for (const userId of memberUserIds) {
      await seedUser(userId);
      await db.insert(teams).values({ id: `${leagueId}_${userId}_team`, leagueId, userId, name: userId });
    }
  }

  /** A chat message in `leagueId`, removed at `removedAt` (or never, if omitted). Every caller
   *  goes through `seedLeagueWith` first, which seeds the operator this stamps as the remover. */
  async function seedChatMessage(leagueId: string, authorUserId: string, opts: { readonly removedAt?: string } = {}): Promise<void> {
    const [message] = await db.insert(chatMessages).values({ leagueId, authorUserId, body: "message body" }).returning({ id: chatMessages.id });
    if (opts.removedAt !== undefined) {
      await db
        .update(chatMessages)
        .set({ removedAt: new Date(opts.removedAt), removedByUserId: "u_mod_operator", removalReason: "spam" })
        .where(eq(chatMessages.id, message!.id));
    }
  }

  /** A review by `authorUserId` (a real, platform-scoped review — no `leagueId` of its own),
   *  removed at `removedAt` (or never, if omitted). Every caller goes through `seedLeagueWith`
   *  first, which seeds the operator this stamps as the remover. */
  async function seedReview(id: string, authorUserId: string, opts: { readonly removedAt?: string } = {}): Promise<void> {
    await db.insert(reviews).values({ id, userId: authorUserId, rating: 3, body: `review body ${id}`, createdAt: new Date(NOW), updatedAt: new Date(NOW) });
    if (opts.removedAt !== undefined) {
      await db
        .update(reviews)
        .set({ removedAt: new Date(opts.removedAt), removedByUserId: "u_mod_operator", removalReason: "spam" })
        .where(eq(reviews.id, id));
    }
  }

  async function seedOpenFlag(leagueId: string, subjectId: string): Promise<void> {
    await db.transaction((tx) =>
      raiseFlag(tx, {
        flagType: "chat_report",
        subjectId,
        leagueId,
        evidence: {},
        raisedByUserId: null,
        occurredAt: NOW,
        newId: () => `flag_mod_${subjectId}`,
        audit: logger,
      }),
    );
  }

  it("tells the commissioner how many messages and reviews the platform removed in their league, and when", async () => {
    await seedLeagueWith("lg_mod_1", "u_mod_commish", ["u_mod_bob"]);
    await seedChatMessage("lg_mod_1", "u_mod_bob", { removedAt: "2026-08-18T09:00:00.000Z" });
    await seedChatMessage("lg_mod_1", "u_mod_bob", { removedAt: "2026-08-19T14:02:00.000Z" });
    await seedChatMessage("lg_mod_1", "u_mod_bob"); // never removed — not counted
    await seedOpenFlag("lg_mod_1", "some_subject");

    expect(await leagueModerationSummary(db, { leagueId: "lg_mod_1", userId: "u_mod_commish" })).toEqual({
      removedMessages: 2,
      removedReviews: 0,
      mostRecentAt: "2026-08-19T14:02:00.000Z",
      openQuestions: 1,
    });
  });

  it("never names who was moderated, what they said, or why", async () => {
    // The boundary. A commissioner is a member with extra buttons, not an operator: Plan B's
    // founder decision #3 shipped "operator only" for removal and this does not reopen it. The
    // removal reason reaches the author's own notice and nobody else (Plan B's wire-level HIGH),
    // and a count is what tells a commissioner their league is being looked after without
    // publishing a member's worst afternoon to the person who runs their league.
    await seedLeagueWith("lg_mod_2", "u_mod_commish2", ["u_bob"]);
    await seedChatMessage("lg_mod_2", "u_bob", { removedAt: "2026-08-18T09:00:00.000Z" });
    await db.update(chatMessages).set({ removalReason: "harassed another manager" }).where(eq(chatMessages.leagueId, "lg_mod_2"));

    const summary = await leagueModerationSummary(db, { leagueId: "lg_mod_2", userId: "u_mod_commish2" });
    expect(JSON.stringify(summary)).not.toContain("u_bob");
    expect(JSON.stringify(summary)).not.toContain("harassed");
    expect(Object.keys(summary!)).toEqual([...MODERATION_SUMMARY_FIELDS]);
  });

  it("answers null (the route's 404) to an ordinary member of the same league", async () => {
    await seedLeagueWith("lg_mod_3", "u_mod_commish3", ["u_mod_ordinary"]);
    expect(await leagueModerationSummary(db, { leagueId: "lg_mod_3", userId: "u_mod_ordinary" })).toBeNull();
  });

  it("answers null for a league that doesn't exist, the identical shape a non-commissioner gets", async () => {
    await seedUser("u_mod_nobody");
    expect(await leagueModerationSummary(db, { leagueId: "lg_mod_ghost", userId: "u_mod_nobody" })).toBeNull();
  });

  it("counts open questions without saying what they are about", async () => {
    // `openQuestions` is the number of unresolved `integrity_flags` scoped to this league. It is
    // a count and never a list, for the identical reason: an open flag is a question about a
    // person and `ACTIVITY_VISIBILITY.flag_raised` is `hidden` on that basis. What the
    // commissioner gains is the knowledge that something is in hand, which is the entire
    // complaint the panel raised.
    await seedLeagueWith("lg_mod_4", "u_mod_commish4");
    await seedOpenFlag("lg_mod_4", "subject_a");
    await seedOpenFlag("lg_mod_4", "subject_b");
    await seedOpenFlag("lg_mod_4", "subject_c");

    expect((await leagueModerationSummary(db, { leagueId: "lg_mod_4", userId: "u_mod_commish4" }))!.openQuestions).toBe(3);
  });

  it("never counts a resolved flag as an open question", async () => {
    await seedLeagueWith("lg_mod_5", "u_mod_commish5");
    await seedOpenFlag("lg_mod_5", "subject_resolved");
    await db.update(integrityFlags).set({ resolvedAt: new Date(NOW), resolvedByUserId: "u_mod_commish5", resolution: "no_action", resolutionNote: "n" }).where(eq(integrityFlags.leagueId, "lg_mod_5"));

    expect((await leagueModerationSummary(db, { leagueId: "lg_mod_5", userId: "u_mod_commish5" }))!.openQuestions).toBe(0);
  });

  it("never counts an open flag raised against a DIFFERENT league", async () => {
    await seedLeagueWith("lg_mod_6", "u_mod_commish6");
    await seedLeagueWith("lg_mod_6_other", "u_mod_commish6_other");
    await seedOpenFlag("lg_mod_6_other", "subject_elsewhere");

    expect((await leagueModerationSummary(db, { leagueId: "lg_mod_6", userId: "u_mod_commish6" }))!.openQuestions).toBe(0);
  });

  it("counts a removed review authored by a member of this league, and reads 'in their league' by membership since reviews carry no league id of their own", async () => {
    // `reviews.user_id` is UNIQUE (one review per account, ever — `reviews_user_idx`), so proving
    // "the live one is not counted" needs a SECOND league member, not a second review from the
    // one who was removed.
    await seedLeagueWith("lg_mod_7", "u_mod_commish7", ["u_mod_reviewer", "u_mod_live_reviewer"]);
    await seedReview("r_mod_1", "u_mod_reviewer", { removedAt: "2026-08-10T00:00:00.000Z" });
    await seedReview("r_mod_2", "u_mod_live_reviewer"); // live — not counted

    const summary = await leagueModerationSummary(db, { leagueId: "lg_mod_7", userId: "u_mod_commish7" });
    expect(summary).toMatchObject({ removedReviews: 1, mostRecentAt: "2026-08-10T00:00:00.000Z" });
  });

  it("never counts a removed review from someone who has never fielded a team in this league", async () => {
    await seedLeagueWith("lg_mod_8", "u_mod_commish8");
    await seedUser("u_mod_stranger");
    await seedReview("r_mod_stranger", "u_mod_stranger", { removedAt: "2026-08-10T00:00:00.000Z" });

    const summary = await leagueModerationSummary(db, { leagueId: "lg_mod_8", userId: "u_mod_commish8" });
    expect(summary).toMatchObject({ removedReviews: 0, mostRecentAt: null });
  });

  it("reports the later of a removed message and a removed review as mostRecentAt — the review wins", async () => {
    await seedLeagueWith("lg_mod_9", "u_mod_commish9", ["u_mod_member9"]);
    await seedChatMessage("lg_mod_9", "u_mod_member9", { removedAt: "2026-08-01T00:00:00.000Z" });
    await seedReview("r_mod_9", "u_mod_member9", { removedAt: "2026-08-15T00:00:00.000Z" });

    const summary = await leagueModerationSummary(db, { leagueId: "lg_mod_9", userId: "u_mod_commish9" });
    expect(summary).toMatchObject({ removedMessages: 1, removedReviews: 1, mostRecentAt: "2026-08-15T00:00:00.000Z" });
  });

  it("reports the later of a removed message and a removed review as mostRecentAt — the message wins", async () => {
    // `laterOf`'s own other branch — a removed chat message strictly newer than a removed
    // review, so this is not the same comparison outcome as the test just above.
    await seedLeagueWith("lg_mod_9b", "u_mod_commish9b", ["u_mod_member9b"]);
    await seedChatMessage("lg_mod_9b", "u_mod_member9b", { removedAt: "2026-08-20T00:00:00.000Z" });
    await seedReview("r_mod_9b", "u_mod_member9b", { removedAt: "2026-08-05T00:00:00.000Z" });

    const summary = await leagueModerationSummary(db, { leagueId: "lg_mod_9b", userId: "u_mod_commish9b" });
    expect(summary).toMatchObject({ removedMessages: 1, removedReviews: 1, mostRecentAt: "2026-08-20T00:00:00.000Z" });
  });

  it("reports null for mostRecentAt on a healthy league — nothing has ever needed attention", async () => {
    await seedLeagueWith("lg_mod_10", "u_mod_commish10", ["u_mod_member10"]);
    await seedChatMessage("lg_mod_10", "u_mod_member10"); // live — not counted

    expect(await leagueModerationSummary(db, { leagueId: "lg_mod_10", userId: "u_mod_commish10" })).toEqual({
      removedMessages: 0,
      removedReviews: 0,
      mostRecentAt: null,
      openQuestions: 0,
    });
  });

  it("costs a small, constant number of queries regardless of how much this league's own history holds", async () => {
    await seedLeagueWith("lg_mod_11", "u_mod_commish11", ["u_mod_member11"]);
    for (let i = 0; i < 8; i += 1) {
      await seedChatMessage("lg_mod_11", "u_mod_member11", { removedAt: `2026-08-0${(i % 9) + 1}T00:00:00.000Z` });
    }
    await seedOpenFlag("lg_mod_11", "subject_bounded");

    const counting = countingDb(db);
    await leagueModerationSummary(counting.db, { leagueId: "lg_mod_11", userId: "u_mod_commish11" });
    // The commissioner lookup, plus the three bounded counts (messages, reviews, open flags) —
    // never one query per removed row, and never a query whose cost scales with the PLATFORM's
    // own history rather than this league's own.
    expect(counting.selectCount()).toBe(4);
  });
});
