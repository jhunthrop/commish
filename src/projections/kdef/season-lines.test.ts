import { beforeEach, describe, expect, it } from "vitest";
import { players } from "@/db/schema";
import { createTestDb, truncateAll } from "@/db/test-db";
import type { StatLine } from "@/domain/player";
import { PPR_SCORING } from "@/domain/scoring";
import { computeFantasyPoints } from "@/scoring";
import { recordCrosswalk } from "@/projections/crosswalk";
import { recordKickingWeekRows, type KickingWeekRow } from "@/projections/nflverse/kicking-weeks";
import { recordTeamDefenseWeekRows, type TeamDefenseWeekRow } from "@/projections/nflverse/team-defense-weeks";
import { recordNflPlayers } from "@/projections/universe";
import { kdefSeasonLines, type DefenseSeasonFacts, type KickerSeasonFacts } from "./season-lines";

/**
 * THE READER'S WHOLE CONTRACT IS "what he actually did, under these rules, and nothing invented".
 * Every case here is one of the three ways that could quietly go wrong: a total that disagrees with
 * the scoring engine, a week nobody played counted as a zero, or a missing points-allowed figure
 * scored as a shutout.
 */
const db = createTestDb();
const SEASON = 2025;
const KICKER_GSIS = "00-0033111";
const KICKER_PRODUCT_ID = "4040404";

function kickingWeek(overrides: Partial<KickingWeekRow> = {}): KickingWeekRow {
  return {
    season: SEASON, week: 1, playerId: KICKER_GSIS, team: "BAL",
    fieldGoalsMade: 0, fieldGoalsAttempted: 0, fieldGoalsMissed: 0, fieldGoalsBlocked: 0,
    fieldGoalsMade0To19: 0, fieldGoalsMade20To29: 0, fieldGoalsMade30To39: 0,
    fieldGoalsMade40To49: 0, fieldGoalsMade50To59: 0, fieldGoalsMade60Plus: 0,
    fieldGoalsMissed0To19: 0, fieldGoalsMissed20To29: 0, fieldGoalsMissed30To39: 0,
    fieldGoalsMissed40To49: 0, fieldGoalsMissed50To59: 0, fieldGoalsMissed60Plus: 0,
    extraPointsMade: 0, extraPointsAttempted: 0, extraPointsMissed: 0, extraPointsBlocked: 0,
    ...overrides,
  };
}

function defenseWeek(overrides: Partial<TeamDefenseWeekRow> = {}): TeamDefenseWeekRow {
  return {
    season: SEASON, week: 1, team: "LA", opponentTeam: "SF",
    sacks: 0, interceptions: 0, fumbleRecoveries: 0, defensiveTouchdowns: 0, safeties: 0,
    puntBlocks: 0, extraPointBlocks: 0, fieldGoalBlocks: 0, specialTeamsTouchdowns: 0,
    passingYardsAllowed: 0, rushingYardsAllowed: 0, sackYardsLostAllowed: 0, pointsAllowed: null,
    ...overrides,
  };
}

/** The kicker in both id spaces, plus the crosswalk edge between them. */
async function seedKicker(): Promise<void> {
  await recordNflPlayers(db, [
    { id: KICKER_GSIS, pfrId: null, espnId: "3051909", name: "Justin Tucker", position: "K", latestTeam: "BAL", rookieSeason: 2012, lastSeason: SEASON },
  ]);
  await db.insert(players).values({
    id: KICKER_PRODUCT_ID, name: "Justin Tucker", position: "K", nflTeam: "BAL", headshotUrl: null, adp: 140.2,
  });
  await recordCrosswalk(db, [
    { playerId: KICKER_PRODUCT_ID, nflPlayerId: KICKER_GSIS, method: "espn_id", unmatchedReason: null, resolvedAt: new Date() },
  ]);
}

async function seedDefense(): Promise<void> {
  await db.insert(players).values({
    id: "DST-LAR", name: "Los Angeles Rams", position: "DEF", nflTeam: "LAR", headshotUrl: null, adp: 155.0,
  });
}

beforeEach(async () => {
  await truncateAll(db);
});

describe("kdefSeasonLines, a kicker", () => {
  it("scores every week through `computeFantasyPoints` and sums to the same total", async () => {
    await seedKicker();
    await recordKickingWeekRows(db, [
      kickingWeek({ week: 1, fieldGoalsMade: 3, fieldGoalsAttempted: 4, fieldGoalsMissed: 1, fieldGoalsMade30To39: 2, fieldGoalsMade50To59: 1, fieldGoalsMissed40To49: 1, extraPointsMade: 2, extraPointsAttempted: 2 }),
      kickingWeek({ week: 2, fieldGoalsMade: 1, fieldGoalsAttempted: 1, fieldGoalsMade20To29: 1, extraPointsMade: 4, extraPointsAttempted: 5, extraPointsMissed: 1 }),
    ]);

    const lines = await kdefSeasonLines(db, { season: SEASON, playerIds: [KICKER_PRODUCT_ID], rules: PPR_SCORING });
    const mine = lines.get(KICKER_PRODUCT_ID);
    expect(mine).toBeDefined();

    // The parity check: the same two lines, scored here by the engine itself.
    const expected = mine!.weeks.map((week) => computeFantasyPoints(week.line, "K", PPR_SCORING));
    expect(mine!.weeks.map((week) => week.points)).toEqual(expected);
    expect(mine!.points).toBe(expected[0]! + expected[1]!);
    expect(mine!.games).toBe(2);
    expect(mine!.pointsPerGame).toBe((expected[0]! + expected[1]!) / 2);
  });

  it("counts only the weeks the archive holds, never the weeks he missed", async () => {
    await seedKicker();
    await recordKickingWeekRows(db, [kickingWeek({ week: 5, fieldGoalsMade: 2, fieldGoalsAttempted: 2, fieldGoalsMade20To29: 2 })]);

    const mine = (await kdefSeasonLines(db, { season: SEASON, playerIds: [KICKER_PRODUCT_ID], rules: PPR_SCORING })).get(KICKER_PRODUCT_ID);
    expect(mine?.games).toBe(1);
    expect(mine?.weeks.map((week) => week.week)).toEqual([5]);
  });

  it("reports makes and attempts by distance band, and the longest band he made one in", async () => {
    await seedKicker();
    await recordKickingWeekRows(db, [
      kickingWeek({ week: 1, fieldGoalsMade: 2, fieldGoalsAttempted: 3, fieldGoalsMissed: 1, fieldGoalsMade30To39: 1, fieldGoalsMade40To49: 1, fieldGoalsMissed50To59: 1, extraPointsMade: 3, extraPointsAttempted: 4, extraPointsMissed: 1 }),
    ]);

    const facts = (await kdefSeasonLines(db, { season: SEASON, playerIds: [KICKER_PRODUCT_ID], rules: PPR_SCORING })).get(KICKER_PRODUCT_ID)?.facts as KickerSeasonFacts;
    expect(facts.kind).toBe("K");
    expect(facts.distanceBands).toEqual([
      { label: "0 to 39", made: 1, attempted: 1 },
      { label: "40 to 49", made: 1, attempted: 1 },
      { label: "50 or more", made: 0, attempted: 1 },
    ]);
    expect(facts.longestMadeBand).toBe("40 to 49");
    expect(facts.extraPointsMade).toBe(3);
    expect(facts.extraPointsAttempted).toBe(4);
  });

  it("says no longest band at all for a kicker who made nothing", async () => {
    await seedKicker();
    await recordKickingWeekRows(db, [kickingWeek({ week: 1, fieldGoalsAttempted: 1, fieldGoalsMissed: 1, fieldGoalsMissed40To49: 1 })]);
    const facts = (await kdefSeasonLines(db, { season: SEASON, playerIds: [KICKER_PRODUCT_ID], rules: PPR_SCORING })).get(KICKER_PRODUCT_ID)?.facts as KickerSeasonFacts;
    expect(facts.longestMadeBand).toBeNull();
  });

  it("has no entry at all for a kicker the archive holds nothing for", async () => {
    await seedKicker();
    expect((await kdefSeasonLines(db, { season: SEASON, playerIds: [KICKER_PRODUCT_ID], rules: PPR_SCORING })).size).toBe(0);
  });

  it("has no entry for a kicker the crosswalk could not place", async () => {
    await db.insert(players).values({ id: "9999", name: "Unplaced Kicker", position: "K", nflTeam: "BAL", headshotUrl: null, adp: null });
    expect((await kdefSeasonLines(db, { season: SEASON, playerIds: ["9999"], rules: PPR_SCORING })).size).toBe(0);
  });
});

describe("kdefSeasonLines, a team defense", () => {
  it("keys a club by its PRODUCT id through the archive's own spelling", async () => {
    await seedDefense();
    await recordTeamDefenseWeekRows(db, [defenseWeek({ week: 1, sacks: 3, interceptions: 2, pointsAllowed: 10, passingYardsAllowed: 180, rushingYardsAllowed: 90 })]);

    const lines = await kdefSeasonLines(db, { season: SEASON, playerIds: ["DST-LAR"], rules: PPR_SCORING });
    expect(lines.get("DST-LAR")?.position).toBe("DEF");
    expect(lines.get("DST-LAR")?.games).toBe(1);
  });

  it("scores each week through `computeFantasyPoints` on the raw line it reports", async () => {
    await seedDefense();
    await recordTeamDefenseWeekRows(db, [
      defenseWeek({ week: 1, sacks: 4, interceptions: 1, fumbleRecoveries: 1, defensiveTouchdowns: 1, safeties: 1, specialTeamsTouchdowns: 1, pointsAllowed: 3, passingYardsAllowed: 150, rushingYardsAllowed: 60 }),
    ]);
    const mine = (await kdefSeasonLines(db, { season: SEASON, playerIds: ["DST-LAR"], rules: PPR_SCORING })).get("DST-LAR");
    const line = mine!.weeks[0]!.line;
    expect(line.yardsAllowed).toBe(210);
    expect(line.pointsAllowed).toBe(3);
    expect(mine!.weeks[0]!.points).toBe(computeFantasyPoints(line, "DEF", PPR_SCORING));
  });

  it("states yards allowed NET, the way a box score does: gross passing minus sack yardage, plus rushing", async () => {
    await recordTeamDefenseWeekRows(db, [defenseWeek({ week: 1, passingYardsAllowed: 200, rushingYardsAllowed: 100, sackYardsLostAllowed: 15 })]);

    const mine = (await kdefSeasonLines(db, { season: SEASON, playerIds: ["DST-LAR"], rules: PPR_SCORING })).get("DST-LAR");
    expect(mine?.weeks[0]?.line.yardsAllowed).toBe(285);
    expect(mine?.facts.kind === "DEF" ? mine.facts.yardsAllowed : null).toBe(285);
    expect(mine?.facts.kind === "DEF" ? mine.facts.gamesWithYardsAllowed : null).toBe(1);
  });

  it("leaves yards allowed OFF a week whose sack term the archive never carried, never a gross figure", async () => {
    await recordTeamDefenseWeekRows(db, [defenseWeek({ week: 1, passingYardsAllowed: 200, rushingYardsAllowed: 100, sackYardsLostAllowed: null })]);

    const mine = (await kdefSeasonLines(db, { season: SEASON, playerIds: ["DST-LAR"], rules: PPR_SCORING })).get("DST-LAR");
    expect(mine?.weeks[0]?.line.yardsAllowed).toBeUndefined();
    expect(mine?.facts.kind === "DEF" ? mine.facts.gamesWithYardsAllowed : null).toBe(0);
  });

  it("scores a week with no points allowed WITHOUT the points-allowed tier, and counts it", async () => {
    await seedDefense();
    await recordTeamDefenseWeekRows(db, [
      defenseWeek({ week: 1, sacks: 2, pointsAllowed: null, passingYardsAllowed: 200, rushingYardsAllowed: 100 }),
    ]);
    const mine = (await kdefSeasonLines(db, { season: SEASON, playerIds: ["DST-LAR"], rules: PPR_SCORING })).get("DST-LAR");
    expect(mine?.weeksMissingPointsAllowed).toBe(1);

    const line: StatLine = mine!.weeks[0]!.line;
    expect(line.pointsAllowed).toBeUndefined();
    // A shutout would have been +5 on top of this. The absent field is what keeps it off.
    const withShutout = computeFantasyPoints({ ...line, pointsAllowed: 0 }, "DEF", PPR_SCORING);
    expect(mine!.weeks[0]!.points).toBe(computeFantasyPoints(line, "DEF", PPR_SCORING));
    expect(mine!.weeks[0]!.points).not.toBe(withShutout);

    const facts = mine!.facts as DefenseSeasonFacts;
    expect(facts.pointsAllowed).toBeNull();
    expect(facts.gamesWithPointsAllowed).toBe(0);
    expect(facts.pointsAllowedBandGames).toEqual([]);
  });

  it("counts the games in each points-allowed bracket", async () => {
    await seedDefense();
    await recordTeamDefenseWeekRows(db, [
      defenseWeek({ week: 1, pointsAllowed: 0 }),
      defenseWeek({ week: 2, pointsAllowed: 6 }),
      defenseWeek({ week: 3, pointsAllowed: 6 }),
      defenseWeek({ week: 4, pointsAllowed: 50 }),
      defenseWeek({ week: 5, pointsAllowed: null }),
    ]);
    const facts = (await kdefSeasonLines(db, { season: SEASON, playerIds: ["DST-LAR"], rules: PPR_SCORING })).get("DST-LAR")?.facts as DefenseSeasonFacts;
    expect(facts.gamesWithPointsAllowed).toBe(4);
    expect(facts.pointsAllowed).toBe(62);
    expect(facts.pointsAllowedBandGames.filter((band) => band.games > 0)).toEqual([
      { label: "0", games: 1 },
      { label: "1 to 6", games: 2 },
      { label: "46 or more", games: 1 },
    ]);
  });

  it("sums takeaways and yards allowed over the weeks it holds", async () => {
    await seedDefense();
    await recordTeamDefenseWeekRows(db, [
      defenseWeek({ week: 1, sacks: 2.5, interceptions: 2, fumbleRecoveries: 1, passingYardsAllowed: 200, rushingYardsAllowed: 100 }),
      defenseWeek({ week: 2, sacks: 1.5, interceptions: 0, fumbleRecoveries: 2, passingYardsAllowed: 150, rushingYardsAllowed: 80 }),
    ]);
    const facts = (await kdefSeasonLines(db, { season: SEASON, playerIds: ["DST-LAR"], rules: PPR_SCORING })).get("DST-LAR")?.facts as DefenseSeasonFacts;
    expect(facts.sacks).toBe(4);
    expect(facts.takeaways).toBe(5);
    expect(facts.yardsAllowed).toBe(530);
  });
});

describe("kdefSeasonLines, both positions at once", () => {
  it("reads a kicker and a team defense in one call", async () => {
    await seedKicker();
    await seedDefense();
    await recordKickingWeekRows(db, [kickingWeek({ week: 1, fieldGoalsMade: 1, fieldGoalsAttempted: 1, fieldGoalsMade20To29: 1 })]);
    await recordTeamDefenseWeekRows(db, [defenseWeek({ week: 1, sacks: 1, pointsAllowed: 20 })]);

    const lines = await kdefSeasonLines(db, { season: SEASON, playerIds: [KICKER_PRODUCT_ID, "DST-LAR"], rules: PPR_SCORING });
    expect([...lines.keys()].sort()).toEqual([KICKER_PRODUCT_ID, "DST-LAR"].sort());
  });

  it("asks the database nothing when asked about nobody", async () => {
    expect((await kdefSeasonLines(db, { season: SEASON, playerIds: [], rules: PPR_SCORING })).size).toBe(0);
  });
});
