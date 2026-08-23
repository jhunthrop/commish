import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { and, eq } from "drizzle-orm";
import { createTestDb, truncateAll } from "@/db/test-db";
import { auditEvents, drafts, memberNotices, players, teams, users } from "@/db/schema";
import { STANDARD_ROSTER_SLOTS } from "@/domain/roster";
import type { RosterSlotConfig } from "@/domain/roster";
import { clockTierFor } from "@/draft-engine";
import { createDraftStore } from "@/draft-service/store";
import { autoStartDueDrafts } from "@/draft-service/auto-start";
import { SPRINT_ROSTER_SLOTS } from "@/draft-service/test-support";
import { MATCHMAKING_CONFIG } from "@/matchmaking/config";
import { createLeague } from "./creation";
import { FILL_TRIGGER_REFUSALS, fireWhenFullInTx } from "./fill-trigger";
import { acceptInvite, createInvite } from "./invites";
import { joinPublicLeague } from "./join";

const db = createTestDb();
const FIXED_NOW = "2026-08-17T12:00:00.000Z";
const ORIGINAL_KICKOFF = "2026-09-01T00:00:00.000Z";
const clock = { now: () => FIXED_NOW };
const GRACE = MATCHMAKING_CONFIG.sitAndGo.graceSeconds;
let nextId = 0;
const newId = () => `id_${++nextId}`;

function plusSeconds(iso: string, seconds: number): string {
  return new Date(Date.parse(iso) + seconds * 1000).toISOString();
}

async function kickoffOf(leagueId: string): Promise<string> {
  const [row] = await db.select({ kickoffAt: drafts.kickoffAt }).from(drafts).where(eq(drafts.leagueId, leagueId));
  if (row === undefined) throw new Error("no draft for that league");
  return row.kickoffAt.toISOString();
}

async function statusOf(leagueId: string): Promise<string> {
  const [row] = await db.select({ status: drafts.status }).from(drafts).where(eq(drafts.leagueId, leagueId));
  if (row === undefined) throw new Error("no draft for that league");
  return row.status;
}

async function fillTriggeredNotices(leagueId: string) {
  return db
    .select()
    .from(memberNotices)
    .where(and(eq(memberNotices.leagueId, leagueId), eq(memberNotices.noticeType, "draft_fill_triggered")));
}

/** A public matchmade league, its draft's `start_trigger` chosen by the caller — the fixture
 *  every test in this file builds on. `teamCount: 3` keeps the fill small and fast: the
 *  commissioner's own seat plus two more joiners is enough to prove "the Nth member" without a
 *  12-team fixture's own setup cost. */
async function seedLeague(input: {
  readonly teamCount: number;
  readonly startTrigger: "scheduled" | "when_full";
  readonly rosterSlots?: readonly RosterSlotConfig[];
}): Promise<{ readonly leagueId: string }> {
  await db.insert(users).values({ id: "commish", email: "commish@test.local", displayName: "Commish" }).onConflictDoNothing();
  const created = await createLeague({ db, clock, newId }, {
    name: "Sit and Go",
    format: "snake",
    teamCount: input.teamCount,
    scoringPreset: "ppr",
    auctionBudget: null,
    rosterSlots: input.rosterSlots ?? STANDARD_ROSTER_SLOTS,
    commissionerUserId: "commish",
    teamName: "Commish's Team",
    experienceTier: "beginner",
    stakeTier: 0,
    isPublicMatchmade: true,
    startTrigger: input.startTrigger,
    kickoffAt: ORIGINAL_KICKOFF,
  });
  if (!created.ok) throw new Error(created.reason);
  return { leagueId: created.leagueId };
}

/** Fills `leagueId` to `count` seated teams (the commissioner already counts as one), joining
 *  through the real `joinPublicLeague` door so every fill this file drives goes through
 *  `joinLeagueInTx` exactly the way a real member's browser would. */
async function fillTo(leagueId: string, count: number): Promise<void> {
  const seated = await db.select({ id: teams.id }).from(teams).where(eq(teams.leagueId, leagueId));
  for (let i = seated.length; i < count; i++) {
    const userId = `filler_${leagueId}_${i}`;
    await db.insert(users).values({ id: userId, email: `${userId}@test.local`, displayName: userId }).onConflictDoNothing();
    const outcome = await joinPublicLeague({ db, newId, clock }, { leagueId, userId });
    if (!outcome.ok) throw new Error(outcome.reason);
  }
}

beforeEach(async () => {
  await truncateAll(db);
  nextId = 0;
});

afterAll(async () => {
  await truncateAll(db);
});

describe("fireWhenFullInTx, driven through the real join door", () => {
  it("writes a kickoff time when the last seat fills", async () => {
    const { leagueId } = await seedLeague({ teamCount: 3, startTrigger: "when_full" });
    await fillTo(leagueId, 2);
    await db.insert(users).values({ id: "u_last", email: "u_last@test.local", displayName: "Last In" });

    const outcome = await joinPublicLeague({ db, newId, clock }, { leagueId, userId: "u_last" });
    expect(outcome.ok).toBe(true);
    expect(await kickoffOf(leagueId)).toBe(plusSeconds(FIXED_NOW, GRACE));
    expect(await statusOf(leagueId)).toBe("scheduled");
  });

  it("does nothing before the league is actually full, because a league is not full until it is", async () => {
    const { leagueId } = await seedLeague({ teamCount: 3, startTrigger: "when_full" });
    // Only the commissioner is seated so far — this join is the SECOND of three, not the last.
    await db.insert(users).values({ id: "u_second", email: "u_second@test.local", displayName: "Second In" });
    await joinPublicLeague({ db, newId, clock }, { leagueId, userId: "u_second" });
    expect(await kickoffOf(leagueId)).toBe(ORIGINAL_KICKOFF);
    expect(await fillTriggeredNotices(leagueId)).toHaveLength(0);
  });

  it("leaves a scheduled league's time alone even when it fills, the one behavior that separates the two triggers", async () => {
    const { leagueId } = await seedLeague({ teamCount: 3, startTrigger: "scheduled" });
    await fillTo(leagueId, 2);
    await db.insert(users).values({ id: "u_last_sched", email: "u_last_sched@test.local", displayName: "Last In" });

    await joinPublicLeague({ db, newId, clock }, { leagueId, userId: "u_last_sched" });
    expect(await kickoffOf(leagueId)).toBe(ORIGINAL_KICKOFF);
    expect(await fillTriggeredNotices(leagueId)).toHaveLength(0);
  });

  it("sends every seated member a draft_fill_triggered notice, all on one system_action event", async () => {
    const { leagueId } = await seedLeague({ teamCount: 3, startTrigger: "when_full" });
    await fillTo(leagueId, 2);
    await db.insert(users).values({ id: "u_last_notice", email: "u_last_notice@test.local", displayName: "Last In" });

    await joinPublicLeague({ db, newId, clock }, { leagueId, userId: "u_last_notice" });
    const notices = await fillTriggeredNotices(leagueId);
    expect(notices).toHaveLength(3);
    expect(notices.every((notice) => notice.auditEventId !== null)).toBe(true);
    expect(new Set(notices.map((notice) => notice.auditEventId)).size).toBe(1);

    const [event] = await db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.leagueId, leagueId), eq(auditEvents.eventType, "system_action")));
    expect(event?.payload).toMatchObject({ action: "draft_fill_triggered" });
  });

  it("starts the draft on the next tick, through the auto-start machinery that already exists", async () => {
    // `SPRINT_ROSTER_SLOTS` (3 spots a team, `@/draft-service/test-support`): `startDraft`
    // refuses a pool too small to fill every roster, so a real 2-team draft needs enough real
    // players seeded, and the point of this test is the auto-start path, not roster fixturing.
    const { leagueId } = await seedLeague({ teamCount: 2, startTrigger: "when_full", rosterSlots: SPRINT_ROSTER_SLOTS });
    await db.insert(players).values([
      { id: "p_tick_qb1", name: "Tick QB1", position: "QB", nflTeam: "FA" },
      { id: "p_tick_rb1", name: "Tick RB1", position: "RB", nflTeam: "FA" },
      { id: "p_tick_wr1", name: "Tick WR1", position: "WR", nflTeam: "FA" },
      { id: "p_tick_qb2", name: "Tick QB2", position: "QB", nflTeam: "FA" },
      { id: "p_tick_rb2", name: "Tick RB2", position: "RB", nflTeam: "FA" },
      { id: "p_tick_wr2", name: "Tick WR2", position: "WR", nflTeam: "FA" },
    ]);
    await db.insert(users).values({ id: "u_last_tick", email: "u_last_tick@test.local", displayName: "Last In" });
    await joinPublicLeague({ db, newId, clock }, { leagueId, userId: "u_last_tick" });

    const afterGrace = plusSeconds(FIXED_NOW, GRACE + 1);
    const store = createDraftStore({ db, publish: async () => "1-0", clock: { now: () => afterGrace }, deliverNotice: async () => {} });
    const outcomes = await autoStartDueDrafts(db, { store, clock: { now: () => afterGrace } });
    expect(outcomes.some((outcome) => outcome.started)).toBe(true);
    expect(await statusOf(leagueId)).toBe("in_progress");
  });

  it("drafts at the ladder's floor, because the kickoff it wrote is minutes away", () => {
    // `clockTierFor` measures the pick clock against `kickoff_at` alone, and the fill trigger
    // just wrote one five minutes out — a sit-and-go pod runs at 90-second picks with no second
    // mechanism and no special case. This is the whole reason the trigger writes a TIME.
    expect(clockTierFor(FIXED_NOW, plusSeconds(FIXED_NOW, GRACE)).pickSeconds).toBe(90);
  });

  it("refuses a repeat call once it has already fired, and writes nothing more", async () => {
    const { leagueId } = await seedLeague({ teamCount: 2, startTrigger: "when_full" });
    await db.insert(users).values({ id: "u_last_twice", email: "u_last_twice@test.local", displayName: "Last In" });
    await joinPublicLeague({ db, newId, clock }, { leagueId, userId: "u_last_twice" });

    const kickoffBefore = await kickoffOf(leagueId);
    const noticesBefore = await fillTriggeredNotices(leagueId);
    const eventsBefore = await db.select().from(auditEvents).where(eq(auditEvents.leagueId, leagueId));

    const second = await db.transaction((tx) => fireWhenFullInTx(tx, leagueId, plusSeconds(FIXED_NOW, 999)));
    expect(second).toEqual({ fired: false, reason: FILL_TRIGGER_REFUSALS.alreadyFired });

    expect(await kickoffOf(leagueId)).toBe(kickoffBefore);
    expect(await fillTriggeredNotices(leagueId)).toEqual(noticesBefore);
    expect(await db.select().from(auditEvents).where(eq(auditEvents.leagueId, leagueId))).toEqual(eventsBefore);
  });

  it("refuses a league with an open seat, naming why", async () => {
    const { leagueId } = await seedLeague({ teamCount: 3, startTrigger: "when_full" });
    const outcome = await db.transaction((tx) => fireWhenFullInTx(tx, leagueId, FIXED_NOW));
    expect(outcome).toEqual({ fired: false, reason: FILL_TRIGGER_REFUSALS.notFull });
  });

  it("refuses a when_full draft that has already left 'scheduled', naming why", async () => {
    const { leagueId } = await seedLeague({ teamCount: 1, startTrigger: "when_full" });
    await db.update(drafts).set({ status: "in_progress" }).where(eq(drafts.leagueId, leagueId));
    const outcome = await db.transaction((tx) => fireWhenFullInTx(tx, leagueId, FIXED_NOW));
    expect(outcome).toEqual({ fired: false, reason: FILL_TRIGGER_REFUSALS.alreadyStarted });
  });

  it("refuses a 'scheduled' draft outright, naming why", async () => {
    const { leagueId } = await seedLeague({ teamCount: 1, startTrigger: "scheduled" });
    const outcome = await db.transaction((tx) => fireWhenFullInTx(tx, leagueId, FIXED_NOW));
    expect(outcome).toEqual({ fired: false, reason: FILL_TRIGGER_REFUSALS.notWhenFull });
  });

  it("refuses a league that doesn't exist, naming why", async () => {
    const outcome = await db.transaction((tx) => fireWhenFullInTx(tx, "nope", FIXED_NOW));
    expect(outcome).toEqual({ fired: false, reason: FILL_TRIGGER_REFUSALS.notWhenFull });
  });

  // Binding context: "the join doors are `joinLeagueInTx` + `acceptInvite`'s" — neither door
  // knows this trigger exists (its own docblock says so), and this proves the invite door gets
  // it for free, exactly like the public-browse door above, because both pass through the one
  // `joinLeagueInTx` this trigger actually lives inside.
  it("fires through the invite door too, not only public browse", async () => {
    const { leagueId } = await seedLeague({ teamCount: 2, startTrigger: "when_full" });
    const invite = await createInvite({ db, clock, random: () => 0.42 }, { leagueId, createdByUserId: "commish" });
    if (!invite.ok) throw new Error(invite.reason);
    await db.insert(users).values({ id: "u_invited", email: "u_invited@test.local", displayName: "Invited" });

    const outcome = await acceptInvite({ db, clock, newId }, { code: invite.code, userId: "u_invited" });
    expect(outcome.ok).toBe(true);
    expect(await kickoffOf(leagueId)).toBe(plusSeconds(FIXED_NOW, GRACE));
    expect(await fillTriggeredNotices(leagueId)).toHaveLength(2);
  });

  // The "Race" ruling: two joins racing for the last seat, driven against real Postgres. One
  // wins the seat (the existing seat machinery, already proven in `join.test.ts`'s own
  // "never seats more managers" test) — this proves the trigger ALSO fires exactly once,
  // through the SAME serialization (`leagues FOR UPDATE`), never twice and never zero times.
  it("fires exactly once when two joins race for the league's last seat", async () => {
    const { leagueId } = await seedLeague({ teamCount: 3, startTrigger: "when_full" });
    await fillTo(leagueId, 2);
    await db.insert(users).values([
      { id: "racer_a", email: "racer_a@test.local", displayName: "Racer A" },
      { id: "racer_b", email: "racer_b@test.local", displayName: "Racer B" },
    ]);

    const results = await Promise.all([
      joinPublicLeague({ db, newId, clock }, { leagueId, userId: "racer_a" }),
      joinPublicLeague({ db, newId, clock }, { leagueId, userId: "racer_b" }),
    ]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);

    expect(await kickoffOf(leagueId)).toBe(plusSeconds(FIXED_NOW, GRACE));
    expect(await fillTriggeredNotices(leagueId)).toHaveLength(3); // one per seated team, exactly once
    const events = await db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.leagueId, leagueId), eq(auditEvents.eventType, "system_action")));
    expect(events).toHaveLength(1);
  });
});
