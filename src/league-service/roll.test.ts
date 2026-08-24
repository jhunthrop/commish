import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { and, eq } from "drizzle-orm";
import { createDb } from "@/db/client";
import { DB_POOL_CONFIG } from "@/db/config";
import { createTestDb, truncateAll, TEST_DATABASE_URL } from "@/db/test-db";
import { auditEvents, drafts, memberNotices, users } from "@/db/schema";
import { INTEGRITY_CONFIG } from "@/integrity/config";
import { ROLL_CADENCE_HOURS } from "@/matchmaking/config";
import { ROLL_REFUSALS } from "@/matchmaking/roll";
import { createLeague } from "./creation";
import { joinPublicLeague } from "./join";
import { ensureHouseCatalog } from "./house-factory";
import { rollDueDrafts, rollUnfilledDraftInTx, DRAFT_KICKOFF_ROLLED_SUMMARY } from "./roll";

const db = createTestDb();
const FIXED_NOW = "2026-09-10T17:00:00.000Z";
const ORIGINAL_KICKOFF = "2026-09-10T16:59:00.000Z"; // one minute before FIXED_NOW: due
const clock = { now: () => FIXED_NOW };
let nextId = 0;
const newId = () => `id_${++nextId}`;

function plusHours(iso: string, hours: number): string {
  return new Date(Date.parse(iso) + hours * 60 * 60 * 1000).toISOString();
}

async function draftRow(leagueId: string) {
  const [row] = await db.select().from(drafts).where(eq(drafts.leagueId, leagueId));
  if (row === undefined) throw new Error("no draft for that league");
  return row;
}

async function noticesOf(leagueId: string, noticeType: string) {
  return db.select().from(memberNotices).where(and(eq(memberNotices.leagueId, leagueId), eq(memberNotices.noticeType, noticeType)));
}

/** A public matchmade league whose draft is already DUE — the fixture every test in this file
 *  builds on. `filled` seats the commissioner plus `filled - 1` more joiners, leaving
 *  `teamCount - filled` seats open. */
async function seedDueLeague(input: {
  readonly teamCount: number;
  readonly filled: number;
  readonly startTrigger?: "scheduled" | "when_full";
  readonly kickoffAt?: string;
}): Promise<{ readonly leagueId: string; readonly draftId: string; readonly userIds: readonly string[] }> {
  await db.insert(users).values({ id: "commish", email: "commish@test.local", displayName: "Commish" }).onConflictDoNothing();
  const created = await createLeague(
    { db, clock, newId },
    {
      name: "Roll League",
      format: "snake",
      teamCount: input.teamCount,
      scoringPreset: "ppr",
      auctionBudget: null,
      owner: { kind: "member", userId: "commish", teamName: "Commish's Team" },
      experienceTier: "beginner",
      stakeTier: 0,
      isPublicMatchmade: true,
      startTrigger: input.startTrigger ?? "scheduled",
      kickoffAt: input.kickoffAt ?? ORIGINAL_KICKOFF,
    },
  );
  if (!created.ok) throw new Error(created.reason);
  const userIds = ["commish"];
  for (let i = 1; i < input.filled; i++) {
    const userId = `filler_${created.leagueId}_${i}`;
    await db.insert(users).values({ id: userId, email: `${userId}@test.local`, displayName: userId }).onConflictDoNothing();
    const outcome = await joinPublicLeague({ db, newId, clock }, { leagueId: created.leagueId, userId });
    if (!outcome.ok) throw new Error(outcome.reason);
    userIds.push(userId);
  }
  const [draft] = await db.select({ id: drafts.id }).from(drafts).where(eq(drafts.leagueId, created.leagueId));
  return { leagueId: created.leagueId, draftId: draft!.id, userIds };
}

async function snapshotOf(leagueId: string) {
  const draft = await draftRow(leagueId);
  const notices = await noticesOf(leagueId, "draft_kickoff_rolled");
  const events = await db.select().from(auditEvents).where(eq(auditEvents.leagueId, leagueId));
  return { kickoffAt: draft.kickoffAt.toISOString(), kickoffRolls: draft.kickoffRolls, status: draft.status, notices, events };
}

async function expectNoRollTookPlace(leagueId: string, before: Awaited<ReturnType<typeof snapshotOf>>): Promise<void> {
  expect(await snapshotOf(leagueId)).toEqual(before);
}

beforeEach(async () => {
  await truncateAll(db);
  nextId = 0;
});

afterAll(async () => {
  await truncateAll(db);
});

describe("rollDueDrafts", () => {
  it("rolls a due, unfilled, scheduled draft forward — and never a full one", async () => {
    const { leagueId, draftId } = await seedDueLeague({ teamCount: 3, filled: 2 });
    const outcomes = await rollDueDrafts(db, { clock });
    expect(outcomes).toEqual([{ draftId, rolled: true, kickoffAt: plusHours(ORIGINAL_KICKOFF, ROLL_CADENCE_HOURS), kickoffRolls: 1 }]);

    const draft = await draftRow(leagueId);
    expect(draft.kickoffAt.toISOString()).toBe(plusHours(ORIGINAL_KICKOFF, ROLL_CADENCE_HOURS));
    expect(draft.kickoffRolls).toBe(1);
    expect(draft.status).toBe("scheduled");
  });

  it("tells every seated member once, and says what their seat is still worth", async () => {
    const { leagueId } = await seedDueLeague({ teamCount: 3, filled: 3 - 1 });
    await rollDueDrafts(db, { clock });
    const notices = await noticesOf(leagueId, "draft_kickoff_rolled");
    expect(notices).toHaveLength(2);
    expect(notices[0]!.body).toContain("Your seat is still yours.");
    expect(notices[0]!.body).toContain("This draft moved once because the room was not full.");
    // Member league: the scheduled commitment names the commissioner's own press (F11).
    expect(notices[0]!.body).toContain("or when your commissioner starts it.");
    // First roll only: no release paragraph yet (F12).
    expect(notices[0]!.body).not.toContain("release your seat");
    const eventIds = new Set(notices.map((n) => n.auditEventId));
    expect(eventIds.size).toBe(1);

    const [event] = await db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.leagueId, leagueId), eq(auditEvents.eventType, "system_action")));
    expect(event!.payload).toMatchObject({ action: "draft_kickoff_rolled", summary: DRAFT_KICKOFF_ROLLED_SUMMARY });
  });

  it("gains the release paragraph from the second roll onward, never the first (F12)", async () => {
    const { leagueId } = await seedDueLeague({ teamCount: 3, filled: 2 });
    await rollDueDrafts(db, { clock });
    const firstNotices = await noticesOf(leagueId, "draft_kickoff_rolled");
    expect(firstNotices[0]!.body).not.toContain("release your seat");

    // Roll it a second time — the second roll's own due kickoff is a day out, so drive the clock
    // there directly rather than seeding a second fixture.
    const secondNow = plusHours(ORIGINAL_KICKOFF, ROLL_CADENCE_HOURS + 1);
    await rollDueDrafts(db, { clock: { now: () => secondNow } });
    const draft = await draftRow(leagueId);
    expect(draft.kickoffRolls).toBe(2);

    const allNotices = await noticesOf(leagueId, "draft_kickoff_rolled");
    expect(allNotices).toHaveLength(4); // 2 members x 2 rolls
    const secondRollNotices = allNotices.filter((n) => n.body.includes("moved twice"));
    expect(secondRollNotices).toHaveLength(2);
    for (const notice of secondRollNotices) {
      expect(notice.body).toContain("If you would rather not wait, you can release your seat and someone else can take it.");
    }
  });

  it("never rolls a when_full draft's placeholder kickoff (Step 3's exemption)", async () => {
    const { leagueId } = await seedDueLeague({ teamCount: 3, filled: 2, startTrigger: "when_full" });
    const before = await snapshotOf(leagueId);
    expect(await rollDueDrafts(db, { clock })).toEqual([]);
    await expectNoRollTookPlace(leagueId, before);
  });

  it("never rolls a full room — the SQL predicate excludes it before TypeScript ever asks", async () => {
    const { leagueId } = await seedDueLeague({ teamCount: 2, filled: 2 });
    const before = await snapshotOf(leagueId);
    expect(await rollDueDrafts(db, { clock })).toEqual([]);
    await expectNoRollTookPlace(leagueId, before);
  });

  it("does nothing at all while enforcement is off", async () => {
    const { leagueId } = await seedDueLeague({ teamCount: 3, filled: 2 });
    const before = await snapshotOf(leagueId);
    const config = INTEGRITY_CONFIG.participation as { enforceTierSegregation: boolean };
    const original = config.enforceTierSegregation;
    config.enforceTierSegregation = false;
    try {
      expect(await rollDueDrafts(db, { clock })).toEqual([]);
    } finally {
      config.enforceTierSegregation = original;
    }
    await expectNoRollTookPlace(leagueId, before);
  });

  it("names the house's own sentence for a house league, no commissioner named", async () => {
    const opened = await ensureHouseCatalog(db, { clock, newId });
    const leagueId = opened.opened.find((id) => id.includes("open_12") || id.includes("beginner_12"));
    if (leagueId === undefined) throw new Error("ensureHouseCatalog did not open a scheduled-trigger house league");
    // A fresh spawn has no seats at all — join one real member (leaving the room well short of
    // full) so this test proves the notice actually reaches somebody, not merely that nobody
    // objected to an empty loop.
    await db.insert(users).values({ id: "house_joiner", email: "house_joiner@test.local", displayName: "House Joiner" }).onConflictDoNothing();
    const joined = await joinPublicLeague({ db, newId, clock }, { leagueId, userId: "house_joiner" });
    if (!joined.ok) throw new Error(joined.reason);
    // Back the kickoff into the past so this house league's own draft is due — a fresh spawn's
    // own kickoff is staggered into the future by construction.
    await db.update(drafts).set({ kickoffAt: new Date(ORIGINAL_KICKOFF) }).where(eq(drafts.leagueId, leagueId));

    await rollDueDrafts(db, { clock });
    const notices = await noticesOf(leagueId, "draft_kickoff_rolled");
    expect(notices.length).toBeGreaterThan(0);
    expect(notices[0]!.body).toContain("The draft starts as soon as the last seat is taken.");
    expect(notices[0]!.body).not.toContain("commissioner");
  });

  // No leader election exists (PgBouncer). Exclusion comes from the WRITE: the UPDATE is guarded
  // on the kickoff it read, so the second instance updates zero rows and reports a clean no-op —
  // the same argument `claimAutoStart` already makes for its own guarded status transition.
  it("survives two instances rolling the same draft on the same tick", async () => {
    const { leagueId } = await seedDueLeague({ teamCount: 3, filled: 2 });

    function instance() {
      return createDb(TEST_DATABASE_URL, { max: DB_POOL_CONFIG.testMaxConnections, idleTimeoutSeconds: DB_POOL_CONFIG.testIdleTimeoutSeconds });
    }
    const dbOne = instance();
    const dbTwo = instance();

    try {
      const [a, b] = await Promise.all([rollDueDrafts(dbOne, { clock }), rollDueDrafts(dbTwo, { clock })]);
      const draft = await draftRow(leagueId);
      expect(draft.kickoffRolls).toBe(1);
      expect(a.length + b.length).toBe(2); // both scans find the draft; only one write wins
      const rolledCount = [...a, ...b].filter((outcome) => outcome.rolled).length;
      const racedCount = [...a, ...b].filter((outcome) => !outcome.rolled && outcome.reason === ROLL_REFUSALS.raced).length;
      expect(rolledCount).toBe(1);
      expect(racedCount).toBe(1);
    } finally {
      await dbOne.$client.end();
      await dbTwo.$client.end();
    }
  });

  it("writes nothing on every refusal path", async () => {
    const started = await seedDueLeague({ teamCount: 2, filled: 2 });
    await db.update(drafts).set({ status: "in_progress" }).where(eq(drafts.leagueId, started.leagueId));

    const whenFull = await seedDueLeague({ teamCount: 3, filled: 2, startTrigger: "when_full" });
    const full = await seedDueLeague({ teamCount: 2, filled: 2 });

    const everyRefusalPath = [
      () => db.transaction((tx) => rollUnfilledDraftInTx(tx, { draftId: started.draftId, leagueId: started.leagueId }, FIXED_NOW)),
      () => db.transaction((tx) => rollUnfilledDraftInTx(tx, { draftId: whenFull.draftId, leagueId: whenFull.leagueId }, FIXED_NOW)),
      () => db.transaction((tx) => rollUnfilledDraftInTx(tx, { draftId: full.draftId, leagueId: full.leagueId }, FIXED_NOW)),
    ];

    const before = await Promise.all([snapshotOf(started.leagueId), snapshotOf(whenFull.leagueId), snapshotOf(full.leagueId)]);
    for (const call of everyRefusalPath) await call();
    const after = await Promise.all([snapshotOf(started.leagueId), snapshotOf(whenFull.leagueId), snapshotOf(full.leagueId)]);
    expect(after).toEqual(before);
  });
});

describe("rollUnfilledDraftInTx", () => {
  it("refuses a draft that has already left 'scheduled', naming why", async () => {
    const { leagueId, draftId } = await seedDueLeague({ teamCount: 3, filled: 2 });
    await db.update(drafts).set({ status: "in_progress" }).where(eq(drafts.leagueId, leagueId));
    const outcome = await db.transaction((tx) => rollUnfilledDraftInTx(tx, { draftId, leagueId }, FIXED_NOW));
    expect(outcome).toEqual({ draftId, rolled: false, reason: ROLL_REFUSALS.alreadyStarted });
  });

  it("refuses a when_full draft outright, naming why", async () => {
    const { leagueId, draftId } = await seedDueLeague({ teamCount: 3, filled: 2, startTrigger: "when_full" });
    const outcome = await db.transaction((tx) => rollUnfilledDraftInTx(tx, { draftId, leagueId }, FIXED_NOW));
    expect(outcome).toEqual({ draftId, rolled: false, reason: ROLL_REFUSALS.notScheduled });
  });

  it("refuses a full room, naming why, and writes nothing", async () => {
    const { leagueId, draftId } = await seedDueLeague({ teamCount: 2, filled: 2 });
    const before = await snapshotOf(leagueId);
    const outcome = await db.transaction((tx) => rollUnfilledDraftInTx(tx, { draftId, leagueId }, FIXED_NOW));
    expect(outcome).toEqual({ draftId, rolled: false, reason: ROLL_REFUSALS.full });
    await expectNoRollTookPlace(leagueId, before);
  });
});
