import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { and, eq } from "drizzle-orm";
import { createTestDb, truncateAll } from "@/db/test-db";
import { lineupSlots, matchups, players, playerStatLines, rosterSlots, teams, users } from "@/db/schema";
import type { ScoringPresetName } from "@/domain/scoring";
import { HALF_PPR_SCORING, PPR_SCORING } from "@/domain/scoring";
import { computeFantasyPoints } from "@/scoring";
import { createLeague } from "./creation";
import { writeSchedule } from "./schedule";
import { leagueStandings, scoreWeek } from "./results";

const db = createTestDb();
const clock = { now: () => "2026-08-17T12:00:00.000Z" };
let nextId = 0;
const newId = () => `id_${++nextId}`;

// A WR slot rides along unused by the existing scoreWeek assertions below (an empty starting
// slot just scores nothing — `scoreTeam` doesn't validate legality, it only sums whatever
// starters exist) so the non-PPR regression test can field a receiver without a second fixture.
const SLOTS = [
  { slot: "QB" as const, count: 1, eligiblePositions: ["QB" as const] },
  { slot: "WR" as const, count: 1, eligiblePositions: ["WR" as const] },
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
 * Two teams, one QB slot each, one bench each, and a week-1 stat line per quarterback.
 * `scoringPreset` defaults to `"ppr"` for the existing scoreWeek assertions below; the
 * non-PPR regression test passes its own preset so `scoreWeek` is proven to read the
 * league's own `scoring_settings` row rather than a hardcoded fallback.
 */
async function twoTeamLeague(scoringPreset: ScoringPresetName = "ppr") {
  await db.insert(users).values([
    { id: "u1", email: "u1@test.local", displayName: "Manager 1" },
    { id: "u2", email: "u2@test.local", displayName: "Manager 2" },
  ]);
  const created = await createLeague({ db, clock, newId }, {
    name: "Duel", format: "snake", teamCount: 2, scoringPreset, auctionBudget: null,
    rosterSlots: SLOTS, commissionerUserId: "u1", teamName: "Team One",
    experienceTier: "beginner", stakeTier: 0, isPublicMatchmade: false,
  });
  if (!created.ok) throw new Error(created.reason);
  await db.insert(teams).values({ id: "team_2", leagueId: created.leagueId, userId: "u2", name: "Team Two" });

  await db.insert(players).values([
    { id: "qb1", name: "QB One", position: "QB", nflTeam: "KC" },
    { id: "qb2", name: "QB Two", position: "QB", nflTeam: "SF" },
    { id: "qb3", name: "QB Three", position: "QB", nflTeam: "NYJ" },
  ]);
  await db.insert(playerStatLines).values([
    { playerId: "qb1", week: 1, passingYards: 300, passingTouchdowns: 3 },
    { playerId: "qb2", week: 1, passingYards: 100, passingTouchdowns: 0 },
    { playerId: "qb3", week: 1, passingYards: 400, passingTouchdowns: 4 },
  ]);
  await db.insert(rosterSlots).values([
    { teamId: created.teamId, slot: "QB", slotIndex: 0, playerId: "qb1" },
    { teamId: created.teamId, slot: "BENCH", slotIndex: 0, playerId: "qb3" },
    { teamId: "team_2", slot: "QB", slotIndex: 0, playerId: "qb2" },
  ]);
  await db.transaction((tx) => writeSchedule(tx, { leagueId: created.leagueId, teamIds: [created.teamId, "team_2"], weeks: 2 }));
  return { ...created, teamIds: [created.teamId, "team_2"] };
}

describe("scoreWeek", () => {
  it("scores both sides from the mock stat lines and writes the result", async () => {
    const league = await twoTeamLeague();
    const result = await scoreWeek(db, league.leagueId, 1);
    expect(result).toEqual({ ok: true, weekNumber: 1, matchupsScored: 1 });

    const [row] = await db.select().from(matchups).where(and(eq(matchups.leagueId, league.leagueId), eq(matchups.weekNumber, 1)));
    // 300 * 0.04 + 3 * 4 = 24; 100 * 0.04 + 0 = 4. The bench QB never counts.
    const scores = [row!.homeScore, row!.awayScore].sort((a, b) => (b ?? 0) - (a ?? 0));
    expect(scores).toEqual([24, 4]);
  });

  it("uses a manager's saved lineup over the drafted default", async () => {
    const league = await twoTeamLeague();
    // Start the bench QB instead: 400 * 0.04 + 4 * 4 = 32.
    await db.insert(lineupSlots).values([
      { teamId: league.teamId, weekNumber: 1, slot: "QB", slotIndex: 0, playerId: "qb3" },
      { teamId: league.teamId, weekNumber: 1, slot: "BENCH", slotIndex: 0, playerId: "qb1" },
    ]);
    await scoreWeek(db, league.leagueId, 1);
    const [row] = await db.select().from(matchups).where(and(eq(matchups.leagueId, league.leagueId), eq(matchups.weekNumber, 1)));
    expect([row!.homeScore, row!.awayScore]).toContain(32);
  });

  it("scores a week with no stat lines as zero rather than failing", async () => {
    const league = await twoTeamLeague();
    const result = await scoreWeek(db, league.leagueId, 2);
    expect(result).toEqual({ ok: true, weekNumber: 2, matchupsScored: 1 });
    const [row] = await db.select().from(matchups).where(and(eq(matchups.leagueId, league.leagueId), eq(matchups.weekNumber, 2)));
    expect([row!.homeScore, row!.awayScore]).toEqual([0, 0]);
  });

  it("is idempotent — re-scoring a week produces the same numbers", async () => {
    const league = await twoTeamLeague();
    await scoreWeek(db, league.leagueId, 1);
    const [first] = await db.select().from(matchups).where(and(eq(matchups.leagueId, league.leagueId), eq(matchups.weekNumber, 1)));
    await scoreWeek(db, league.leagueId, 1);
    const [second] = await db.select().from(matchups).where(and(eq(matchups.leagueId, league.leagueId), eq(matchups.weekNumber, 1)));
    expect(second).toEqual(first);
  });

  it("refuses a week the league does not have", async () => {
    const league = await twoTeamLeague();
    expect(await scoreWeek(db, league.leagueId, 9)).toEqual({
      ok: false, status: 404, reason: "That week isn't part of this league's season.",
    });
  });

  it("refuses a league that doesn't exist", async () => {
    expect(await scoreWeek(db, "nope", 1)).toEqual({
      ok: false, status: 404, reason: "That league doesn't exist.",
    });
  });

  it("scores by the league's own (non-PPR) preset, not the fallback PPR rules", async () => {
    const league = await twoTeamLeague("half_ppr");
    await db.insert(players).values({ id: "wr1", name: "WR One", position: "WR", nflTeam: "MIA" });
    await db.insert(rosterSlots).values({ teamId: league.teamId, slot: "WR", slotIndex: 0, playerId: "wr1" });
    await db.insert(playerStatLines).values({ playerId: "wr1", week: 1, receivingYards: 50, receptions: 5 });

    await scoreWeek(db, league.leagueId, 1);
    const [row] = await db.select().from(matchups).where(and(eq(matchups.leagueId, league.leagueId), eq(matchups.weekNumber, 1)));
    const ourScore = row!.homeTeamId === league.teamId ? row!.homeScore : row!.awayScore;

    const [qb1Line] = await db.select().from(playerStatLines).where(eq(playerStatLines.playerId, "qb1"));
    const [wr1Line] = await db.select().from(playerStatLines).where(eq(playerStatLines.playerId, "wr1"));
    const halfPprExpected =
      computeFantasyPoints(qb1Line!, "QB", HALF_PPR_SCORING) + computeFantasyPoints(wr1Line!, "WR", HALF_PPR_SCORING);
    const pprExpected =
      computeFantasyPoints(qb1Line!, "QB", PPR_SCORING) + computeFantasyPoints(wr1Line!, "WR", PPR_SCORING);

    // 5 receptions is worth 2.5 points under half-PPR and 5 under full PPR — the two rule
    // sets must disagree, or this test would prove nothing about which one `scoreWeek` used.
    expect(halfPprExpected).not.toBe(pprExpected);
    expect(ourScore).toBe(halfPprExpected);
    expect(ourScore).not.toBe(pprExpected);
  });
});

describe("leagueStandings", () => {
  it("reflects the scored weeks, with team names and the clinch flag", async () => {
    const league = await twoTeamLeague();
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
