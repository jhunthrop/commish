import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { and, eq } from "drizzle-orm";
import { createTestDb, truncateAll } from "@/db/test-db";
import { drafts, matchups, players, playerStatLines, rosterSlots, teams, users } from "@/db/schema";
import { createLeague } from "./creation";
import { writeSchedule } from "./schedule";
import { leagueStandings, scoreWeek } from "./results";

const db = createTestDb();
const clock = { now: () => "2026-08-17T12:00:00.000Z" };
let nextId = 0;
const newId = () => `id_${++nextId}`;

const SLOTS = [
  { slot: "QB" as const, count: 1, eligiblePositions: ["QB" as const] },
  { slot: "BENCH" as const, count: 1, eligiblePositions: ["QB" as const] },
];

beforeEach(async () => {
  await truncateAll(db);
  nextId = 0;
});

afterAll(async () => {
  await truncateAll(db);
});

/**
 * Two teams, one QB slot each, a week-1 stat line per quarterback, and a drafted status —
 * `finalizeWeek`'s own exhaustive scoring coverage (both-sides scoring, saved-lineup override,
 * non-PPR presets, the draft guard, idempotency) lives in `src/stats-pipeline/finalize.test.ts`
 * now, since that's where the logic itself moved. What's left here only needs to prove `scoreWeek`
 * still forwards to it faithfully — including the guard, so the delegate can't quietly bypass it.
 */
async function twoTeamLeague(draftStatus: "scheduled" | "complete") {
  await db.insert(users).values([
    { id: "u1", email: "u1@test.local", displayName: "Manager 1" },
    { id: "u2", email: "u2@test.local", displayName: "Manager 2" },
  ]);
  const created = await createLeague({ db, clock, newId }, {
    name: "Duel", format: "snake", teamCount: 2, scoringPreset: "ppr", auctionBudget: null,
    rosterSlots: SLOTS, commissionerUserId: "u1", teamName: "Team One",
    experienceTier: "beginner", stakeTier: 0, isPublicMatchmade: false,
  });
  if (!created.ok) throw new Error(created.reason);
  await db.insert(teams).values({ id: "team_2", leagueId: created.leagueId, userId: "u2", name: "Team Two" });
  if (draftStatus === "complete") {
    await db.update(drafts).set({ status: "complete" }).where(eq(drafts.leagueId, created.leagueId));
  }
  await db.insert(players).values([
    { id: "qb1", name: "QB One", position: "QB", nflTeam: "KC" },
    { id: "qb2", name: "QB Two", position: "QB", nflTeam: "SF" },
  ]);
  await db.insert(playerStatLines).values([
    { playerId: "qb1", week: 1, passingYards: 300, passingTouchdowns: 3 },
    { playerId: "qb2", week: 1, passingYards: 100, passingTouchdowns: 0 },
  ]);
  await db.insert(rosterSlots).values([
    { teamId: created.teamId, slot: "QB", slotIndex: 0, playerId: "qb1" },
    { teamId: "team_2", slot: "QB", slotIndex: 0, playerId: "qb2" },
  ]);
  await db.transaction((tx) => writeSchedule(tx, { leagueId: created.leagueId, teamIds: [created.teamId, "team_2"], weeks: 1 }));
  return { ...created, teamIds: [created.teamId, "team_2"] };
}

describe("scoreWeek (delegate to finalizeWeek — R-B1, live until Plan B Task 8)", () => {
  it("scores a drafted league's week, matching finalizeWeek's own numbers", async () => {
    const league = await twoTeamLeague("complete");
    const result = await scoreWeek(db, league.leagueId, 1);
    expect(result).toEqual({ ok: true, weekNumber: 1, matchupsScored: 1 });

    const [row] = await db.select().from(matchups).where(and(eq(matchups.leagueId, league.leagueId), eq(matchups.weekNumber, 1)));
    // 300 * 0.04 + 3 * 4 = 24; 100 * 0.04 + 0 = 4.
    const scores = [row!.homeScore, row!.awayScore].sort((a, b) => (b ?? 0) - (a ?? 0));
    expect(scores).toEqual([24, 4]);
  });

  it("refuses an undrafted league — the delegate does not skip finalizeWeek's guard", async () => {
    const league = await twoTeamLeague("scheduled");
    expect(await scoreWeek(db, league.leagueId, 1)).toEqual({
      ok: false, status: 409, reason: "That league hasn't finished its draft yet.",
    });
  });

  it("refuses a league that doesn't exist, same as finalizeWeek", async () => {
    expect(await scoreWeek(db, "nope", 1)).toEqual({
      ok: false, status: 404, reason: "That league doesn't exist.",
    });
  });
});

describe("leagueStandings", () => {
  it("reflects the scored weeks, with team names and the clinch flag", async () => {
    const league = await twoTeamLeague("complete");
    await scoreWeek(db, league.leagueId, 1);
    const rows = await leagueStandings(db, league.leagueId);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ wins: 1, losses: 0, pointsFor: 24 });
    expect(rows[0]!.teamName).toBeTruthy();
    expect(rows.every((row) => typeof row.clinched === "boolean")).toBe(true);
  });

  it("is an empty table for a league with no teams at all", async () => {
    expect(await leagueStandings(db, "nope")).toEqual([]);
  });
});
