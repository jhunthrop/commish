import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { upsertCoachRows } from "@research-ts/coaches/store";
import { countingDb, createTestDb } from "@research-ts/db/test-db";
import { truncateAll } from "@/db/test-db";
import { captureSnapshots, nflGames, playerCrosswalk, players, preseasonProjections } from "@research-ts/db/schema";
import { recordTeamDefenseWeekRows } from "@research-ts/projections/nflverse/team-defense-weeks";
import { BOARD_SOURCE } from "@research-ts/projections/preseason/board-store";
import { PRODUCT_SEASON } from "@research-ts/projections/preseason/current";
import { DEPTH_METRIC, DEPTH_SOURCE } from "@research-ts/projections/preseason/depth";
import { recordObservations } from "@research-ts/projections/store";
import { recordPlayerTeams, recordTeamObservations } from "@research-ts/projections/team-store";
import { recordNflPlayers } from "@research-ts/projections/universe";
import { teamPage, TEAM_PRIOR_SEASON } from "./service";

/**
 * The service over a REAL database, the way the coordinator asked: one club seeded with every
 * section the store can hold, one with nothing, and a warm read that costs no statement. The
 * coaching section reads the `coaches` TABLE (coaches-table round, 2026-09-08), seeded here with
 * Detroit's two most recent tenures as the committed file states them, never the file itself.
 */
const base = createTestDb();

const PRIOR = TEAM_PRIOR_SEASON;
const KNOWABLE = new Date("2026-01-15T00:00:00.000Z");
const CAPTURED = new Date("2026-09-05T11:34:18.000Z");
const GIBBS_NFL = "00-0039915";

async function seedDetroit(): Promise<void> {
  await upsertCoachRows(base, [
    { season: PRIOR, team: "DET", name: "Ben Johnson", role: "OC", startWeek: 1, endWeek: 18, source: "wikipedia", note: "", headCoach: "", headCoachFirstSeason: null },
    { season: PRODUCT_SEASON, team: "DET", name: "John Morton", role: "OC", startWeek: 1, endWeek: 18, source: "wikipedia", note: "", headCoach: "Dan Campbell", headCoachFirstSeason: 2021 },
  ]);
  await recordNflPlayers(base, [{ id: GIBBS_NFL, pfrId: null, espnId: "4429795", name: "Jahmyr Gibbs", position: "RB", latestTeam: "DET", rookieSeason: 2023, lastSeason: PRIOR }]);
  await base.insert(players).values([
    { id: "4429795", name: "Jahmyr Gibbs", position: "RB", nflTeam: "DET", adp: 4.1 },
    { id: "4689936", name: "Jake Bates", position: "K", nflTeam: "DET", adp: 140.5, posAdp: "K1" },
    { id: "DST-DET", name: "Detroit Lions", position: "DEF", nflTeam: "DET", adp: 150.2, posAdp: "DEF4" },
  ]);
  await base.insert(playerCrosswalk).values({ playerId: "4429795", nflPlayerId: GIBBS_NFL, method: "espn_id", resolvedAt: new Date() });
  await base.insert(preseasonProjections).values({
    season: PRODUCT_SEASON, source: BOARD_SOURCE, playerId: GIBBS_NFL, rank: 1, positionRank: 1, projectedPoints: 312.4, valueOverReplacement: 100,
    valueRank: 1, expectedGames: 17, floorPoints: 250, medianPoints: 310, ceilingPoints: 380, tier: 0, asOf: new Date("2026-08-01T00:00:00Z"), momentKind: "live",
  });
  const games = [1, 2, 3, 4, 5, 6, 7, 9, 10, 11, 12, 13, 14, 15, 16, 17].map((week) => ({
    gameId: `g${week}`, week, homeNflTeam: week % 2 === 1 ? "DET" : "NO", awayNflTeam: week % 2 === 1 ? "NO" : "DET", status: "scheduled" as const,
  }));
  await base.insert(nflGames).values(games);
  const teamRow = (team: string, week: number, source: string, metric: string, value: number, asOf = KNOWABLE) => ({ season: PRIOR, week, team, source, metric, value, asOf });
  await recordTeamObservations(base, [
    ...[1, 2].flatMap((week) => [
      teamRow("DET", week, "nflverse_pbp", "pace_seconds_per_play", 27 + week * 0.1),
      teamRow("DET", week, "nflverse_pbp", "pass_rate", 0.58),
      teamRow("DET", week, "nflverse_pbp", "pass_rate_over_expected", 2.4),
      teamRow("DET", week, "nflverse_pbp", "neutral_plays", 30),
      teamRow("MIA", week, "nflverse_pbp", "pace_seconds_per_play", 25),
      teamRow("MIA", week, "nflverse_pbp", "pass_rate", 0.64),
      teamRow("MIA", week, "nflverse_pbp", "pass_rate_over_expected", 5),
      teamRow("MIA", week, "nflverse_pbp", "neutral_plays", 28),
    ]),
    teamRow("DET", 1, "nflverse_kickoff", "game_result", 1),
    teamRow("DET", 2, "nflverse_kickoff", "game_result", 0),
    teamRow("DET", 1, "nflverse_kickoff", "points_allowed", 20),
    teamRow("DET", 2, "nflverse_kickoff", "points_allowed", 27),
    { season: PRODUCT_SEASON, week: 1, team: "DET", source: "vegas_win_totals", metric: "vegas_win_total", value: 10.5, asOf: new Date("2026-08-15T20:43:34.996Z") },
  ]);
  await recordObservations(base, [
    { season: PRODUCT_SEASON, week: 1, playerId: GIBBS_NFL, source: DEPTH_SOURCE, metric: DEPTH_METRIC, value: 1, asOf: new Date("2026-08-28T00:00:00.000Z") },
    { season: PRIOR, week: 1, playerId: GIBBS_NFL, source: "nflverse_pbp_player", metric: "pbp_carries", value: 18, asOf: KNOWABLE },
    { season: PRIOR, week: 2, playerId: GIBBS_NFL, source: "nflverse_pbp_player", metric: "pbp_carries", value: 22, asOf: KNOWABLE },
    { season: PRIOR, week: 1, playerId: GIBBS_NFL, source: "nflverse_pbp_player", metric: "pbp_targets", value: 6, asOf: KNOWABLE },
    { season: PRIOR, week: 1, playerId: GIBBS_NFL, source: "nflverse_pbp_player", metric: "red_zone_carries", value: 4, asOf: KNOWABLE },
  ]);
  await recordPlayerTeams(base, [1, 2].map((week) => ({ season: PRIOR, week, playerId: GIBBS_NFL, team: "DET", asOf: KNOWABLE })));
  await recordTeamDefenseWeekRows(base, [
    {
      season: PRIOR, week: 1, team: "DET", opponentTeam: "NO", sacks: 3, interceptions: 1, fumbleRecoveries: 1, defensiveTouchdowns: 0, safeties: 0,
      puntBlocks: 0, extraPointBlocks: 0, fieldGoalBlocks: 0, specialTeamsTouchdowns: 0, passingYardsAllowed: 200, rushingYardsAllowed: 90, sackYardsLostAllowed: 20, pointsAllowed: 20,
    },
  ]);
  await base.insert(captureSnapshots).values({
    source: "tank01_depth_charts",
    capturedAt: CAPTURED,
    digest: "fixture",
    payload: [{ teamAbv: "DET", depthChart: { RB: [{ longName: "Jahmyr Gibbs", playerID: "4429795", depthPosition: "RB1" }, { longName: "Isiah Pacheco", playerID: "4361529", depthPosition: "RB2" }] } }],
  });
}

beforeEach(async () => {
  await truncateAll(base);
});

afterAll(async () => {
  await truncateAll(base);
});

describe("teamPage", () => {
  it("assembles every section for a club the store holds everything about", async () => {
    await seedDetroit();
    const page = (await teamPage(base, "DET"))!;
    expect(page).toMatchObject({ code: "DET", city: "Detroit", nickname: "Lions", byeWeek: 8, season: PRODUCT_SEASON });
    expect(page.lastSeason).toEqual({ season: PRIOR, record: { wins: 1, losses: 1, ties: 0 }, pointsAllowed: { points: 47, games: 2 } });
    expect(page.winTotal).toEqual({ season: PRODUCT_SEASON, line: 10.5, asOf: "2026-08-15" });
    expect(page.coaching).toEqual({ season: PRODUCT_SEASON, headCoach: "Dan Campbell", headCoachIsNew: false, playCaller: "John Morton", playCallerRole: "OC", playCallerIsNew: true });
    expect(page.offense).toEqual({ season: PRIOR, pace: { value: 27.2, rank: 2, of: 2 }, passRate: { value: 0.58, rank: 2, of: 2 }, passRateOverExpected: { value: 2.4, rank: 2, of: 2 }, neutralPlays: 60 });
    expect(page.players.map((row) => row.player.id)).toEqual(["4429795", "4689936", "DST-DET"]);
    expect(page.players[0]).toMatchObject({ positionRank: 1, boardRank: 1, projectedPoints: 312.4, marketAdp: 4.1 });
    expect(page.players[2]).toMatchObject({ positionRank: 1, boardRank: null, projectedPoints: null });
    expect(page.depthCharts?.release).toEqual({ asOf: "2026-08-28", groups: [{ position: "RB", slots: [{ slot: 1, name: "Jahmyr Gibbs", playerId: "4429795" }] }] });
    expect(page.depthCharts?.harvest?.asOf).toBe("2026-09-05");
    // Pacheco is on the harvest chart but not in this fixture's `players`: named, never linked.
    expect(page.depthCharts?.harvest?.groups[0]?.slots.map((slot) => [slot.name, slot.playerId])).toEqual([
      ["Jahmyr Gibbs", "4429795"],
      ["Isiah Pacheco", null],
    ]);
    expect(page.competition).toEqual({
      season: PRIOR,
      targets: [{ nflPlayerId: GIBBS_NFL, playerId: "4429795", name: "Jahmyr Gibbs", count: 6, share: 1 }],
      carries: [{ nflPlayerId: GIBBS_NFL, playerId: "4429795", name: "Jahmyr Gibbs", count: 40, share: 1 }],
      redZoneTouches: [{ nflPlayerId: GIBBS_NFL, playerId: "4429795", name: "Jahmyr Gibbs", count: 4 }],
    });
    // Odd weeks at home: 1, 3, 5, 7, 9, 11, 13, 15, 17 (the bye week 8 is even), nine of sixteen.
    expect(page.schedule).toMatchObject({ weekOneOpponent: { week: 1, opponent: "NO", home: true }, homeGames: 9, roadGames: 7 });
    expect(page.schedule?.playoffWeeks.map((fixture) => fixture.week)).toEqual([15, 16, 17]);
    expect(page.defense).toMatchObject({ season: PRIOR, playerId: "DST-DET", games: 1, adpRank: 1, scoringLabel: "PPR" });
    expect(page.defense?.facts).toMatchObject({ kind: "DEF", sacks: 3, takeaways: 2 });
  });

  it("renders a club the store holds nothing about as absences, never zeroes", async () => {
    const page = (await teamPage(base, "TEN"))!;
    expect(page).toMatchObject({ code: "TEN", city: "Tennessee", nickname: "Titans", byeWeek: null });
    expect(page.lastSeason).toBeNull();
    expect(page.winTotal).toBeNull();
    expect(page.offense).toBeNull();
    // The coaches table holds no Tennessee tenure: absence, not a guessed staff.
    expect(page.coaching).toBeNull();
    expect(page.players).toEqual([]);
    expect(page.depthCharts).toBeNull();
    expect(page.competition).toBeNull();
    expect(page.schedule).toBeNull();
    expect(page.defense).toBeNull();
  });

  it("answers null for a code the name table does not hold", async () => {
    expect(await teamPage(base, "ZZZ")).toBeNull();
  });

  it("issues no database statement on a warm instance", async () => {
    await seedDetroit();
    await teamPage(base, "DET");
    const warm = countingDb(base);
    await teamPage(warm.db, "DET");
    expect(warm.selectCount()).toBe(0);
  });
});
