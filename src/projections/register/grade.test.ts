import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, truncateAll } from "@/db/test-db";
import type { Clock } from "@/domain/timing";
import { recordNflPlayers } from "../universe";
import type { NflPlayerRow } from "../nflverse/players";
import { SCHEDULE_METRICS, SCHEDULE_SOURCE } from "../nflverse/schedule";
import { recordTeamObservations } from "../team-store";
import { recordObservations, type PlayerWeekObservation } from "../store";
import { STAT_LINE_SOURCE, statMetricName } from "../lines";
import { BOARD_SOURCE, projectionRows, recordPreseasonProjections } from "../preseason/board-store";
import type { BoardEntry } from "../preseason/board";
import { BENCHMARK_SOURCES } from "../preseason/benchmarks";
import { recordPreseasonRankings } from "../preseason/store";
import { recordPropObservations } from "../odds/props-store";
import { recordPropPlayerMap } from "../odds/player-map";
import { takeFreeze } from "./freeze";
import { gradeWeek, runningScoreboard, formatScoreboard } from "./grade";
import { gradeRowsFor } from "./store";

/**
 * GRADING IS A READ OF TWO THINGS AND A WRITE OF ONE — it reads the freeze it is grading and the
 * outcomes the week produced, and it appends graded rows. It moves nothing else, and it refuses a
 * week the store has no outcomes for rather than scoring a blank one as a tie.
 */

const db = createTestDb();

const SEASON = 2026;
const WEEK_1_KICKOFF = new Date("2026-09-10T00:20:00.000Z");
const BOARD_AS_OF = new Date("2026-09-02T03:20:39.210Z");
const FROZEN_AT = "2026-09-08T12:00:00.000Z";
const GRADED_AT = "2026-09-16T12:00:00.000Z";

const CHASE = "00-0036900";
const LAMB = "00-0036322";
const HURTS = "00-0036389";

function clockAt(iso: string): Clock {
  return { now: () => iso };
}

function player(id: string, name: string, position: string): NflPlayerRow {
  return { id, pfrId: null, espnId: null, name, position, latestTeam: "CIN", rookieSeason: 2020, lastSeason: 2026 };
}

function entry(playerId: string, points: number, rank: number): BoardEntry {
  return {
    playerId,
    position: "WR",
    projectedPoints: points,
    valueOverReplacement: points - 100,
    positionRank: rank,
    replacementLevel: 100,
    rank,
    valueRank: rank,
    team: "CIN",
    expectedGames: 16.2,
    seasonLine: { playerId, week: 0 } as BoardEntry["seasonLine"],
    outlook: { floor: points - 40, median: points, ceiling: points + 40 },
    tier: 0,
    playersLeftInTier: 4,
    dropToNextTier: 18.3,
    reasons: [],
  };
}

const STATS_AS_OF = new Date("2026-09-15T12:00:00.000Z");

function statRows(week: number, playerId: string, fields: Readonly<Record<string, number>>): readonly PlayerWeekObservation[] {
  return Object.entries(fields).map(([field, value]) => ({
    season: SEASON,
    week,
    playerId,
    source: STAT_LINE_SOURCE,
    metric: statMetricName(field),
    value,
    asOf: STATS_AS_OF,
  }));
}

async function seedThroughFreeze(): Promise<Date> {
  await recordNflPlayers(db, [
    player(CHASE, "Ja'Marr Chase", "WR"),
    player(LAMB, "CeeDee Lamb", "WR"),
    player(HURTS, "Jalen Hurts", "QB"),
  ]);
  await recordTeamObservations(db, [
    {
      season: SEASON,
      week: 1,
      team: "CIN",
      source: SCHEDULE_SOURCE.kickoff,
      metric: SCHEDULE_METRICS.kickoffInstant,
      value: WEEK_1_KICKOFF.getTime(),
      asOf: WEEK_1_KICKOFF,
    },
  ]);
  await recordPreseasonProjections(
    db,
    projectionRows([entry(CHASE, 326.4, 1), entry(LAMB, 301.2, 2), entry(HURTS, 288.0, 3)], {
      season: SEASON,
      source: BOARD_SOURCE,
      asOf: BOARD_AS_OF,
      momentKind: "live",
    }),
  );
  const asOf = new Date("2026-09-01T00:00:00.000Z");
  await recordPreseasonRankings(db, [
    { season: SEASON, source: BENCHMARK_SOURCES.adp, playerId: CHASE, rank: 1.4, asOf },
    { season: SEASON, source: BENCHMARK_SOURCES.adp, playerId: LAMB, rank: 3.2, asOf },
    { season: SEASON, source: BENCHMARK_SOURCES.ecr, playerId: CHASE, rank: 2, asOf },
    { season: SEASON, source: BENCHMARK_SOURCES.ecr, playerId: HURTS, rank: 21, asOf },
  ]);
  await recordPropObservations(db, [
    {
      eventId: "evt-week-1",
      commenceTime: new Date("2026-09-14T00:20:00.000Z"),
      bookmaker: "draftkings",
      market: "player_reception_yds",
      playerName: "Ja'Marr Chase",
      point: 70.5,
      overPrice: -115,
      underPrice: -105,
      fetchedAt: new Date("2026-09-08T09:00:00.000Z"),
    },
  ]);
  await recordPropPlayerMap(db, [{ propName: "Ja'Marr Chase", season: SEASON, playerId: CHASE, method: "exact" }]);
  const { frozenAt } = await takeFreeze(db, { season: SEASON, week: 1 }, clockAt(FROZEN_AT));
  return frozenAt;
}

async function seedOutcomes(): Promise<void> {
  await recordObservations(db, [
    ...statRows(1, CHASE, { receptions: 8, receivingYards: 120, receivingTouchdowns: 1 }),
    ...statRows(1, LAMB, { receptions: 5, receivingYards: 50 }),
    ...statRows(1, HURTS, { passingYards: 300, passingTouchdowns: 2 }),
  ]);
}

beforeEach(async () => {
  await truncateAll(db);
});

afterAll(async () => {
  await truncateAll(db);
});

describe("gradeWeek — it runs only for a week the store has outcomes for", () => {
  it("refuses a week with no stat lines rather than scoring an empty week", async () => {
    await seedThroughFreeze();
    await expect(gradeWeek(db, { season: SEASON, week: 1 }, clockAt(GRADED_AT))).rejects.toThrow(/no outcomes/i);
  });

  it("refuses a week with no freeze to grade", async () => {
    await seedThroughFreeze();
    await seedOutcomes();
    await expect(gradeWeek(db, { season: SEASON, week: 3 }, clockAt(GRADED_AT))).rejects.toThrow(/no freeze/i);
  });
});

describe("gradeWeek — the graded rows", () => {
  it("keys every graded row to the exact freeze instant it grades", async () => {
    const frozenAt = await seedThroughFreeze();
    await seedOutcomes();
    const grade = await gradeWeek(db, { season: SEASON, week: 1 }, clockAt(GRADED_AT));
    expect(grade.frozenAt.toISOString()).toBe(frozenAt.toISOString());
    expect(grade.rows.every((row) => row.frozenAt.getTime() === frozenAt.getTime())).toBe(true);
    expect(grade.rows.every((row) => row.gradedAt.toISOString() === GRADED_AT)).toBe(true);
  });

  it("computes each player's actual points under the register's own scoring rules", async () => {
    await seedThroughFreeze();
    await seedOutcomes();
    const { rows } = await gradeWeek(db, { season: SEASON, week: 1 }, clockAt(GRADED_AT));
    const byPlayer = new Map(rows.map((row) => [row.playerId, row]));
    // PPR: 8 receptions + 12.0 receiving yards + 6 receiving TD.
    expect(byPlayer.get(CHASE)?.actualPoints).toBeCloseTo(26, 6);
    expect(byPlayer.get(LAMB)?.actualPoints).toBeCloseTo(10, 6);
    expect(byPlayer.get(HURTS)?.actualPoints).toBeCloseTo(20, 6);
  });

  it("ranks the outcome and every covered column, leaving an uncovered column null", async () => {
    await seedThroughFreeze();
    await seedOutcomes();
    const { rows } = await gradeWeek(db, { season: SEASON, week: 1 }, clockAt(GRADED_AT));
    const byPlayer = new Map(rows.map((row) => [row.playerId, row]));
    expect(byPlayer.get(CHASE)?.actualRank).toBe(1);
    expect(byPlayer.get(HURTS)?.actualRank).toBe(2);
    expect(byPlayer.get(LAMB)?.actualRank).toBe(3);

    expect(byPlayer.get(CHASE)?.boardRank).toBe(1);
    expect(byPlayer.get(LAMB)?.boardRank).toBe(2);
    expect(byPlayer.get(HURTS)?.boardRank).toBe(3);

    expect(byPlayer.get(CHASE)?.adpRank).toBe(1);
    expect(byPlayer.get(LAMB)?.adpRank).toBe(2);
    expect(byPlayer.get(HURTS)?.adpRank).toBeNull();

    expect(byPlayer.get(CHASE)?.ecrRank).toBe(1);
    expect(byPlayer.get(HURTS)?.ecrRank).toBe(2);
    expect(byPlayer.get(LAMB)?.ecrRank).toBeNull();

    expect(byPlayer.get(CHASE)?.propsRank).toBe(1);
    expect(byPlayer.get(LAMB)?.propsRank).toBeNull();
    expect(byPlayer.get(HURTS)?.propsRank).toBeNull();
  });

  it("grades only the frozen players the week actually produced an outcome for", async () => {
    await seedThroughFreeze();
    await recordObservations(db, [...statRows(1, CHASE, { receptions: 8, receivingYards: 120, receivingTouchdowns: 1 })]);
    const grade = await gradeWeek(db, { season: SEASON, week: 1 }, clockAt(GRADED_AT));
    expect(grade.population).toBe(1);
    expect(grade.rows.map((row) => row.playerId)).toEqual([CHASE]);
  });

  it("appends: a re-grade is a new gradedAt and leaves the first grading's rows untouched", async () => {
    await seedThroughFreeze();
    await seedOutcomes();
    await gradeWeek(db, { season: SEASON, week: 1 }, clockAt(GRADED_AT));
    await gradeWeek(db, { season: SEASON, week: 1 }, clockAt("2026-09-17T12:00:00.000Z"));
    const stored = await gradeRowsFor(db, SEASON);
    expect(stored).toHaveLength(6);
    expect(new Set(stored.map((row) => row.gradedAt.toISOString()))).toEqual(
      new Set([GRADED_AT, "2026-09-17T12:00:00.000Z"]),
    );
  });
});

describe("gradeWeek — the per-column scores", () => {
  it("reports agreement and rank error for every column, on that column's own covered population", async () => {
    await seedThroughFreeze();
    await seedOutcomes();
    const { scores } = await gradeWeek(db, { season: SEASON, week: 1 }, clockAt(GRADED_AT));
    const byColumn = new Map(scores.map((score) => [score.column, score]));

    expect(byColumn.get("board")?.graded).toBe(3);
    expect(byColumn.get("board")?.spearman).toBeCloseTo(0.5, 6);
    expect(byColumn.get("board")?.meanAbsoluteRankError).toBeCloseTo(2 / 3, 6);

    expect(byColumn.get("adp")?.graded).toBe(2);
    expect(byColumn.get("adp")?.spearman).toBeCloseTo(1, 6);
    expect(byColumn.get("adp")?.meanAbsoluteRankError).toBeCloseTo(0, 6);

    expect(byColumn.get("ecr")?.graded).toBe(2);
    expect(byColumn.get("ecr")?.spearman).toBeCloseTo(1, 6);
    expect(byColumn.get("ecr")?.meanAbsoluteRankError).toBeCloseTo(0, 6);

    // One covered player cannot support a correlation — null, never zero.
    expect(byColumn.get("props")?.graded).toBe(1);
    expect(byColumn.get("props")?.spearman).toBeNull();
    expect(byColumn.get("props")?.meanAbsoluteRankError).toBeCloseTo(0, 6);
  });
});

describe("runningScoreboard — cumulative by column", () => {
  it("averages each column over the weeks it was graded on, and counts them", async () => {
    await seedThroughFreeze();
    await seedOutcomes();
    await gradeWeek(db, { season: SEASON, week: 1 }, clockAt(GRADED_AT));
    const board = await runningScoreboard(db, SEASON);
    const byColumn = new Map(board.map((score) => [score.column, score]));
    expect(byColumn.get("board")?.weeks).toBe(1);
    expect(byColumn.get("board")?.spearman).toBeCloseTo(0.5, 6);
    expect(byColumn.get("props")?.weeks).toBe(1);
    expect(byColumn.get("props")?.spearman).toBeNull();
  });

  it("reads only the LATEST grading of a week, so a re-grade does not double-count it", async () => {
    await seedThroughFreeze();
    await seedOutcomes();
    await gradeWeek(db, { season: SEASON, week: 1 }, clockAt(GRADED_AT));
    await gradeWeek(db, { season: SEASON, week: 1 }, clockAt("2026-09-17T12:00:00.000Z"));
    const board = await runningScoreboard(db, SEASON);
    expect(board.every((score) => score.weeks <= 1)).toBe(true);
  });

  it("prints a scoreboard naming every column, so an empty column is visible rather than missing", async () => {
    await seedThroughFreeze();
    await seedOutcomes();
    await gradeWeek(db, { season: SEASON, week: 1 }, clockAt(GRADED_AT));
    const printed = formatScoreboard(await runningScoreboard(db, SEASON));
    for (const column of ["board", "adp", "ecr", "props"]) expect(printed).toContain(column);
  });
});
