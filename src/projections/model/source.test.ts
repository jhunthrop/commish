import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, truncateAll } from "@/db/test-db";
import { nflPlayers } from "@/db/schema";
import { STAT_FIELDS, type Position, type StatLine } from "@/domain/player";
import { PPR_SCORING } from "@/domain/scoring";
import { replay } from "../backtest";
import type { SeasonStatLine } from "../lines";
import { participationObservations, type PlayerWeekParticipation } from "../nflverse/map";
import { statLineObservations } from "../nflverse/stat-lines";
import { recordObservations } from "../store";
import { modelSource, MODEL_SOURCE_NAME } from "./source";

const db = createTestDb();

const ROSTER: readonly (readonly [string, Position])[] = [
  ["wr1", "WR"],
  ["wr2", "WR"],
  ["rb1", "RB"],
  ["qb1", "QB"],
];

/** Week W is replayed knowing everything stamped up to the Thursday before its games. */
const REPLAY_MOMENT = (week: number) => new Date(Date.UTC(2024, 8, 1 + week * 7));
const RESULTS_KNOWN = (week: number) => new Date(Date.UTC(2024, 8, 4 + week * 7));
const PRIOR_SEASON_STAMP = new Date("2024-01-15T00:00:00.000Z");

function line(season: number, week: number, playerId: string, over: Partial<StatLine>, asOf: Date): SeasonStatLine {
  return {
    season,
    asOf,
    line: {
      playerId,
      week,
      ...(Object.fromEntries(STAT_FIELDS.map((field) => [field, 0])) as Omit<StatLine, "playerId" | "week">),
      ...over,
    },
  };
}

function participation(
  season: number,
  week: number,
  playerId: string,
  over: Partial<PlayerWeekParticipation>,
  asOf: Date,
): PlayerWeekParticipation {
  return {
    playerId,
    season,
    week,
    offensiveSnaps: 50,
    teamOffensiveSnaps: 65,
    routesRun: null,
    targets: 0,
    carries: 0,
    passAttempts: 0,
    teamTargets: 34,
    teamCarries: 26,
    teamPassAttempts: 34,
    asOf,
    ...over,
  };
}

/** One week for everyone: a target hog, a secondary receiver, a back and a quarterback. */
function weekOf(season: number, week: number, asOf: Date): { lines: SeasonStatLine[]; usage: PlayerWeekParticipation[] } {
  return {
    lines: [
      line(season, week, "wr1", { receptions: 7, receivingYards: 95, receivingTouchdowns: 1 }, asOf),
      line(season, week, "wr2", { receptions: 3, receivingYards: 31 }, asOf),
      line(season, week, "rb1", { rushingYards: 78, rushingTouchdowns: 1, receptions: 2, receivingYards: 14 }, asOf),
      line(season, week, "qb1", { passingYards: 255, passingTouchdowns: 2, interceptions: 1, rushingYards: 18 }, asOf),
    ],
    usage: [
      participation(season, week, "wr1", { targets: 11, offensiveSnaps: 60 }, asOf),
      participation(season, week, "wr2", { targets: 5, offensiveSnaps: 42 }, asOf),
      participation(season, week, "rb1", { targets: 3, carries: 17, offensiveSnaps: 38 }, asOf),
      participation(season, week, "qb1", { passAttempts: 34, carries: 4, offensiveSnaps: 65 }, asOf),
    ],
  };
}

async function store(season: number, week: number, asOf: Date): Promise<void> {
  const { lines, usage } = weekOf(season, week, asOf);
  await recordObservations(db, statLineObservations(lines));
  await recordObservations(db, participationObservations(usage));
}

beforeEach(async () => {
  await truncateAll(db);
  await db.insert(nflPlayers).values(
    ROSTER.map(([id, position]) => ({ id, pfrId: id, name: id, position, latestTeam: "KC", rookieSeason: 2020, lastSeason: 2024 })),
  );
  for (const week of [1, 2, 3, 4]) await store(2023, week, PRIOR_SEASON_STAMP);
  for (const week of [1, 2, 3]) await store(2024, week, RESULTS_KNOWN(week));
});

afterAll(async () => {
  await truncateAll(db);
});

describe("the model as a projection source", () => {
  it("projects a StatLine for every player both layers have an opinion about", async () => {
    const result = await replay(db, {
      season: 2024,
      weeks: [3],
      source: modelSource(),
      rules: PPR_SCORING,
      asOfForWeek: REPLAY_MOMENT,
    });
    expect(result.source).toBe(MODEL_SOURCE_NAME);
    expect(result.overall.sampleSize).toBe(ROSTER.length);
  });

  it("orders a target hog above a secondary receiver, which is the whole job", async () => {
    const projected = await modelSource().project({
      season: 2024,
      week: 3,
      asOf: REPLAY_MOMENT(3),
      history: [],
      usage: [],
      positions: new Map(ROSTER),
    });
    // With no history at all every player falls back to his role prior, so this must still return
    // nothing rather than a confident league-average opinion about everybody.
    expect(projected).toEqual([]);
  });

  it("IS BYTE-IDENTICAL WHETHER OR NOT THE FUTURE EXISTS IN THE STORE", async () => {
    // THE STRUCTURAL LEAKAGE TEST, and it is worth more than any accuracy number. A model that
    // trains on the week it is predicting looks excellent and is worthless, and nothing else in the
    // suite would notice — the scoreboard would simply improve.
    const before = await replay(db, {
      season: 2024,
      weeks: [2],
      source: modelSource(),
      rules: PPR_SCORING,
      asOfForWeek: REPLAY_MOMENT,
    });

    // Week 3 already exists; add weeks 4 and 5, wildly different from everything before them, and
    // stamped after week 2's replay moment. Nothing about the week-2 answer may move.
    for (const week of [4, 5]) {
      const { lines, usage } = weekOf(2024, week, RESULTS_KNOWN(week));
      await recordObservations(db, statLineObservations(lines.map((row) => ({
        ...row,
        line: { ...row.line, receivingYards: 400, receivingTouchdowns: 5, rushingYards: 300 },
      }))));
      await recordObservations(db, participationObservations(usage.map((row) => ({ ...row, targets: 30, carries: 30 }))));
    }

    const after = await replay(db, {
      season: 2024,
      weeks: [2],
      source: modelSource(),
      rules: PPR_SCORING,
      asOfForWeek: REPLAY_MOMENT,
    });
    expect(JSON.stringify(after)).toBe(JSON.stringify(before));
  });

  it("is byte-identical run twice over the same store — a scoreboard has to be reproducible", async () => {
    const options = { season: 2024, weeks: [1, 2, 3], source: modelSource(), rules: PPR_SCORING, asOfForWeek: REPLAY_MOMENT };
    expect(JSON.stringify(await replay(db, options))).toBe(JSON.stringify(await replay(db, options)));
  });
});
