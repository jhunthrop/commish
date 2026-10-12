import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { and, eq } from "drizzle-orm";
import { createTestDb } from "@research/db/test-db";
import { truncateAll } from "@/db/test-db";
import { players } from "@research/db/schema";
import { auditEvents, draftPicks, drafts, matchups, memberNotices, teams, users } from "@/db/schema";
import { STANDARD_ROSTER_SLOTS } from "@research/domain/roster";
import { autoStartDueDrafts } from "@/draft-service/auto-start";
import { createDraftStore } from "@/draft-service/store";
import { SPRINT_ROSTER_SLOTS } from "@/draft-service/test-support";
import { MATCHMAKING_CONFIG } from "@/matchmaking/config";
import { createLeague } from "./creation";
import { ensureHouseCatalog } from "./house-factory";
import { joinPublicLeague } from "./join";
import { DRAFT_FILL_REVERSED_SUMMARY, RELEASE_REFUSALS, releaseSeat } from "./release";

const db = createTestDb();
const FIXED_NOW = "2026-08-23T12:00:00.000Z";
const ORIGINAL_KICKOFF = "2026-09-01T00:00:00.000Z";
const clock = { now: () => FIXED_NOW };
const GRACE = MATCHMAKING_CONFIG.sitAndGo.graceSeconds;
let nextId = 0;
const newId = () => `id_${++nextId}`;

function plusSeconds(iso: string, seconds: number): string {
  return new Date(Date.parse(iso) + seconds * 1000).toISOString();
}

/** Mirrors `fill-trigger.test.ts`'s own fixture: a public matchmade league, its draft's
 *  `start_trigger` chosen by the caller. `rosterSlots` defaults to the standard shape; the
 *  "draft has started" test below swaps in `SPRINT_ROSTER_SLOTS` so a real `startDraft` succeeds
 *  without a large player fixture. */
async function seedLeague(input: {
  readonly teamCount: number;
  readonly startTrigger: "scheduled" | "when_full";
  readonly commissionerId?: string;
  readonly rosterSlots?: typeof STANDARD_ROSTER_SLOTS;
}): Promise<{ readonly leagueId: string; readonly draftId: string; readonly commissionerId: string }> {
  const commissionerId = input.commissionerId ?? `commish_${newId()}`;
  await db.insert(users).values({ id: commissionerId, email: `${commissionerId}@test.local`, displayName: commissionerId }).onConflictDoNothing();
  const created = await createLeague({ db, clock, newId }, {
    name: "Release Test League",
    format: "snake",
    teamCount: input.teamCount,
    scoringPreset: "ppr",
    auctionBudget: null,
    rosterSlots: input.rosterSlots ?? STANDARD_ROSTER_SLOTS,
    owner: { kind: "member", userId: commissionerId, teamName: "Commish's Team" },
    experienceTier: "beginner",
    stakeTier: 0,
    isPublicMatchmade: true,
    startTrigger: input.startTrigger,
    kickoffAt: ORIGINAL_KICKOFF,
  });
  if (!created.ok) throw new Error(created.reason);
  const [draft] = await db.select({ id: drafts.id }).from(drafts).where(eq(drafts.leagueId, created.leagueId));
  if (draft === undefined) throw new Error("no draft for seeded league");
  return { leagueId: created.leagueId, draftId: draft.id, commissionerId };
}

/** Fills `leagueId` to `count` seated teams (the commissioner already counts as one), through the
 *  real `joinPublicLeague` door. */
async function fillTo(leagueId: string, count: number): Promise<void> {
  const seated = await db.select({ id: teams.id }).from(teams).where(eq(teams.leagueId, leagueId));
  for (let i = seated.length; i < count; i++) {
    const userId = `filler_${leagueId}_${i}`;
    await db.insert(users).values({ id: userId, email: `${userId}@test.local`, displayName: userId }).onConflictDoNothing();
    const outcome = await joinPublicLeague({ db, newId, clock }, { leagueId, userId });
    if (!outcome.ok) throw new Error(outcome.reason);
  }
}

async function filledTeamsOf(leagueId: string): Promise<number> {
  const rows = await db.select({ id: teams.id }).from(teams).where(eq(teams.leagueId, leagueId));
  return rows.length;
}

async function fillFiredAtOf(leagueId: string): Promise<Date | null> {
  const [row] = await db.select({ fillFiredAt: drafts.fillFiredAt }).from(drafts).where(eq(drafts.leagueId, leagueId));
  return row?.fillFiredAt ?? null;
}

async function draftFillReversedNotices(leagueId: string) {
  return db
    .select()
    .from(memberNotices)
    .where(and(eq(memberNotices.leagueId, leagueId), eq(memberNotices.noticeType, "draft_fill_reversed")));
}

async function memberJoinedEvents(leagueId: string) {
  return db
    .select()
    .from(auditEvents)
    .where(and(eq(auditEvents.leagueId, leagueId), eq(auditEvents.eventType, "member_joined")));
}

/** A cross-league snapshot of everything a release can possibly write — teams, drafts, audit
 *  events and notices — so "writes nothing on every refusal path" is proven over the whole
 *  database rather than trusted from one table. */
async function snapshotOf() {
  return {
    teams: await db.select().from(teams),
    drafts: await db.select().from(drafts),
    auditEvents: await db.select().from(auditEvents),
    memberNotices: await db.select().from(memberNotices),
  };
}

async function expectNoSeatReleaseTookPlace(before: Awaited<ReturnType<typeof snapshotOf>>): Promise<void> {
  expect(await snapshotOf()).toEqual(before);
}

beforeEach(async () => {
  await truncateAll(db);
  nextId = 0;
});

afterAll(async () => {
  await truncateAll(db);
});

describe("releaseSeat", () => {
  it("lets a member leave a league whose draft has not started, and frees the seat immediately", async () => {
    const { leagueId } = await seedLeague({ teamCount: 6, startTrigger: "scheduled" });
    await fillTo(leagueId, 3);
    const before = await filledTeamsOf(leagueId);

    const result = await releaseSeat(db, { leagueId, userId: "filler_" + leagueId + "_1" }, { clock });
    expect(result).toMatchObject({ ok: true });
    expect(await filledTeamsOf(leagueId)).toBe(before - 1);
  });

  it("records the departure on the league chain as member_joined with outcome seat_released, the frozen-enum compromise", async () => {
    const { leagueId } = await seedLeague({ teamCount: 6, startTrigger: "scheduled" });
    await fillTo(leagueId, 3);
    const userId = "filler_" + leagueId + "_1";

    await releaseSeat(db, { leagueId, userId }, { clock });
    const events = await memberJoinedEvents(leagueId);
    // Two `member_joined` events now share this actor: the original join (`payload.via`) and the
    // departure (`payload.outcome`) — `payload.outcome` is the one field that tells them apart.
    const departure = events.find((event) => event.actorId === userId && (event.payload as { readonly outcome?: string }).outcome !== undefined);
    expect(departure).toBeDefined();
    expect(departure!.payload).toMatchObject({ outcome: "seat_released" });
  });

  it("refuses once the draft has started, because a roster in a live draft is not a seat", async () => {
    // `SPRINT_ROSTER_SLOTS` (3 spots a team, `@/draft-service/test-support`): `startDraft`
    // refuses a pool too small to fill every roster, so a real 2-team draft needs enough real
    // players seeded, and the point of this test is the refusal, not roster fixturing.
    const { leagueId, draftId } = await seedLeague({
      teamCount: 2,
      startTrigger: "scheduled",
      commissionerId: "u_commish_started",
      rosterSlots: SPRINT_ROSTER_SLOTS,
    });
    await db.insert(users).values({ id: "u_bob_started", email: "u_bob_started@test.local", displayName: "Bob" });
    const joined = await joinPublicLeague({ db, newId, clock }, { leagueId, userId: "u_bob_started" });
    if (!joined.ok) throw new Error(joined.reason);

    await db.insert(players).values([
      { id: "p_release_qb1", name: "Release QB1", position: "QB", nflTeam: "FA" },
      { id: "p_release_rb1", name: "Release RB1", position: "RB", nflTeam: "FA" },
      { id: "p_release_wr1", name: "Release WR1", position: "WR", nflTeam: "FA" },
      { id: "p_release_qb2", name: "Release QB2", position: "QB", nflTeam: "FA" },
      { id: "p_release_rb2", name: "Release RB2", position: "RB", nflTeam: "FA" },
      { id: "p_release_wr2", name: "Release WR2", position: "WR", nflTeam: "FA" },
    ]);

    const store = createDraftStore({ db, publish: async () => "1-0", clock, deliverNotice: async () => {} });
    const started = await store.startDraft(draftId);
    expect(started.ok).toBe(true);

    expect(await releaseSeat(db, { leagueId, userId: "u_bob_started" }, { clock })).toEqual({
      ok: false,
      reason: RELEASE_REFUSALS.draftStarted,
    });
  });

  it("refuses a member commissioner, and names that there is no way to hand the role off; a house member leaves freely", async () => {
    const { leagueId: memberLeagueId, commissionerId } = await seedLeague({ teamCount: 6, startTrigger: "scheduled" });

    expect(await releaseSeat(db, { leagueId: memberLeagueId, userId: commissionerId }, { clock })).toEqual({
      ok: false,
      reason: RELEASE_REFUSALS.commissioner,
    });

    // A HOUSE league has no commissioner at all — the authority union's `house` branch, not a
    // special case — so the same member leaves freely.
    const opened = await ensureHouseCatalog(db, { clock, newId });
    const houseLeagueId = opened.opened.find((id) => id.includes("open_12"));
    if (houseLeagueId === undefined) throw new Error("ensureHouseCatalog did not open an open_12 league");
    await db.insert(users).values({ id: "u_house_member", email: "u_house_member@test.local", displayName: "House Member" });
    const houseJoin = await joinPublicLeague({ db, newId, clock }, { leagueId: houseLeagueId, userId: "u_house_member" });
    if (!houseJoin.ok) throw new Error(houseJoin.reason);

    expect(await releaseSeat(db, { leagueId: houseLeagueId, userId: "u_house_member" }, { clock })).toMatchObject({ ok: true });
  });

  it("puts a filled sit-and-go league back to filling, so its draft cannot fire into a short room", async () => {
    const { leagueId } = await seedLeague({ teamCount: 2, startTrigger: "when_full" });
    await db.insert(users).values({ id: "u_bob_sag", email: "u_bob_sag@test.local", displayName: "Bob" });
    const joined = await joinPublicLeague({ db, newId, clock }, { leagueId, userId: "u_bob_sag" }); // fills it — fill_fired_at stamped, kickoff = now + grace
    if (!joined.ok) throw new Error(joined.reason);
    expect(await fillFiredAtOf(leagueId)).not.toBeNull();

    await releaseSeat(db, { leagueId, userId: "u_bob_sag" }, { clock });

    expect(await fillFiredAtOf(leagueId)).toBeNull();

    // The room is no longer full, so the platform's own due-kickoff scan must not start it.
    const afterGrace = { now: () => plusSeconds(FIXED_NOW, GRACE + 1) };
    const store = createDraftStore({ db, publish: async () => "1-0", clock: afterGrace, deliverNotice: async () => {} });
    expect(await autoStartDueDrafts(db, { store, clock: afterGrace })).toEqual([]);
  });

  it("tells every remaining seated team the room is back to filling, never the member who just left", async () => {
    const { leagueId, commissionerId } = await seedLeague({ teamCount: 2, startTrigger: "when_full" });
    await db.insert(users).values({ id: "u_bob_notice", email: "u_bob_notice@test.local", displayName: "Bob" });
    const joined = await joinPublicLeague({ db, newId, clock }, { leagueId, userId: "u_bob_notice" });
    if (!joined.ok) throw new Error(joined.reason);

    await releaseSeat(db, { leagueId, userId: "u_bob_notice" }, { clock });

    const notices = await draftFillReversedNotices(leagueId);
    expect(notices).toHaveLength(1);
    expect(notices[0]!.userId).toBe(commissionerId);
    expect(notices[0]!.body).toContain("no longer full");
    expect(notices[0]!.auditEventId).not.toBeNull();

    const events = await db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.leagueId, leagueId), eq(auditEvents.eventType, "system_action")));
    expect(events.some((event) => (event.payload as { readonly action?: string }).action === "draft_fill_reversed")).toBe(true);
    const reversed = events.find((event) => (event.payload as { readonly action?: string }).action === "draft_fill_reversed");
    expect(reversed?.payload).toMatchObject({ summary: DRAFT_FILL_REVERSED_SUMMARY });
  });

  it("sends no draft_fill_reversed notice for a league that never fired, or a scheduled-trigger league", async () => {
    const { leagueId } = await seedLeague({ teamCount: 6, startTrigger: "scheduled" });
    await fillTo(leagueId, 3);
    await releaseSeat(db, { leagueId, userId: "filler_" + leagueId + "_1" }, { clock });
    expect(await draftFillReversedNotices(leagueId)).toEqual([]);
  });

  it("leaves draft_picks and matchups empty at the moment of the delete, the precondition that makes the delete legal", async () => {
    const { leagueId, draftId } = await seedLeague({ teamCount: 6, startTrigger: "scheduled" });
    await fillTo(leagueId, 3);

    const [picksBefore, matchupsBefore] = await Promise.all([
      db.select().from(draftPicks).where(eq(draftPicks.draftId, draftId)),
      db.select().from(matchups).where(eq(matchups.leagueId, leagueId)),
    ]);
    expect(picksBefore).toEqual([]);
    expect(matchupsBefore).toEqual([]);

    // A `'scheduled'`-status league (asserted just above to genuinely have neither row) is
    // exactly the state `releaseSeat`'s own refusal on `status !== 'scheduled'` exists to
    // guarantee — `draft_picks`/`matchups` reference `teams` WITHOUT `ON DELETE CASCADE`
    // (`@research/db/schema`), so a non-empty either table here would have aborted this DELETE with a
    // real foreign key violation rather than silently orphaning anything.
    const result = await releaseSeat(db, { leagueId, userId: "filler_" + leagueId + "_1" }, { clock });
    expect(result.ok).toBe(true);

    expect(await db.select().from(draftPicks).where(eq(draftPicks.draftId, draftId))).toEqual([]);
    expect(await db.select().from(matchups).where(eq(matchups.leagueId, leagueId))).toEqual([]);
  });

  it("refuses a caller with no seat in the league", async () => {
    const { leagueId } = await seedLeague({ teamCount: 6, startTrigger: "scheduled" });
    await db.insert(users).values({ id: "u_stranger", email: "u_stranger@test.local", displayName: "Stranger" });
    expect(await releaseSeat(db, { leagueId, userId: "u_stranger" }, { clock })).toEqual({
      ok: false,
      reason: RELEASE_REFUSALS.notMember,
    });
  });

  it("refuses a league that doesn't exist", async () => {
    expect(await releaseSeat(db, { leagueId: "nope", userId: "u_anyone" }, { clock })).toEqual({
      ok: false,
      reason: RELEASE_REFUSALS.leagueMissing,
    });
  });

  it("works with every dependency defaulted — the system clock and process-wide logger are the production path", async () => {
    expect(await releaseSeat(db, { leagueId: "nope", userId: "u_anyone" })).toEqual({
      ok: false,
      reason: RELEASE_REFUSALS.leagueMissing,
    });
  });

  // P9 fix round, P8-M2: every refusal path means all FOUR (`RELEASE_REFUSALS` has four members) —
  // `draftStarted` was the one this sweep left out. `db.update(drafts)` here is a test-only
  // shortcut for "a draft that has started," deliberately lighter than the dedicated test above
  // (which drives a real `store.startDraft()`): that test already proves the refusal fires from a
  // GENUINE started draft; this one only needs the status this refusal actually reads.
  it("writes nothing on every refusal path", async () => {
    const { leagueId: memberLeagueId, commissionerId } = await seedLeague({ teamCount: 2, startTrigger: "scheduled", commissionerId: "u_commish_refusal" });
    await db.insert(users).values({ id: "u_bob_refusal", email: "u_bob_refusal@test.local", displayName: "Bob" });
    const joined = await joinPublicLeague({ db, newId, clock }, { leagueId: memberLeagueId, userId: "u_bob_refusal" });
    if (!joined.ok) throw new Error(joined.reason);

    await db.insert(users).values({ id: "u_stranger_refusal", email: "u_stranger_refusal@test.local", displayName: "Stranger" });

    const { leagueId: startedLeagueId, draftId: startedDraftId } = await seedLeague({
      teamCount: 2,
      startTrigger: "scheduled",
      commissionerId: "u_commish_started_refusal",
    });
    await db.insert(users).values({ id: "u_bob_started_refusal", email: "u_bob_started_refusal@test.local", displayName: "Bob" });
    const startedJoin = await joinPublicLeague({ db, newId, clock }, { leagueId: startedLeagueId, userId: "u_bob_started_refusal" });
    if (!startedJoin.ok) throw new Error(startedJoin.reason);
    await db.update(drafts).set({ status: "in_progress" }).where(eq(drafts.id, startedDraftId));

    const everyRefusalPath = [
      () => releaseSeat(db, { leagueId: "nope", userId: "u_anyone" }, { clock }),
      () => releaseSeat(db, { leagueId: memberLeagueId, userId: commissionerId }, { clock }),
      () => releaseSeat(db, { leagueId: memberLeagueId, userId: "u_stranger_refusal" }, { clock }),
      () => releaseSeat(db, { leagueId: startedLeagueId, userId: "u_bob_started_refusal" }, { clock }),
    ];

    const before = await snapshotOf();
    const outcomes: { readonly ok: boolean }[] = [];
    for (const call of everyRefusalPath) {
      outcomes.push(await call());
    }
    expect(outcomes.every((outcome) => outcome.ok === false)).toBe(true);
    expect(outcomes[3]).toEqual({ ok: false, reason: RELEASE_REFUSALS.draftStarted });
    await expectNoSeatReleaseTookPlace(before);
  });
});
