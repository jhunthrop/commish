import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { createTestDb, truncateAll } from "@/db/test-db";
import { players, playerStatLines, scoringSettings } from "@/db/schema";
import { STANDARD_SCORING } from "@/domain/scoring";
import { computeFantasyPoints } from "@/scoring";
import { buildDraftPool } from "./pool";
import { seedDraftFixture, SPRINT_ROSTER_SLOTS } from "./test-support";

const db = createTestDb();

const zeroLine = {
  passingYards: 0, passingTouchdowns: 0, interceptions: 0, rushingYards: 0, rushingTouchdowns: 0,
  receivingYards: 0, receivingTouchdowns: 0, receptions: 0, fumblesLost: 0, fieldGoalsMade: 0,
  extraPointsMade: 0, sacks: 0, defensiveInterceptions: 0, defensiveTouchdowns: 0,
};

beforeEach(async () => {
  await truncateAll(db);
});

afterAll(async () => {
  await truncateAll(db);
});

describe("buildDraftPool", () => {
  it("ranks every player by projected season points, best first", async () => {
    const { leagueId } = await seedDraftFixture(db, {
      draftId: "draft_p", leagueId: "league_p", format: "snake", teamCount: 2,
      slotConfig: SPRINT_ROSTER_SLOTS, kickoffAt: new Date("2026-09-10T17:00:00.000Z"), auctionBudget: null,
    });
    await db.insert(players).values([
      { id: "star", name: "Star Back", position: "RB", nflTeam: "KC" },
      { id: "scrub", name: "Scrub Back", position: "RB", nflTeam: "NYJ" },
      { id: "middle", name: "Middle Receiver", position: "WR", nflTeam: "SF" },
    ]);
    await db.insert(playerStatLines).values([
      { ...zeroLine, playerId: "star", week: 1, rushingYards: 200, rushingTouchdowns: 2 },
      { ...zeroLine, playerId: "middle", week: 1, receivingYards: 100, receptions: 5 },
      { ...zeroLine, playerId: "scrub", week: 1, rushingYards: 10 },
    ]);

    const pool = await buildDraftPool(db, leagueId);
    expect(pool.map((p) => p.playerId)).toEqual(["star", "middle", "scrub"]);
    expect(pool.map((p) => p.position)).toEqual(["RB", "WR", "RB"]);
  });

  it("includes players with no stat lines at all, ranked last and ordered by id", async () => {
    const { leagueId } = await seedDraftFixture(db, {
      draftId: "draft_q", leagueId: "league_q", format: "snake", teamCount: 2,
      slotConfig: SPRINT_ROSTER_SLOTS, kickoffAt: new Date("2026-09-10T17:00:00.000Z"), auctionBudget: null,
    });
    await db.insert(players).values([
      { id: "b_rookie", name: "B Rookie", position: "WR", nflTeam: "SF" },
      { id: "a_rookie", name: "A Rookie", position: "WR", nflTeam: "SF" },
      { id: "vet", name: "Vet", position: "WR", nflTeam: "SF" },
    ]);
    await db.insert(playerStatLines).values([{ ...zeroLine, playerId: "vet", week: 1, receivingYards: 50 }]);

    expect((await buildDraftPool(db, leagueId)).map((p) => p.playerId)).toEqual(["vet", "a_rookie", "b_rookie"]);
  });

  it("ranks by the league's own scoring settings, not the PPR fallback", async () => {
    const { leagueId } = await seedDraftFixture(db, {
      draftId: "draft_r", leagueId: "league_r", format: "snake", teamCount: 2,
      slotConfig: SPRINT_ROSTER_SLOTS, kickoffAt: new Date("2026-09-10T17:00:00.000Z"), auctionBudget: null,
    });
    // This league scores standard, not PPR — pointsPerReception: 0 — which is the whole point:
    // a test that passes identically under PPR would never catch buildDraftPool ignoring the
    // league's own settings row.
    await db.insert(scoringSettings).values({ leagueId, ...STANDARD_SCORING });
    await db.insert(players).values([
      { id: "grinder", name: "Grinder Back", position: "RB", nflTeam: "KC" },
      { id: "possession", name: "Possession Receiver", position: "WR", nflTeam: "SF" },
    ]);
    await db.insert(playerStatLines).values([
      { ...zeroLine, playerId: "grinder", week: 1, rushingYards: 50 },
      { ...zeroLine, playerId: "possession", week: 1, receivingYards: 10, receptions: 20 },
    ]);

    // Under this league's standard settings: grinder = 50 * 0.1 = 5pts; possession =
    // 10 * 0.1 = 1pt (20 receptions score nothing since pointsPerReception is 0). Under the
    // PPR fallback the ranking would flip: possession = 10 * 0.1 + 20 * 1 = 21pts, well above
    // grinder's 5 — so this ranking is only correct if the league's own row was read.
    const grinderPoints = computeFantasyPoints(
      { playerId: "grinder", week: 1, ...zeroLine, rushingYards: 50 },
      "RB",
      STANDARD_SCORING,
    );
    const possessionPoints = computeFantasyPoints(
      { playerId: "possession", week: 1, ...zeroLine, receivingYards: 10, receptions: 20 },
      "WR",
      STANDARD_SCORING,
    );
    expect(grinderPoints).toBe(5);
    expect(possessionPoints).toBe(1);
    expect(grinderPoints).toBeGreaterThan(possessionPoints);

    const pool = await buildDraftPool(db, leagueId);
    expect(pool.map((p) => p.playerId)).toEqual(["grinder", "possession"]);
  });
});
