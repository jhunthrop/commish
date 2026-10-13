import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, truncateAll } from "@research-ts/db/test-db";
import type { Clock } from "@research-ts/domain/timing";
import { recordNflPlayers } from "../universe";
import type { NflPlayerRow } from "../nflverse/players";
import { SCHEDULE_METRICS, SCHEDULE_SOURCE } from "../nflverse/schedule";
import { recordTeamObservations } from "../team-store";
import { recordObservations, type PlayerWeekObservation } from "../store";
import { STAT_LINE_SOURCE, statMetricName } from "../lines";
import { BOARD_SOURCE, BOARD_SOURCE_V7_SHADOW, projectionRows, recordPreseasonProjections } from "../preseason/board-store";
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
const SHADOW_AS_OF = new Date("2026-09-01T11:00:00.000Z");
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

/** Seeds everything a freeze needs and takes it. `shadowBoard`, when given, is persisted under the
 *  shadow source BEFORE the freeze, so the freeze records both boards — which is the only way a
 *  shadow claim can exist at all, `takeFreeze` being the one writer. */
async function seedThroughFreeze(shadowBoard?: readonly BoardEntry[]): Promise<Date> {
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
  if (shadowBoard !== undefined) {
    await recordPreseasonProjections(
      db,
      projectionRows(shadowBoard, { season: SEASON, source: BOARD_SOURCE_V7_SHADOW, asOf: SHADOW_AS_OF, momentKind: "live" }),
    );
  }
  const { frozenAt } = await takeFreeze(db, { season: SEASON, week: 1 }, clockAt(FROZEN_AT));
  return frozenAt;
}

/** The shadow board the dual-track tests use: the same three players ORDERED DIFFERENTLY, and
 *  ordered so the two boards genuinely SCORE differently on the seeded week. The served board has
 *  CHASE-LAMB-HURTS and the week answers CHASE-HURTS-LAMB, so the served board is partly wrong; this
 *  shadow has the week exactly right. A shadow that merely differed in points while agreeing on the
 *  order would leave every assertion below passing whether or not the two boards were scored apart. */
const SHADOW_BOARD: readonly BoardEntry[] = [entry(CHASE, 330.0, 1), entry(HURTS, 320.0, 2), entry(LAMB, 200.0, 3)];

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
    const grade = await gradeWeek(db, { season: SEASON, week: 1 }, clockAt(GRADED_AT));
    const served = grade.boards.find((board) => board.boardSource === BOARD_SOURCE)!;
    const byColumn = new Map(served.scores.map((score) => [score.column, score]));

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
    const byColumn = new Map(board.filter((score) => score.boardSource === BOARD_SOURCE).map((score) => [score.column, score]));
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

/**
 * THE DUAL TRACK, GRADED (Round D). One week, one outcome read, one `gradedAt` — and one verdict per
 * board. These tests pin the properties that make the head-to-head honest: both boards are answered
 * by the same week, each is scored over its own population, the served board is the one whose
 * benchmarks the scoreboard prints, and a shadow that cannot be graded says so instead of vanishing.
 */
describe("gradeWeek — the dual track", () => {
  it("grades EVERY board the freeze recorded, served first, under one gradedAt", async () => {
    await seedThroughFreeze(SHADOW_BOARD);
    await seedOutcomes();
    const grade = await gradeWeek(db, { season: SEASON, week: 1 }, clockAt(GRADED_AT));

    expect(grade.boards.map((board) => board.boardSource)).toEqual([BOARD_SOURCE, BOARD_SOURCE_V7_SHADOW]);
    expect(grade.skipped).toEqual([]);
    expect(grade.rows).toHaveLength(6);
    expect(new Set(grade.rows.map((row) => row.gradedAt.toISOString()))).toEqual(new Set([GRADED_AT]));
    // `population` still means the SERVED board's, which is what every earlier caller meant by it.
    expect(grade.population).toBe(3);
  });

  it("answers both boards with the SAME outcome — only the predicted ranks differ", async () => {
    await seedThroughFreeze(SHADOW_BOARD);
    await seedOutcomes();
    const grade = await gradeWeek(db, { season: SEASON, week: 1 }, clockAt(GRADED_AT));
    const served = grade.boards.find((board) => board.boardSource === BOARD_SOURCE)!;
    const shadow = grade.boards.find((board) => board.boardSource === BOARD_SOURCE_V7_SHADOW)!;

    const actual = (rows: typeof served.rows, playerId: string) => rows.find((row) => row.playerId === playerId)!.actualPoints;
    for (const playerId of [CHASE, LAMB, HURTS]) {
      expect(actual(shadow.rows, playerId)).toBeCloseTo(actual(served.rows, playerId), 6);
    }

    const boardRank = (rows: typeof served.rows, playerId: string) => rows.find((row) => row.playerId === playerId)!.boardRank;
    expect(boardRank(served.rows, LAMB)).toBe(2);
    expect(boardRank(served.rows, HURTS)).toBe(3);
    expect(boardRank(shadow.rows, LAMB)).toBe(3);
    expect(boardRank(shadow.rows, HURTS)).toBe(2);
  });

  it("scores each board separately, so the head-to-head is two numbers rather than one", async () => {
    await seedThroughFreeze(SHADOW_BOARD);
    await seedOutcomes();
    const grade = await gradeWeek(db, { season: SEASON, week: 1 }, clockAt(GRADED_AT));
    const scoreOf = (source: string) =>
      grade.boards.find((board) => board.boardSource === source)!.scores.find((score) => score.column === "board")!;

    // Outcome order is CHASE (26) > HURTS (20) > LAMB (10). The served board had CHASE-LAMB-HURTS,
    // which swaps the bottom two; the shadow had CHASE-HURTS-LAMB, which is exactly right.
    expect(scoreOf(BOARD_SOURCE).spearman).toBeCloseTo(0.5, 6);
    expect(scoreOf(BOARD_SOURCE).meanAbsoluteRankError).toBeCloseTo(2 / 3, 6);
    expect(scoreOf(BOARD_SOURCE_V7_SHADOW).spearman).toBeCloseTo(1, 6);
    expect(scoreOf(BOARD_SOURCE_V7_SHADOW).meanAbsoluteRankError).toBeCloseTo(0, 6);
  });

  it("stores one player TWICE per grading, which only board_source tells apart", async () => {
    await seedThroughFreeze(SHADOW_BOARD);
    await seedOutcomes();
    await gradeWeek(db, { season: SEASON, week: 1 }, clockAt(GRADED_AT));
    const stored = await gradeRowsFor(db, SEASON);
    const chase = stored.filter((row) => row.playerId === CHASE);
    expect(chase).toHaveLength(2);
    expect(chase.map((row) => row.boardSource).sort()).toEqual([BOARD_SOURCE_V7_SHADOW, BOARD_SOURCE].sort());
  });

  it("SKIPS a shadow with no gradeable intersection, naming it, and still grades the served board", async () => {
    // The shadow board never carried LAMB, and LAMB is the only player the week produced an outcome
    // for: the served board's intersection is one player, the shadow's is empty.
    await seedThroughFreeze([entry(CHASE, 330.0, 1), entry(HURTS, 320.0, 2)]);
    await recordObservations(db, [...statRows(1, LAMB, { receptions: 5, receivingYards: 50 })]);

    const grade = await gradeWeek(db, { season: SEASON, week: 1 }, clockAt(GRADED_AT));
    expect(grade.boards.map((board) => board.boardSource)).toEqual([BOARD_SOURCE]);
    expect(grade.population).toBe(1);
    expect(grade.skipped.map((board) => board.boardSource)).toEqual([BOARD_SOURCE_V7_SHADOW]);
    expect(grade.skipped[0]!.reason).toMatch(/empty intersection/i);
    // Skipped, not written: the shadow contributes no graded rows at all.
    expect((await gradeRowsFor(db, SEASON)).every((row) => row.boardSource === BOARD_SOURCE)).toBe(true);
  });

  it("REFUSES the whole week when the SERVED board has no gradeable intersection", async () => {
    await seedThroughFreeze(SHADOW_BOARD);
    // An outcome for a player NO board froze: every intersection is empty, the served one included.
    await recordNflPlayers(db, [player("00-0099999", "Nobody Frozen", "WR")]);
    await recordObservations(db, [...statRows(1, "00-0099999", { receptions: 3, receivingYards: 30 })]);
    await expect(gradeWeek(db, { season: SEASON, week: 1 }, clockAt(GRADED_AT))).rejects.toThrow(/empty intersection/i);
    expect(await gradeRowsFor(db, SEASON)).toEqual([]);
  });
});

describe("runningScoreboard — the dual track", () => {
  it("gives the SERVED board all four columns and a shadow only its board column", async () => {
    await seedThroughFreeze(SHADOW_BOARD);
    await seedOutcomes();
    await gradeWeek(db, { season: SEASON, week: 1 }, clockAt(GRADED_AT));
    const scores = await runningScoreboard(db, SEASON);

    expect(scores.filter((score) => score.boardSource === BOARD_SOURCE).map((score) => score.column)).toEqual([
      "board",
      "adp",
      "ecr",
      "props",
    ]);
    expect(scores.filter((score) => score.boardSource === BOARD_SOURCE_V7_SHADOW).map((score) => score.column)).toEqual(["board"]);
    // Served first: the product's own line leads the report.
    expect(scores[0]!.boardSource).toBe(BOARD_SOURCE);
  });

  it("prints both board sources, marking the shadow, so two 'board' lines are never ambiguous", async () => {
    await seedThroughFreeze(SHADOW_BOARD);
    await seedOutcomes();
    await gradeWeek(db, { season: SEASON, week: 1 }, clockAt(GRADED_AT));
    const printed = formatScoreboard(await runningScoreboard(db, SEASON));
    expect(printed).toContain(BOARD_SOURCE);
    expect(printed).toContain(`${BOARD_SOURCE_V7_SHADOW} (shadow)`);
    for (const column of ["board", "adp", "ecr", "props"]) expect(printed).toContain(column);
  });
});
