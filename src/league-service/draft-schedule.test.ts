import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, truncateAll } from "@/db/test-db";
import { draftActions, drafts, leagues, teams, users } from "@/db/schema";
import { STANDARD_ROSTER_SLOTS } from "@/domain/roster";
import { DRAFT_ACTION_VERSION } from "@/domain/draft";
import { DRAFT_SKIP_POLICY } from "@/draft-engine";
import { setSlotPreference } from "@/draft-service/slot-preference";
import { LEAGUE_CONFIG } from "@/league";
import { HOUSE_AUTHORITY_REFUSALS } from "./authority";
import { createLeague } from "./creation";
import { draftScheduleView, setDraftKickoff, KICKOFF_REFUSALS } from "./draft-schedule";

const db = createTestDb();
const FIXED_NOW = "2026-08-17T12:00:00.000Z";
const clock = { now: () => FIXED_NOW };
let nextId = 0;
const newId = () => `id_${++nextId}`;

const LATER = "2026-08-20T12:00:00.000Z";
const YESTERDAY = "2026-08-16T12:00:00.000Z";
const NEXT_YEAR = "2027-08-17T12:00:00.000Z";

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

async function seedLeague(input: {
  readonly commissionerUserId?: string;
  readonly otherUserId?: string;
  readonly startTrigger?: "scheduled" | "when_full";
  readonly isPublicMatchmade?: boolean;
} = {}): Promise<{
  readonly leagueId: string;
  readonly commissioner: string;
}> {
  const commissioner = input.commissionerUserId ?? "commish";
  const other = input.otherUserId ?? "member";
  await db
    .insert(users)
    .values([
      { id: commissioner, email: `${commissioner}@test.local`, displayName: "Commissioner" },
      { id: other, email: `${other}@test.local`, displayName: "Member" },
    ])
    .onConflictDoNothing();
  const created = await createLeague({ db, clock, newId }, {
    name: "Sunday Money",
    format: "snake",
    teamCount: LEAGUE_CONFIG.defaults.teamCount,
    scoringPreset: "ppr",
    auctionBudget: null,
    rosterSlots: STANDARD_ROSTER_SLOTS,
    owner: { kind: "member", userId: commissioner, teamName: "Commissioner's Team" },
    experienceTier: "beginner",
    stakeTier: 0,
    isPublicMatchmade: input.isPublicMatchmade ?? false,
    startTrigger: input.startTrigger,
  });
  if (!created.ok) throw new Error(created.reason);
  return { leagueId: created.leagueId, commissioner };
}

/**
 * A house league, hand-inserted rather than through `createLeague`: Task 13's `LeagueOwner`
 * house branch is what teaches `createLeague` to write one, and this task (12) only needs a row
 * shaped the way the CHECK constraint requires it — `commissionerUserId: null`, `houseRung` set —
 * to prove `setDraftKickoff` refuses every member of it the same true way.
 */
async function seedHouseLeague(leagueId: string, memberUserId: string): Promise<void> {
  await db.insert(users).values({ id: memberUserId, email: `${memberUserId}@test.local`, displayName: "House Member" }).onConflictDoNothing();
  await db.insert(leagues).values({
    id: leagueId, name: "Open 12", format: "snake", teamCount: LEAGUE_CONFIG.defaults.teamCount,
    commissionerUserId: null, houseRung: "open_12", rosterSlots: STANDARD_ROSTER_SLOTS,
  });
  await db.insert(teams).values({ id: `${leagueId}_team`, leagueId, userId: memberUserId, name: "House Team" });
  await db.insert(drafts).values({
    id: `${leagueId}_draft`, leagueId, format: "snake", status: "scheduled",
    kickoffAt: new Date("2026-09-10T17:00:00.000Z"), auctionBudget: null,
  });
}

beforeEach(async () => {
  await truncateAll(db);
  nextId = 0;
});

afterAll(async () => {
  await truncateAll(db);
});

describe("draftScheduleView", () => {
  it("reads the draft's own scheduling facts", async () => {
    const { leagueId, commissioner } = await seedLeague();
    const view = await draftScheduleView(db, leagueId, commissioner);
    expect(view).toMatchObject({ leagueId, status: "scheduled", isPublicMatchmade: false });
    expect(view?.kickoffAt).toBe(await kickoffOf(leagueId));
  });

  it("answers null for a league that doesn't exist", async () => {
    expect(await draftScheduleView(db, "nope", "whoever")).toBeNull();
  });

  // Phase 3.5, Task 8: the two new fields `WaitingRoom` renders from.
  it("carries the start trigger and the current fill count", async () => {
    const { leagueId, commissioner } = await seedLeague();
    const view = await draftScheduleView(db, leagueId, commissioner);
    expect(view).toMatchObject({ startTrigger: "scheduled", filledTeams: 1 });
  });

  it("reports when_full and the fill count growing as more teams join", async () => {
    const { leagueId, commissioner } = await seedLeague({ startTrigger: "when_full", isPublicMatchmade: true });
    await db.insert(users).values({ id: "joiner", email: "joiner@test.local", displayName: "Joiner" }).onConflictDoNothing();
    await db.insert(teams).values({ id: "extra_team", leagueId, userId: "joiner", name: "Joiner's Team" });

    const view = await draftScheduleView(db, leagueId, commissioner);
    expect(view).toMatchObject({ startTrigger: "when_full", filledTeams: 2 });
  });

  // Task 6, Phase 3.5: NFFC's Kentucky Derby System.
  describe("slotPreference", () => {
    it("is null for a caller with no team in this league", async () => {
      const { leagueId } = await seedLeague();
      const view = await draftScheduleView(db, leagueId, "a_total_stranger");
      expect(view?.slotPreference).toBeNull();
    });

    it("carries an empty ranking, editable, and no assigned slot yet, before anyone has ranked anything", async () => {
      const { leagueId, commissioner } = await seedLeague();
      const view = await draftScheduleView(db, leagueId, commissioner);
      expect(view?.slotPreference).toEqual({
        slotCount: LEAGUE_CONFIG.defaults.teamCount,
        ranking: [],
        assignedSlot: null,
        canEdit: true,
      });
    });

    it("carries the caller's own saved ranking, and nobody else's", async () => {
      const { leagueId, commissioner } = await seedLeague();
      await setSlotPreference(db, { leagueId, userId: commissioner, ranking: [1, 5] });
      const view = await draftScheduleView(db, leagueId, commissioner);
      expect(view?.slotPreference?.ranking).toEqual([1, 5]);
    });

    it("stops being editable and reports the caller's own drafted slot, once the draft starts", async () => {
      const { leagueId, commissioner } = await seedLeague();
      const before = await draftScheduleView(db, leagueId, commissioner);
      const draftId = before!.draftId;
      const [commissionerTeam] = await db.select({ id: teams.id }).from(teams).where(eq(teams.userId, commissioner));

      // The draw's own snapshot — `resolvedSlotFor`'s ONLY source of truth (ruling 27), written
      // here directly rather than through a full `store.startDraft()` run, which would need a
      // real player pool sized for `LEAGUE_CONFIG.defaults.teamCount` (12) teams' worth of
      // rosters. Slot 3 (index 2): the commissioner's team drafted third.
      await db.insert(draftActions).values({
        draftId,
        sequence: 1,
        timestamp: new Date(FIXED_NOW),
        action: {
          v: DRAFT_ACTION_VERSION,
          type: "START_DRAFT",
          timestamp: FIXED_NOW,
          draftOrder: ["some_other_team", "another_team", commissionerTeam!.id],
          pool: [{ playerId: "p1", position: "QB" }],
          minBid: 1,
          skipPolicy: DRAFT_SKIP_POLICY,
        },
      });
      await db.update(drafts).set({ status: "in_progress" }).where(eq(drafts.id, draftId));

      const after = await draftScheduleView(db, leagueId, commissioner);

      expect(after?.slotPreference?.canEdit).toBe(false);
      expect(after?.slotPreference?.assignedSlot).toBe(3);
    });

    // `resolvedSlotFor`'s own defensive branches — every one "cannot happen through ordinary
    // use" per its docblock, and every one still worth a real assertion rather than a comment.
    it("reports no assigned slot when the draft has started but its own snapshot row is missing", async () => {
      const { leagueId, commissioner } = await seedLeague();
      const before = await draftScheduleView(db, leagueId, commissioner);
      await db.update(drafts).set({ status: "in_progress" }).where(eq(drafts.id, before!.draftId));

      const after = await draftScheduleView(db, leagueId, commissioner);

      expect(after?.slotPreference?.canEdit).toBe(false);
      expect(after?.slotPreference?.assignedSlot).toBeNull();
    });

    it("reports no assigned slot when the sequence-1 row isn't a START_DRAFT action", async () => {
      const { leagueId, commissioner } = await seedLeague();
      const before = await draftScheduleView(db, leagueId, commissioner);
      const draftId = before!.draftId;
      await db.insert(draftActions).values({
        draftId,
        sequence: 1,
        timestamp: new Date(FIXED_NOW),
        action: { v: DRAFT_ACTION_VERSION, type: "MAKE_PICK", timestamp: FIXED_NOW, teamId: "whoever", playerId: "p1" },
      });
      await db.update(drafts).set({ status: "in_progress" }).where(eq(drafts.id, draftId));

      const after = await draftScheduleView(db, leagueId, commissioner);

      expect(after?.slotPreference?.assignedSlot).toBeNull();
    });

    it("reports no assigned slot when the caller's team is missing from the draw's own snapshot", async () => {
      const { leagueId, commissioner } = await seedLeague();
      const before = await draftScheduleView(db, leagueId, commissioner);
      const draftId = before!.draftId;
      await db.insert(draftActions).values({
        draftId,
        sequence: 1,
        timestamp: new Date(FIXED_NOW),
        action: {
          v: DRAFT_ACTION_VERSION,
          type: "START_DRAFT",
          timestamp: FIXED_NOW,
          draftOrder: ["some_other_team", "another_team"],
          pool: [{ playerId: "p1", position: "QB" }],
          minBid: 1,
          skipPolicy: DRAFT_SKIP_POLICY,
        },
      });
      await db.update(drafts).set({ status: "in_progress" }).where(eq(drafts.id, draftId));

      const after = await draftScheduleView(db, leagueId, commissioner);

      expect(after?.slotPreference?.assignedSlot).toBeNull();
    });
  });
});

describe("setDraftKickoff", () => {
  it("lets the commissioner move the time while the draft is still scheduled", async () => {
    const { leagueId, commissioner } = await seedLeague();
    const result = await setDraftKickoff(db, { leagueId, userId: commissioner, kickoffAt: LATER }, clock);
    expect(result).toMatchObject({ ok: true, kickoffAt: LATER });
    expect(await kickoffOf(leagueId)).toBe(LATER);
  });

  it("refuses to move it once the draft has started, and says why", async () => {
    const { leagueId, commissioner } = await seedLeague();
    await db.update(drafts).set({ status: "in_progress" }).where(eq(drafts.leagueId, leagueId));
    const before = await kickoffOf(leagueId);

    const result = await setDraftKickoff(db, { leagueId, userId: commissioner, kickoffAt: LATER }, clock);
    expect(result).toEqual({ ok: false, status: 409, reason: KICKOFF_REFUSALS.alreadyStarted });
    expect(await kickoffOf(leagueId)).toBe(before);
  });

  it("refuses a string that isn't a real ISO instant", async () => {
    const { leagueId, commissioner } = await seedLeague();
    const result = await setDraftKickoff(db, { leagueId, userId: commissioner, kickoffAt: "not a date" }, clock);
    expect(result).toEqual({ ok: false, status: 422, reason: "That doesn't look like a valid time." });
  });

  it("refuses a time in the past", async () => {
    const { leagueId, commissioner } = await seedLeague();
    const result = await setDraftKickoff(db, { leagueId, userId: commissioner, kickoffAt: YESTERDAY }, clock);
    expect(result).toEqual({ ok: false, status: 422, reason: KICKOFF_REFUSALS.past });
  });

  it("refuses a time further out than the clock schedule can describe, and names the ceiling", async () => {
    const { leagueId, commissioner } = await seedLeague();
    const result = await setDraftKickoff(db, { leagueId, userId: commissioner, kickoffAt: NEXT_YEAR }, clock);
    expect(result).toMatchObject({ ok: false, status: 422 });
    if (result.ok) throw new Error("expected a refusal");
    expect(result.reason).toContain("60 days");
  });

  it("answers 404 to a member who is not the commissioner, never 403", async () => {
    const { leagueId } = await seedLeague({ commissionerUserId: "commish2", otherUserId: "ordinary" });
    const result = await setDraftKickoff(db, { leagueId, userId: "ordinary", kickoffAt: LATER }, clock);
    expect(result).toMatchObject({ ok: false, status: 404 });
  });

  it("answers 404 for a league that doesn't exist", async () => {
    const result = await setDraftKickoff(db, { leagueId: "nope", userId: "whoever", kickoffAt: LATER }, clock);
    expect(result).toMatchObject({ ok: false, status: 404 });
  });

  it("writes nothing when a reschedule is refused", async () => {
    const { leagueId, commissioner } = await seedLeague();
    const before = await kickoffOf(leagueId);
    await setDraftKickoff(db, { leagueId, userId: commissioner, kickoffAt: YESTERDAY }, clock);
    expect(await kickoffOf(leagueId)).toBe(before);
    expect(await statusOf(leagueId)).toBe("scheduled");
  });

  // Phase 3.5, Task 7: a time nobody chose is not a time anybody may edit.
  it("refuses to move a sit-and-go draft's time by hand, and writes nothing", async () => {
    const { leagueId, commissioner } = await seedLeague({ startTrigger: "when_full", isPublicMatchmade: true });
    const before = await kickoffOf(leagueId);
    const result = await setDraftKickoff(db, { leagueId, userId: commissioner, kickoffAt: LATER }, clock);
    expect(result).toEqual({ ok: false, status: 409, reason: KICKOFF_REFUSALS.whenFull });
    expect(await kickoffOf(leagueId)).toBe(before);
  });

  // Phase 3.5 addendum, Task 12: the catalog chose this draft's time, not any member — the same
  // generalization Task 7's `whenFull` made, applied to a league that never had a commissioner
  // to choose one in the first place. Answered to an ORDINARY member (not a would-be commissioner
  // who lost a comparison), because a house league has none for the earlier gate to single out.
  it("refuses to move a house league's draft time, and says why rather than 404ing a real member", async () => {
    await seedHouseLeague("lg_house_kickoff", "u_house_member");
    const before = await kickoffOf("lg_house_kickoff");
    const result = await setDraftKickoff(db, { leagueId: "lg_house_kickoff", userId: "u_house_member", kickoffAt: LATER }, clock);
    expect(result).toEqual({ ok: false, status: 409, reason: HOUSE_AUTHORITY_REFUSALS.schedule });
    expect(await kickoffOf("lg_house_kickoff")).toBe(before);
  });

  it("refuses a house league's draft time for a total stranger too, the same true reason", async () => {
    await seedHouseLeague("lg_house_kickoff_stranger", "u_house_member2");
    const result = await setDraftKickoff(db, { leagueId: "lg_house_kickoff_stranger", userId: "u_total_stranger", kickoffAt: LATER }, clock);
    expect(result).toEqual({ ok: false, status: 409, reason: HOUSE_AUTHORITY_REFUSALS.schedule });
  });
});
