import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { and, eq, ne } from "drizzle-orm";
import { createTestDb } from "@research-ts/db/test-db";
import { truncateAll } from "@/db/test-db";
import { draftGrades, teams, users } from "@/db/schema";
import { STANDARD_ROSTER_SLOTS } from "@research-ts/domain/roster";
import type { GradeComponents } from "@/draft-service/grades/engine";
import { createLeague } from "./creation";
import { gradesForDraft } from "./grades";

const db = createTestDb();
const clock = { now: () => "2026-09-05T12:00:00.000Z" };
let nextId = 0;
const newId = () => `id_${++nextId}`;

const COMPONENTS: GradeComponents = {
  valueCaptured: -4.2,
  startingSlotsFilled: 9,
  startingSlotsTotal: 9,
  byeCollisions: 0,
  projectedPoints: 118.4,
};

/** A two-team league — `createLeague` mints the commissioner's own team, and this seeds a
 *  second one by hand, the same shape `seat/route.test.ts`'s own `scheduledLeague` fixture uses. */
async function league(): Promise<{ readonly leagueId: string; readonly draftId: string }> {
  await db.insert(users).values([
    { id: "u1", email: "u1@test.local", displayName: "Manager 1" },
    { id: "u2", email: "u2@test.local", displayName: "Manager 2" },
  ]);
  const created = await createLeague({ db, clock, newId }, {
    name: "Sunday Money", format: "snake", teamCount: 2, scoringPreset: "ppr",
    auctionBudget: null, rosterSlots: STANDARD_ROSTER_SLOTS, owner: { kind: "member", userId: "u1", teamName: "Team One" },
    experienceTier: "beginner", stakeTier: 0, isPublicMatchmade: false,
  });
  if (!created.ok) throw new Error(created.reason);
  await db.insert(teams).values({ id: "team_2", leagueId: created.leagueId, userId: "u2", name: "Team Two" });
  return { leagueId: created.leagueId, draftId: created.draftId };
}

beforeEach(async () => {
  await truncateAll(db);
  nextId = 0;
});

afterAll(async () => {
  await truncateAll(db);
});

describe("gradesForDraft", () => {
  it("answers empty for a draft with no stored grades — never a crash on a job that hasn't run yet", async () => {
    const { draftId } = await league();
    const read = await gradesForDraft(db, draftId);
    expect(read).toEqual({ grades: [], boardGeneration: null });
  });

  it("joins the stored grade to its team name and carries the board generation it was computed against", async () => {
    const { leagueId, draftId } = await league();
    await db.insert(draftGrades).values({
      draftId, leagueId, teamId: "team_2", letter: "C", components: COMPONENTS, projectedRank: 2,
      boardGeneration: "2026-08-01T00:00:00.000Z",
    });

    const read = await gradesForDraft(db, draftId);
    expect(read.boardGeneration).toBe("2026-08-01T00:00:00.000Z");
    expect(read.grades).toEqual([
      { teamId: "team_2", teamName: "Team Two", letter: "C", components: COMPONENTS, projectedRank: 2 },
    ]);
  });

  it("orders multiple teams by projected rank ascending, not insertion order", async () => {
    const { leagueId, draftId } = await league();
    // The commissioner's own seat, minted by `createLeague` in the same transaction — every
    // other team in this league besides the one seeded by hand above.
    const [commissionerTeam] = await db.select({ id: teams.id }).from(teams).where(and(eq(teams.leagueId, leagueId), ne(teams.id, "team_2")));

    await db.insert(draftGrades).values([
      { draftId, leagueId, teamId: "team_2", letter: "A", components: COMPONENTS, projectedRank: 1, boardGeneration: "2026-08-01T00:00:00.000Z" },
      { draftId, leagueId, teamId: commissionerTeam!.id, letter: "D", components: COMPONENTS, projectedRank: 2, boardGeneration: "2026-08-01T00:00:00.000Z" },
    ]);

    const read = await gradesForDraft(db, draftId);
    expect(read.grades.map((g) => g.projectedRank)).toEqual([1, 2]);
    expect(read.grades.map((g) => g.teamId)).toEqual(["team_2", commissionerTeam!.id]);
  });
});
