import { and, asc, eq } from "drizzle-orm";
import { describe, expect, it, beforeEach, afterAll, vi } from "vitest";
import { createDb } from "@research-ts/db/client";
import { DB_POOL_CONFIG } from "@research-ts/db/config";
import { createTestDb, TEST_DATABASE_URL } from "@research-ts/db/test-db";
import { truncateAll } from "@/db/test-db";
import { players } from "@research-ts/db/schema";
import { auditEvents, drafts, draftActions, memberNotices } from "@/db/schema";
import { activityRowFor } from "@/integrity/activity-view";
import { INTEGRITY_CONFIG } from "@/integrity/config";
import { copyViolations } from "@/integrity/copy-rules";
import type { AuditEvent, AuditEventInput } from "@/domain/audit";
import { getAuditLogger, type AuditLogger } from "@/integrity-service/audit-logger";
import type { MemberNotice } from "@/integrity-service/notify";
import { ROLL_CADENCE_HOURS } from "@/matchmaking/config";
import { autoStartDueDrafts, claimAutoStart } from "./auto-start";
import { createDraftStore, DRAFT_AUTO_STARTED_SUMMARY, type DraftStore } from "./store";
import { seedDraftFixture, SPRINT_ROSTER_SLOTS } from "./test-support";

const db = createTestDb();
let now = "2026-09-10T17:00:00.000Z";
const clock = { now: () => now };
const MINUTE_AGO = "2026-09-10T16:59:00.000Z";
const WEEK_AGO = "2026-09-03T17:00:00.000Z";
const IN_AN_HOUR = "2026-09-10T18:00:00.000Z";

function plusHours(iso: string, hours: number): string {
  return new Date(Date.parse(iso) + hours * 60 * 60 * 1000).toISOString();
}

const POOL = [
  { id: "qb1", name: "QB One", position: "QB", nflTeam: "KC" },
  { id: "rb1", name: "RB One", position: "RB", nflTeam: "SF" },
  { id: "wr1", name: "WR One", position: "WR", nflTeam: "NYJ" },
  { id: "qb2", name: "QB Two", position: "QB", nflTeam: "KC" },
  { id: "rb2", name: "RB Two", position: "RB", nflTeam: "SF" },
  { id: "wr2", name: "WR Two", position: "WR", nflTeam: "NYJ" },
] as const;

function newStore(): DraftStore {
  return createDraftStore({ db, publish: async () => "1-0", clock, deliverNotice: async () => {} });
}

beforeEach(async () => {
  await truncateAll(db);
  now = "2026-09-10T17:00:00.000Z";
});

afterAll(async () => {
  await truncateAll(db);
});

async function draftStatus(draftId: string): Promise<string | undefined> {
  const [row] = await db.select({ status: drafts.status }).from(drafts).where(eq(drafts.id, draftId));
  return row?.status;
}

async function kickoffOfAuto(draftId: string): Promise<string | undefined> {
  const [row] = await db.select({ kickoffAt: drafts.kickoffAt }).from(drafts).where(eq(drafts.id, draftId));
  return row?.kickoffAt.toISOString();
}

async function startDraftActionCount(draftId: string): Promise<number> {
  const rows = await db.select().from(draftActions).where(eq(draftActions.draftId, draftId)).orderBy(asc(draftActions.sequence));
  return rows.filter((row) => (row.action as { type: string }).type === "START_DRAFT").length;
}

async function seededDraft(input: {
  readonly kickoffAt: string;
  readonly isPublicMatchmade: boolean;
  readonly teamCount: number;
  readonly filledTeams?: number;
  readonly startTrigger?: "scheduled" | "when_full";
}) {
  const fixture = await seedDraftFixture(db, {
    draftId: "draft_auto",
    leagueId: "league_auto",
    format: "snake",
    teamCount: input.teamCount,
    filledTeams: input.filledTeams,
    startTrigger: input.startTrigger,
    slotConfig: SPRINT_ROSTER_SLOTS,
    kickoffAt: new Date(input.kickoffAt),
    auctionBudget: null,
    isPublicMatchmade: input.isPublicMatchmade,
  });
  if (input.teamCount > 0) await db.insert(players).values([...POOL]);
  return fixture;
}

/** Flips `INTEGRITY_CONFIG.participation.enforceTierSegregation` for one call — the SAME switch
 *  `enforcementAppliesTo` reads, mirroring `auto-lineup.test.ts`'s own `withEnforcementOff`. */
async function withEnforcementOff<T>(fn: () => Promise<T>): Promise<T> {
  const config = INTEGRITY_CONFIG.participation as { enforceTierSegregation: boolean };
  const original = config.enforceTierSegregation;
  config.enforceTierSegregation = false;
  try {
    return await fn();
  } finally {
    config.enforceTierSegregation = original;
  }
}

describe("autoStartDueDrafts", () => {
  // THE BUG THIS TASK EXISTS FOR (Phase 3.6, Task 7 — the founder's "roll until full" ruling).
  // `dueDraftsQuery` had no seat predicate and `store.startDraft` only requires two teams, so a
  // 3-of-12 public league whose kickoff passed drafted with three teams on `main`. The ruling is
  // absolute for the door the platform owns: this league is rolled, not started.
  it("does not start a public draft whose room is not full, however late it is", async () => {
    const { draftId } = await seededDraft({ kickoffAt: MINUTE_AGO, isPublicMatchmade: true, teamCount: 12, filledTeams: 3 });
    expect(await autoStartDueDrafts(db, { store: newStore(), clock })).toEqual([
      { draftId, started: false, rolled: true, kickoffAt: plusHours(MINUTE_AGO, ROLL_CADENCE_HOURS) },
    ]);
    expect(await draftStatus(draftId)).toBe("scheduled");
  });

  it("starts a full room at its scheduled time, exactly as it does today", async () => {
    // `teamCount: 2` (fully filled) rather than a literal 12: `POOL` below is sized for a 2-team
    // draft, and the point of this test is the room-is-full branch, not roster fixturing.
    const { draftId } = await seededDraft({ kickoffAt: MINUTE_AGO, isPublicMatchmade: true, teamCount: 2, filledTeams: 2 });
    expect(await autoStartDueDrafts(db, { store: newStore(), clock })).toEqual([{ draftId, started: true }]);
  });

  // Step 3's own exemption: a `when_full` draft has no chosen time to be late for until it
  // fills, so a due-but-unfilled one is never rolled — its far-future placeholder kickoff
  // (`kickoffFor`, `@/league-service/house-factory`) is not a time anybody planned around.
  it("never rolls a when_full draft's placeholder kickoff, even if it somehow became due unfilled", async () => {
    const { draftId } = await seededDraft({
      kickoffAt: MINUTE_AGO,
      isPublicMatchmade: true,
      teamCount: 12,
      filledTeams: 3,
      startTrigger: "when_full",
    });
    expect(await autoStartDueDrafts(db, { store: newStore(), clock })).toEqual([]);
    expect(await draftStatus(draftId)).toBe("scheduled");
    expect(await kickoffOfAuto(draftId)).toBe(MINUTE_AGO);
  });

  it("starts a public matchmade draft whose kickoff has passed", async () => {
    const { draftId } = await seededDraft({ kickoffAt: MINUTE_AGO, isPublicMatchmade: true, teamCount: 2 });
    const outcomes = await autoStartDueDrafts(db, { store: newStore(), clock });
    expect(outcomes).toEqual([{ draftId, started: true }]);
    expect(await draftStatus(draftId)).toBe("in_progress");
  });

  it("leaves a private league's draft for its commissioner, however late they are", async () => {
    // The scheduling half's matched pair (Task 6): a private league trusts a friend, and a
    // platform that starts their draft for them has taken the decision away.
    const { draftId } = await seededDraft({ kickoffAt: WEEK_AGO, isPublicMatchmade: false, teamCount: 2 });
    expect(await autoStartDueDrafts(db, { store: newStore(), clock })).toEqual([]);
    expect(await draftStatus(draftId)).toBe("scheduled");
  });

  it("does not start a draft whose kickoff is still ahead", async () => {
    const { draftId } = await seededDraft({ kickoffAt: IN_AN_HOUR, isPublicMatchmade: true, teamCount: 2 });
    expect(await autoStartDueDrafts(db, { store: newStore(), clock })).toEqual([]);
    expect(await draftStatus(draftId)).toBe("scheduled");
  });

  it("refuses to start a league that cannot draft, and says which, rather than throwing", async () => {
    // One seat filled. `store.startDraft` builds an order from the team rows, and a one-team
    // draft is a draft nobody can lose. The refusal is store.startDraft's own reducer message,
    // reported as an outcome and re-tried on the next tick, never an exception that stops the
    // scan for every other league.
    const { draftId } = await seededDraft({ kickoffAt: MINUTE_AGO, isPublicMatchmade: true, teamCount: 1 });
    expect(await autoStartDueDrafts(db, { store: newStore(), clock })).toEqual([
      { draftId, started: false, reason: "A draft needs at least two teams." },
    ]);
    expect(await draftStatus(draftId)).toBe("scheduled");
  });

  it("catches a real thrown error from store.startDraft, reports it, and never stops the scan", async () => {
    // Distinct from the "cannot draft" case above, which is `store.startDraft` returning a clean
    // `{ ok: false }` — this is `store.startDraft` REJECTING (a dropped connection, in production),
    // which must be caught here rather than left to crash `autoStartDueDrafts` for every other due
    // league scanned in the same tick.
    const { draftId } = await seededDraft({ kickoffAt: MINUTE_AGO, isPublicMatchmade: true, teamCount: 2 });
    const throwingStore: DraftStore = {
      ...newStore(),
      startDraft: async () => {
        throw new Error("connection reset by peer");
      },
    };
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(await autoStartDueDrafts(db, { store: throwingStore, clock })).toEqual([
        { draftId, started: false, reason: "Something went wrong starting this draft." },
      ]);
      expect(errorSpy).toHaveBeenCalledWith("[draft] auto-start failed for draft", draftId, expect.any(Error));
    } finally {
      errorSpy.mockRestore();
    }
    // Never claimed: the throw happened before `claimAutoStart` could ever run, so the draft is
    // still `scheduled` and will be retried on the next tick.
    expect(await draftStatus(draftId)).toBe("scheduled");
  });

  it("starts exactly once when two instances scan the same due draft at the same moment", async () => {
    await seededDraft({ kickoffAt: MINUTE_AGO, isPublicMatchmade: true, teamCount: 2 });

    function instance() {
      const instanceDb = createDb(TEST_DATABASE_URL, { max: DB_POOL_CONFIG.testMaxConnections, idleTimeoutSeconds: DB_POOL_CONFIG.testIdleTimeoutSeconds });
      const store = createDraftStore({ db: instanceDb, publish: async () => null, clock, deliverNotice: async () => {} });
      return { db: instanceDb, store };
    }
    const a = instance();
    const b = instance();

    try {
      const [resultA, resultB] = await Promise.all([
        autoStartDueDrafts(a.db, { store: a.store, clock }),
        autoStartDueDrafts(b.db, { store: b.store, clock }),
      ]);
      expect([resultA, resultB].flat().filter((outcome) => outcome.started)).toHaveLength(1);
      expect(await startDraftActionCount("draft_auto")).toBe(1);
    } finally {
      await a.db.$client.end();
      await b.db.$client.end();
    }
  });

  it("does nothing at all while enforcement is off", async () => {
    const { draftId } = await seededDraft({ kickoffAt: MINUTE_AGO, isPublicMatchmade: true, teamCount: 2 });
    await withEnforcementOff(async () => {
      expect(await autoStartDueDrafts(db, { store: newStore(), clock })).toEqual([]);
    });
    expect(await draftStatus(draftId)).toBe("scheduled");
    expect(await startDraftActionCount(draftId)).toBe(0);
  });

  it("sends every team owner a league-wide notice, all naming the same system_action event", async () => {
    const { draftId, userIds } = await seededDraft({ kickoffAt: MINUTE_AGO, isPublicMatchmade: true, teamCount: 3 });
    // 3 teams x 3 roster slots each needs 9+ players in the pool — the 6-player POOL above only
    // covers a 2-team draft, so this test tops it up.
    await db.insert(players).values([
      { id: "qb3", name: "QB Three", position: "QB", nflTeam: "DAL" },
      { id: "rb3", name: "RB Three", position: "RB", nflTeam: "DAL" },
      { id: "wr3", name: "WR Three", position: "WR", nflTeam: "DAL" },
    ]);
    // The announcement's own delivery now rides the STORE's own `deliverNotice` — it is fused
    // into `startDraft`'s transaction (fix round 1, F1), not a second caller-supplied `deliver`.
    const announced: MemberNotice[] = [];
    const store = createDraftStore({ db, publish: async () => "1-0", clock, deliverNotice: async (n) => void announced.push(n) });
    await autoStartDueDrafts(db, { store, clock });
    expect(await draftStatus(draftId)).toBe("in_progress");

    const notices = await db.select().from(memberNotices).where(eq(memberNotices.noticeType, "draft_auto_started"));
    expect(notices).toHaveLength(3);
    expect(notices.map((n) => n.userId).sort()).toEqual([...userIds].sort());
    const eventIds = new Set(notices.map((n) => n.auditEventId));
    expect(eventIds.size).toBe(1);
    expect([...eventIds][0]).not.toBeNull();
    for (const notice of notices) {
      expect(notice.title).toBe("Your draft in league_auto has started");
      expect(notice.leagueId).toBe("league_auto");
    }
    // Best-effort live delivery, after the commit.
    expect(announced).toHaveLength(3);

    // FINAL REVIEW F7: the league-wide `system_action` this same transaction writes carries a
    // real summary, and therefore RENDERS. Before the fix it carried none, so
    // `renderSystemAction` answered `null` for every viewer and the event was written, read and
    // discarded — a code granted `"everyone"` that nobody could ever see.
    const [event] = await db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.eventType, "system_action"), eq(auditEvents.chainScope, "league_auto")));
    expect(event!.payload).toMatchObject({ action: "draft_auto_started", summary: DRAFT_AUTO_STARTED_SUMMARY });
    const row = activityRowFor(
      { ...event!, occurredAt: event!.occurredAt.toISOString() } as unknown as Parameters<typeof activityRowFor>[0],
      { userId: userIds[0]! },
      { member: () => "A member", player: () => "A player", team: () => "A team" },
    );
    expect(row).not.toBeNull();
    expect(row!.headline).toBe(DRAFT_AUTO_STARTED_SUMMARY);
    expect(copyViolations(DRAFT_AUTO_STARTED_SUMMARY)).toEqual([]);
  });

  it("is idempotent: a re-tick after a successful start does nothing further", async () => {
    const { draftId } = await seededDraft({ kickoffAt: MINUTE_AGO, isPublicMatchmade: true, teamCount: 2 });
    const store = newStore();
    expect(await autoStartDueDrafts(db, { store, clock })).toEqual([{ draftId, started: true }]);
    // The scan no longer finds it (status is no longer 'scheduled'), so a second tick is a no-op.
    expect(await autoStartDueDrafts(db, { store, clock })).toEqual([]);
    expect(await startDraftActionCount(draftId)).toBe(1);
    const notices = await db.select().from(memberNotices).where(eq(memberNotices.noticeType, "draft_auto_started"));
    expect(notices).toHaveLength(2); // one per team, never doubled
  });
});

describe("claimAutoStart", () => {
  it("claims a scheduled draft, flipping it to in_progress", async () => {
    const { draftId } = await seededDraft({ kickoffAt: MINUTE_AGO, isPublicMatchmade: true, teamCount: 2 });
    const claimed = await db.transaction((tx) => claimAutoStart(tx, draftId));
    expect(claimed).toBe(true);
    expect(await draftStatus(draftId)).toBe("in_progress");
  });

  it("returns false for a draft that is not scheduled, and touches nothing", async () => {
    const { draftId } = await seededDraft({ kickoffAt: MINUTE_AGO, isPublicMatchmade: true, teamCount: 2 });
    await db.update(drafts).set({ status: "in_progress" }).where(eq(drafts.id, draftId));
    const claimed = await db.transaction((tx) => claimAutoStart(tx, draftId));
    expect(claimed).toBe(false);
    expect(await draftStatus(draftId)).toBe("in_progress");
  });

  it("returns false for a draft id that does not exist", async () => {
    const claimed = await db.transaction((tx) => claimAutoStart(tx, "nope"));
    expect(claimed).toBe(false);
  });
});

/**
 * FIX ROUND 1, F1/F2: the announcement is fused into `startDraft`'s own transaction, so an
 * announce-side failure is no longer a separate post-commit step that can leave a started draft
 * unannounced — it is a failure INSIDE the one transaction that also claims the draft and appends
 * `START_DRAFT`, so the whole thing rolls back. These tests inject that failure for real (a
 * throwing `AuditLogger`, the exact write `startDraft`'s fused announcement makes its own anchor
 * through) rather than assert the property by inspection.
 */
describe("a failure in the fused announcement rolls back the whole start (fix round 1, F1/F2)", () => {
  /** Fails only the auto-start announcement's own `system_action` write — every other audit
   *  call (there are none, for a fresh START_DRAFT) would pass through untouched. */
  function auditThatFailsAnnouncements(): AuditLogger {
    const real = getAuditLogger();
    return {
      recordAll: (tx, inputs) => real.recordAll(tx, inputs),
      record: async (tx, input: AuditEventInput): Promise<AuditEvent> => {
        if (input.eventType === "system_action" && (input.payload as { action?: string }).action === "draft_auto_started") {
          throw new Error("audit chain unreachable");
        }
        return real.record(tx, input);
      },
    };
  }

  it("store.startDraft(draftId, { auto: true }) itself rejects, and claims nothing", async () => {
    const { draftId } = await seededDraft({ kickoffAt: MINUTE_AGO, isPublicMatchmade: true, teamCount: 2 });
    const store = createDraftStore({ db, publish: async () => "1-0", clock, audit: auditThatFailsAnnouncements(), deliverNotice: async () => {} });

    await expect(store.startDraft(draftId, { auto: true })).rejects.toThrow("audit chain unreachable");

    // The WHOLE transaction rolled back: the claim, the START_DRAFT append and the notices
    // that were about to be minted are all gone — not merely the anchor write that threw.
    expect(await draftStatus(draftId)).toBe("scheduled");
    expect(await startDraftActionCount(draftId)).toBe(0);
    expect(await db.select().from(memberNotices).where(eq(memberNotices.noticeType, "draft_auto_started"))).toEqual([]);
  });

  it("autoStartDueDrafts reports it honestly, and the draft is genuinely retryable — the docblock's claim, proven rather than assumed", async () => {
    const { draftId } = await seededDraft({ kickoffAt: MINUTE_AGO, isPublicMatchmade: true, teamCount: 2 });
    const store = createDraftStore({ db, publish: async () => "1-0", clock, audit: auditThatFailsAnnouncements(), deliverNotice: async () => {} });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    let outcomes: readonly { draftId: string; started: boolean; reason?: string }[];
    try {
      outcomes = await autoStartDueDrafts(db, { store, clock });
    } finally {
      errorSpy.mockRestore();
    }
    expect(outcomes).toEqual([{ draftId, started: false, reason: "Something went wrong starting this draft." }]);
    // The outcome's own claim is now true, not just plausible: status really did stay scheduled.
    expect(await draftStatus(draftId)).toBe("scheduled");

    // Genuinely retryable: a second tick, with a healthy audit logger, starts it cleanly.
    const healthyStore = createDraftStore({ db, publish: async () => "1-0", clock, deliverNotice: async () => {} });
    expect(await autoStartDueDrafts(db, { store: healthyStore, clock })).toEqual([{ draftId, started: true }]);
    expect(await draftStatus(draftId)).toBe("in_progress");
  });
});
