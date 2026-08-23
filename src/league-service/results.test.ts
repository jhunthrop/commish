import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, truncateAll } from "@/db/test-db";
import { drafts, players, playerStatLines, rosterSlots, teams, users, weeks } from "@/db/schema";
import { listTeamCards } from "@/draft-service/teams";
import { finalizeWeek } from "@/stats-pipeline/finalize";
import { createLeague } from "./creation";
import { writeSchedule } from "./schedule";
import { leagueStandings } from "./results";

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
 * Two teams, one QB slot each, a week-1 stat line per quarterback, and a drafted status.
 * `finalizeWeek`'s own exhaustive scoring coverage (both-sides scoring, saved-lineup override,
 * non-PPR presets, the draft guard, idempotency) lives in `src/stats-pipeline/finalize.test.ts` —
 * this fixture exists only to give `leagueStandings` below a real scored week to read.
 */
async function twoTeamLeague(draftStatus: "scheduled" | "complete", medianGame = false) {
  await db.insert(users).values([
    { id: "u1", email: "u1@test.local", displayName: "Manager 1" },
    { id: "u2", email: "u2@test.local", displayName: "Manager 2" },
  ]);
  const created = await createLeague({ db, clock, newId }, {
    name: "Duel", format: "snake", teamCount: 2, scoringPreset: "ppr", auctionBudget: null,
    rosterSlots: SLOTS, owner: { kind: "member", userId: "u1", teamName: "Team One" },
    experienceTier: "beginner", stakeTier: 0, isPublicMatchmade: false, medianGame,
  });
  if (!created.ok) throw new Error(created.reason);
  const teamId = created.teamId;
  if (teamId === null) throw new Error("expected a team id");
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
    { teamId, slot: "QB", slotIndex: 0, playerId: "qb1" },
    { teamId: "team_2", slot: "QB", slotIndex: 0, playerId: "qb2" },
  ]);
  await db.transaction((tx) => writeSchedule(tx, { leagueId: created.leagueId, teamIds: [teamId, "team_2"], weeks: 1 }));
  return { ...created, teamId, teamIds: [teamId, "team_2"] };
}

describe("leagueStandings", () => {
  it("reflects the scored weeks, with team names, the owner's face, and the clinch flag", async () => {
    const league = await twoTeamLeague("complete");
    await finalizeWeek(db, league.leagueId, 1);
    const teamCards = await listTeamCards(db, league.leagueId);
    const rows = await leagueStandings(db, league.leagueId, teamCards, false);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ wins: 1, losses: 0, pointsFor: 24 });
    expect(rows[0]!.teamName).toBeTruthy();
    expect(rows[0]!.ownerDisplayName).toBeTruthy();
    expect(rows.every((row) => typeof row.clinched === "boolean")).toBe(true);
  });

  it("is an empty table for a league with no teams at all", async () => {
    expect(await leagueStandings(db, "nope", [], false)).toEqual([]);
  });

  it("folds the median game's own result into wins and losses for a league with the toggle on", async () => {
    const league = await twoTeamLeague("complete", true);
    await finalizeWeek(db, league.leagueId, 1);

    const [weekRow] = await db.select({ medianScore: weeks.medianScore }).from(weeks).where(eq(weeks.leagueId, league.leagueId));
    expect(weekRow?.medianScore).not.toBeNull();

    const teamCards = await listTeamCards(db, league.leagueId);
    const rows = await leagueStandings(db, league.leagueId, teamCards, true);
    // Two teams, one head-to-head result each PLUS one median result each: the winner of the
    // head-to-head also clears the median (it's the higher of the two scores averaged), so it
    // goes 2-0 rather than 1-0, and the loser goes 0-2 rather than 0-1.
    const winner = rows.find((row) => row.wins > 0)!;
    const loser = rows.find((row) => row.wins === 0)!;
    expect(winner).toMatchObject({ wins: 2, losses: 0 });
    expect(loser).toMatchObject({ wins: 0, losses: 2 });
  });

  it("writes no second result when the toggle is off", async () => {
    const league = await twoTeamLeague("complete", false);
    await finalizeWeek(db, league.leagueId, 1);
    const teamCards = await listTeamCards(db, league.leagueId);
    const rows = await leagueStandings(db, league.leagueId, teamCards, false);
    const winner = rows.find((row) => row.wins > 0)!;
    expect(winner).toMatchObject({ wins: 1, losses: 0 });
  });
});
