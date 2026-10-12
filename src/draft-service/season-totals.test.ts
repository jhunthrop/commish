import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { players, playerStatLines } from "@research/db/schema";
import { createTestDb, recordStatements } from "@research/db/test-db";
import { truncateAll } from "@/db/test-db";
import { PPR_SCORING, TE_PREMIUM_SCORING } from "@research/domain/scoring";
import type { Position } from "@research/domain/player";
import { computeFantasyPoints } from "@research/scoring";
import { seasonStatTotalsByPlayer } from "./season-totals";

const db = createTestDb();

const zeroLine = {
  passingYards: 0, passingTouchdowns: 0, interceptions: 0, rushingYards: 0, rushingTouchdowns: 0,
  receivingYards: 0, receivingTouchdowns: 0, receptions: 0, fumblesLost: 0, fieldGoalsMade: 0,
  extraPointsMade: 0, sacks: 0, defensiveInterceptions: 0, defensiveTouchdowns: 0,
};

/** Every position the engine treats differently: a TE (reception bonus), a K, a DEF (both bracket
 *  tables, per game, including a shutout and a blowout), plus a QB with interceptions and a
 *  half-sack line. Three games each so the sum crosses game boundaries. */
const LINES = [
  { ...zeroLine, playerId: "qb", week: 1, passingYards: 287, passingTouchdowns: 2, interceptions: 1, rushingYards: 12 },
  { ...zeroLine, playerId: "qb", week: 2, passingYards: 199, passingTouchdowns: 0, interceptions: 2, fumblesLost: 1, twoPointConversions: 1 },
  { ...zeroLine, playerId: "qb", week: 3, passingYards: 341, passingTouchdowns: 4 },
  { ...zeroLine, playerId: "te", week: 1, receivingYards: 61, receptions: 5, receivingTouchdowns: 1 },
  { ...zeroLine, playerId: "te", week: 2, receivingYards: 33, receptions: 3 },
  { ...zeroLine, playerId: "k", week: 1, fieldGoalsMade: 3, extraPointsMade: 2, fieldGoalsMissed: 1 },
  { ...zeroLine, playerId: "k", week: 2, fieldGoalsMade: 1, extraPointsMade: 4, extraPointsMissed: 1 },
  { ...zeroLine, playerId: "def", week: 1, sacks: 3.5, defensiveInterceptions: 1, pointsAllowed: 0, yardsAllowed: 180, safeties: 1 },
  { ...zeroLine, playerId: "def", week: 2, sacks: 1, defensiveTouchdowns: 1, pointsAllowed: 45, yardsAllowed: 520, defensiveFumblesRecovered: 2 },
  { ...zeroLine, playerId: "def", week: 3, pointsAllowed: 17, yardsAllowed: 349, kickReturnTouchdowns: 1 },
  { ...zeroLine, playerId: "late", week: 19, rushingYards: 500 },
];
const POSITIONS: Readonly<Record<string, Position>> = { qb: "QB", te: "TE", k: "K", def: "DEF", late: "RB" };

beforeEach(async () => {
  await truncateAll(db);
  await db.insert(players).values(Object.entries(POSITIONS).map(([id, position]) => ({ id, name: id, position, nflTeam: "FA" })));
  await db.insert(playerStatLines).values(LINES);
});

afterAll(async () => {
  await truncateAll(db);
});

describe("seasonStatTotalsByPlayer (finding 6: the stat-line sum moved into SQL)", () => {
  it.each([PPR_SCORING, TE_PREMIUM_SCORING])("matches the per-game engine to the cent for every position, under %o", async (rules) => {
    const totals = await seasonStatTotalsByPlayer(db, 18);
    for (const [playerId, position] of Object.entries(POSITIONS)) {
      const expected = LINES.filter((line) => line.playerId === playerId && line.week <= 18).reduce(
        (sum, line) => sum + computeFantasyPoints(line, position, rules),
        0,
      );
      const season = totals.get(playerId);
      const actual = season === undefined ? 0 : computeFantasyPoints(season.line, position, rules) + season.defenseTierPoints;
      expect(actual, playerId).toBeCloseTo(expected, 2);
    }
  });

  it("scores the defense brackets per GAME, never over the summed points allowed", async () => {
    const totals = await seasonStatTotalsByPlayer(db, 18);
    // Week 1 shutout (0 -> +5, 180 yards -> +3), week 2 blowout (45 -> -3, 520 -> -6),
    // week 3 middling (17 -> +1, 349 -> 0): +8 -9 +1 = 0. A single bracket over the
    // season's 62 points and 1,049 yards would score -5 -7 = -12 instead.
    expect(totals.get("def")!.defenseTierPoints).toBe(0);
    expect(totals.get("qb")!.defenseTierPoints).toBe(0);
  });

  it("bounds the read at the given week and reads one row per player in one statement", async () => {
    const statements = await recordStatements(db, async (logged) => {
      const totals = await seasonStatTotalsByPlayer(logged, 18);
      expect(totals.has("late")).toBe(false);
      expect(totals.size).toBe(4);
    });
    expect(statements).toHaveLength(1);
    expect(statements[0]).toMatch(/group by/);
  });
});
