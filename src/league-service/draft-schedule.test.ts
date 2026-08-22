import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, truncateAll } from "@/db/test-db";
import { drafts, users } from "@/db/schema";
import { STANDARD_ROSTER_SLOTS } from "@/domain/roster";
import { LEAGUE_CONFIG } from "@/league";
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

async function seedLeague(input: { readonly commissionerUserId?: string; readonly otherUserId?: string } = {}): Promise<{
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
    commissionerUserId: commissioner,
    teamName: "Commissioner's Team",
    experienceTier: "beginner",
    stakeTier: 0,
    isPublicMatchmade: false,
  });
  if (!created.ok) throw new Error(created.reason);
  return { leagueId: created.leagueId, commissioner };
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
    const { leagueId } = await seedLeague();
    const view = await draftScheduleView(db, leagueId);
    expect(view).toMatchObject({ leagueId, status: "scheduled", isPublicMatchmade: false });
    expect(view?.kickoffAt).toBe(await kickoffOf(leagueId));
  });

  it("answers null for a league that doesn't exist", async () => {
    expect(await draftScheduleView(db, "nope")).toBeNull();
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
});
