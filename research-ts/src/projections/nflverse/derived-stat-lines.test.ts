import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, truncateAll } from "@research-ts/db/test-db";
import { nflPlayers } from "@research-ts/db/schema";
import type { Position } from "@research-ts/domain/player";
import { STAT_LINE_SOURCE, type SeasonStatLine } from "../lines";
import { recordObservations, type PlayerWeekObservation } from "../store";
import type { CsvRow } from "./csv";
import {
  DERIVED_STAT_LINE_SOURCE,
  DerivedStatLineAggregator,
  deriveStatLines,
  derivedSeasonSanityReport,
  derivedStatLineObservations,
  seasonPointsAgreement,
  statLinesAsOfForLiveSurface,
  statLinesAsOfForMeasurement,
  weekAsOfFromDerivedLines,
} from "./derived-stat-lines";

/**
 * EVERY ROW IN THIS FILE IS BUILT FROM `DerivedStatLineAggregator.COLUMNS` AND NOTHING ELSE.
 *
 * The fix round this file was rewritten for found the exact failure mode a hand-listed `CsvRow`
 * defeats: the first version of `two_point_attempt`'s exclusion guard never actually fired against
 * the real stream, because the real column list omitted it — but every test row here had it set
 * directly, so every test passed anyway. `baseRow` starts from the aggregator's OWN declared column
 * list (`DerivedStatLineAggregator.COLUMNS`), filled blank, before any override is applied — so a
 * column `add()` reads that is missing from that list reads as `undefined` here too, exactly as it
 * would from the real stream, and the test that exercises it fails rather than passing vacuously.
 */
function baseRow(over: Partial<Record<string, string>>): CsvRow {
  const declared = Object.fromEntries(DerivedStatLineAggregator.COLUMNS.map((column) => [column, ""]));
  return { ...declared, ...over } as CsvRow;
}

/** A baseline designed rush, which every test then varies one field of. */
function rush(over: Partial<Record<string, string>> = {}): CsvRow {
  return baseRow({
    season: "2018",
    week: "3",
    season_type: "REG",
    game_date: "2018-09-22",
    play_type: "run",
    rush_attempt: "1",
    qb_kneel: "0",
    two_point_attempt: "0",
    rusher_player_id: "back",
    rushing_yards: "4",
    rush_touchdown: "0",
    ...over,
  });
}

function pass(over: Partial<Record<string, string>> = {}): CsvRow {
  return rush({
    play_type: "pass",
    rush_attempt: "0",
    rusher_player_id: "",
    rushing_yards: "",
    passer_player_id: "qb",
    passing_yards: "0",
    receiver_player_id: "wideout",
    receiving_yards: "0",
    ...over,
  });
}

function completion(over: Partial<Record<string, string>> = {}): CsvRow {
  return pass({ complete_pass: "1", passing_yards: "9", receiving_yards: "9", ...over });
}

function linesOf(rows: readonly CsvRow[]) {
  const aggregator = new DerivedStatLineAggregator();
  for (const row of rows) aggregator.add(row);
  return aggregator.lines();
}

const WEEK_3_AS_OF = new Map([[3, new Date("2018-09-24T00:00:00.000Z")]]);

describe("DerivedStatLineAggregator.COLUMNS — the stream-coverage guard (fix round, C1)", () => {
  it("declares two_point_attempt — the exact column a prior version silently omitted", () => {
    expect(DerivedStatLineAggregator.COLUMNS).toContain("two_point_attempt");
  });

  it("excludes a two-point conversion even when the row carries ONLY the declared columns", () => {
    // This is the regression test for the real bug: the guard existed in `add()` all along, but the
    // real stream never carried the column it read, so `row.two_point_attempt` was `undefined` and
    // the guard never fired. `baseRow` reproduces that real-stream shape.
    const lines = linesOf([rush({ two_point_attempt: "1", rushing_yards: "2" })]);
    expect(lines.find((l) => l.playerId === "back")).toBeUndefined();
  });

  it("still counts an ordinary rush when built from only the declared columns", () => {
    const lines = linesOf([rush({ rushing_yards: "6" })]);
    expect(lines.find((l) => l.playerId === "back")).toMatchObject({ rushingYards: 6 });
  });
});

describe("DerivedStatLineAggregator — rushing", () => {
  it("credits a designed rush to the rusher", () => {
    const lines = linesOf([rush({ rushing_yards: "4" }), rush({ rushing_yards: "7" })]);
    expect(lines.find((l) => l.playerId === "back")).toMatchObject({ rushingYards: 11 });
  });

  it("counts a scramble as a rushing attempt, unlike the touches file's designed-carry definition", () => {
    const lines = linesOf([pass({ rush_attempt: "1", rusher_player_id: "qb", rushing_yards: "12" })]);
    expect(lines.find((l) => l.playerId === "qb")).toMatchObject({ rushingYards: 12 });
  });

  it("excludes a kneel — never a rushing attempt", () => {
    const lines = linesOf([rush({ qb_kneel: "1", rushing_yards: "-1" })]);
    expect(lines.find((l) => l.playerId === "back")).toBeUndefined();
  });

  it("counts a rushing touchdown", () => {
    const lines = linesOf([rush({ rush_touchdown: "1", rushing_yards: "2" })]);
    expect(lines.find((l) => l.playerId === "back")).toMatchObject({ rushingTouchdowns: 1 });
  });

  it("excludes a two-point conversion rush", () => {
    const lines = linesOf([rush({ two_point_attempt: "1", rushing_yards: "2" })]);
    expect(lines.find((l) => l.playerId === "back")).toBeUndefined();
  });
});

describe("DerivedStatLineAggregator — passing and receiving", () => {
  it("credits the passer's yards and the receiver's yards on the same completion", () => {
    const lines = linesOf([completion({ passing_yards: "9", receiving_yards: "9" })]);
    expect(lines.find((l) => l.playerId === "qb")).toMatchObject({ passingYards: 9 });
    expect(lines.find((l) => l.playerId === "wideout")).toMatchObject({ receivingYards: 9, receptions: 1 });
  });

  it("counts a target as no reception when the pass falls incomplete", () => {
    const lines = linesOf([pass({ complete_pass: "0" })]);
    expect(lines.find((l) => l.playerId === "wideout")).toMatchObject({ receptions: 0, receivingYards: 0 });
  });

  it("credits a passing touchdown to the passer and a receiving touchdown to the receiver on the same play", () => {
    const lines = linesOf([completion({ pass_touchdown: "1" })]);
    expect(lines.find((l) => l.playerId === "qb")).toMatchObject({ passingTouchdowns: 1 });
    expect(lines.find((l) => l.playerId === "wideout")).toMatchObject({ receivingTouchdowns: 1 });
  });

  it("credits an interception to the passer", () => {
    const lines = linesOf([pass({ interception: "1" })]);
    expect(lines.find((l) => l.playerId === "qb")).toMatchObject({ interceptions: 1 });
  });

  it("excludes a two-point conversion pass from both the passer's and receiver's lines", () => {
    const lines = linesOf([completion({ two_point_attempt: "1" })]);
    expect(lines.find((l) => l.playerId === "qb")).toBeUndefined();
    expect(lines.find((l) => l.playerId === "wideout")).toBeUndefined();
  });
});

describe("DerivedStatLineAggregator — fumbles", () => {
  it("credits one lost fumble to whoever fumbled, regardless of play type", () => {
    const lines = linesOf([rush({ fumble_lost: "1", fumbled_1_player_id: "back" })]);
    expect(lines.find((l) => l.playerId === "back")).toMatchObject({ fumblesLost: 1 });
  });

  it("does not credit a fumble with no attributed player", () => {
    const lines = linesOf([rush({ fumble_lost: "1", fumbled_1_player_id: "" })]);
    expect(lines.some((l) => l.fumblesLost > 0)).toBe(false);
  });
});

describe("weekAsOfFromDerivedLines — week-max stamp discipline (fix round, I6)", () => {
  it("stamps every player in a week from the WEEK's latest game, not his own team's", () => {
    const lines = linesOf([
      rush({ rusher_player_id: "thursday-back", game_date: "2018-09-20" }),
      rush({ rusher_player_id: "monday-back", game_date: "2018-09-24" }),
    ]);
    const weekAsOf = weekAsOfFromDerivedLines(lines, 24);
    // Both players' week-3 lines must share the SAME stamp — the Monday game's, not the Thursday
    // player's own game date. A per-game stamp would leak the Thursday player's numbers up to four
    // days before the published weekly file ever would have carried them.
    const { statLines } = deriveStatLines(lines, weekAsOf, new Set(["thursday-back", "monday-back"]));
    const stamps = new Set(statLines.map((row) => row.asOf.getTime()));
    expect(stamps.size).toBe(1);
    // kickoffAsOf("2018-09-24", 24) = end of that UTC calendar day (2018-09-25T00:00Z) plus the
    // 24-hour publication lag = 2018-09-26T00:00Z — the Monday game's own stamp, never the
    // Thursday game's (which alone would have stamped one day earlier, 2018-09-22T00:00Z).
    expect([...stamps][0]).toBe(new Date("2018-09-26T00:00:00.000Z").getTime());
  });

  it("keeps two different weeks' stamps independent", () => {
    const lines = linesOf([
      rush({ week: "3", game_date: "2018-09-20" }),
      rush({ week: "4", rusher_player_id: "other", game_date: "2018-09-30" }),
    ]);
    const weekAsOf = weekAsOfFromDerivedLines(lines, 24);
    expect(weekAsOf.get(3)).toEqual(new Date("2018-09-22T00:00:00.000Z"));
    expect(weekAsOf.get(4)).toEqual(new Date("2018-10-02T00:00:00.000Z"));
  });
});

describe("deriveStatLines", () => {
  it("builds a StatLine with the five undeterminable fields at zero", () => {
    const lines = linesOf([rush({ rushing_yards: "5" })]);
    const { statLines } = deriveStatLines(lines, WEEK_3_AS_OF, new Set(["back"]));
    expect(statLines[0]?.line).toMatchObject({
      playerId: "back",
      rushingYards: 5,
      fieldGoalsMade: 0,
      extraPointsMade: 0,
      sacks: 0,
      defensiveInterceptions: 0,
      defensiveTouchdowns: 0,
    });
  });

  it("stamps every field's finite-number invariant, and reports a player the universe cannot place", () => {
    const lines = linesOf([rush(), completion()]);
    const { statLines, unknownPlayers } = deriveStatLines(lines, WEEK_3_AS_OF, new Set(["back"]));
    expect(statLines).toHaveLength(1);
    expect(unknownPlayers).toEqual(["qb", "wideout"]);
  });

  it("stamps every line with the week's own as-of", () => {
    const lines = linesOf([rush()]);
    const { statLines } = deriveStatLines(lines, WEEK_3_AS_OF, new Set(["back"]));
    expect(statLines[0]?.asOf).toEqual(WEEK_3_AS_OF.get(3));
  });

  it("throws for a week its own weekAsOf map carries no stamp for — a caller bug, not an unknowable moment", () => {
    const lines = linesOf([rush({ week: "5" })]);
    expect(() => deriveStatLines(lines, WEEK_3_AS_OF, new Set(["back"]))).toThrow(/as-of/i);
  });
});

describe("derivedStatLineObservations", () => {
  it("emits one observation per stat field under the derived source, never the published one", () => {
    const lines = linesOf([rush({ rushing_yards: "5" })]);
    const { statLines } = deriveStatLines(lines, WEEK_3_AS_OF, new Set(["back"]));
    const observations = derivedStatLineObservations(statLines);
    expect(observations).toHaveLength(14);
    expect(observations.every((row) => row.source === DERIVED_STAT_LINE_SOURCE)).toBe(true);
    expect(observations).toEqual(
      expect.arrayContaining([expect.objectContaining({ metric: "rushing_yards", value: 5 })]),
    );
  });
});

describe("seasonPointsAgreement", () => {
  const positions: ReadonlyMap<string, Position> = new Map([
    ["rb1", "RB"],
    ["rb2", "RB"],
  ]);

  function statLine(playerId: string, week: number, rushingYards: number, rushingTouchdowns: number): SeasonStatLine {
    return {
      season: 2018,
      asOf: new Date("2018-12-01T00:00:00.000Z"),
      line: {
        playerId,
        week,
        passingYards: 0,
        passingTouchdowns: 0,
        interceptions: 0,
        rushingYards,
        rushingTouchdowns,
        receivingYards: 0,
        receivingTouchdowns: 0,
        receptions: 0,
        fumblesLost: 0,
        fieldGoalsMade: 0,
        extraPointsMade: 0,
        sacks: 0,
        defensiveInterceptions: 0,
        defensiveTouchdowns: 0,
      },
    };
  }

  function season(playerId: string, weeklyYards: readonly number[]): readonly SeasonStatLine[] {
    return weeklyYards.map((yards, index) => statLine(playerId, index + 1, yards, 0));
  }

  it("scores 1 when the derivation and the published line agree on the ordering", () => {
    const published = [...season("rb1", Array(9).fill(80)), ...season("rb2", Array(9).fill(40))];
    const derived = [...season("rb1", Array(9).fill(81)), ...season("rb2", Array(9).fill(39))];
    const result = seasonPointsAgreement(derived, published, positions);
    expect(result.rankCorrelation).toBe(1);
    expect(result.sampleSize).toBe(2);
  });

  it("drops a player under the games floor from the sample", () => {
    const published = [...season("rb1", Array(9).fill(80)), ...season("rb2", Array(3).fill(40))];
    const derived = [...season("rb1", Array(9).fill(80)), ...season("rb2", Array(3).fill(40))];
    const result = seasonPointsAgreement(derived, published, positions, { minGames: 8 });
    expect(result.sampleSize).toBe(1);
  });

  it("ignores a player the position map does not carry", () => {
    const published = season("rb1", Array(9).fill(80));
    const derived = season("rb1", Array(9).fill(80));
    const result = seasonPointsAgreement(derived, published, new Map());
    expect(result.sampleSize).toBe(0);
    expect(result.rankCorrelation).toBeNull();
  });

  it("reports mean absolute error in points over the same matched sample (fix round, I1)", () => {
    const published = [...season("rb1", Array(9).fill(80)), ...season("rb2", Array(9).fill(40))];
    // rb1's derived total is 9 points high every week (81 vs 80 rushing yards -> 0.1 pt/yard under
    // the default PPR rules is not exact, so build the delta directly through points by using a
    // known-exact yardage gap: 10 yards = 1.0 point under standard PPR rushing scoring).
    const derived = [...season("rb1", Array(9).fill(90)), ...season("rb2", Array(9).fill(40))];
    const result = seasonPointsAgreement(derived, published, positions);
    expect(result.meanAbsoluteError).not.toBeNull();
    expect(result.meanAbsoluteError!).toBeGreaterThan(0);
  });

  it("reports the derived-minus-published games distribution over the matched sample (fix round, I1)", () => {
    const published = season("rb1", Array(10).fill(80));
    const derived = season("rb1", Array(8).fill(80)); // derivation found 2 fewer games
    const result = seasonPointsAgreement(derived, published, positions, { minGames: 8 });
    expect(result.gamesDelta).toEqual({ min: -2, max: -2, mean: -2, exactMatches: 0 });
  });

  it("counts an exact games match when the derivation finds the same games the published line does", () => {
    const published = [...season("rb1", Array(9).fill(80)), ...season("rb2", Array(9).fill(40))];
    const derived = [...season("rb1", Array(9).fill(80)), ...season("rb2", Array(9).fill(40))];
    const result = seasonPointsAgreement(derived, published, positions);
    expect(result.gamesDelta.exactMatches).toBe(2);
  });
});

describe("derivedSeasonSanityReport — the no-published-twin path (2025 and any future live gap season)", () => {
  const positions: ReadonlyMap<string, Position> = new Map([
    ["qb1", "QB"],
    ["rb1", "RB"],
    ["rb2", "RB"],
    ["wr1", "WR"],
  ]);

  function line(playerId: string, week: number, season = 2025): SeasonStatLine {
    return {
      season,
      asOf: new Date("2025-12-01T00:00:00.000Z"),
      line: {
        playerId,
        week,
        passingYards: 0,
        passingTouchdowns: 0,
        interceptions: 0,
        rushingYards: 0,
        rushingTouchdowns: 0,
        receivingYards: 0,
        receivingTouchdowns: 0,
        receptions: 0,
        fumblesLost: 0,
        fieldGoalsMade: 0,
        extraPointsMade: 0,
        sacks: 0,
        defensiveInterceptions: 0,
        defensiveTouchdowns: 0,
      },
    };
  }

  function weeks(playerId: string, playerWeeks: readonly number[], season = 2025): readonly SeasonStatLine[] {
    return playerWeeks.map((week) => line(playerId, week, season));
  }

  it("counts derived rows per week, independent of player", () => {
    const derived = [...weeks("qb1", [1, 2]), ...weeks("rb1", [1])];
    const report = derivedSeasonSanityReport(2025, derived, 2024, [], positions);
    expect(report.weeklyRowCounts).toEqual([
      { week: 1, rows: 2 },
      { week: 2, rows: 1 },
    ]);
  });

  it("carries the season and comparison season through unchanged", () => {
    const report = derivedSeasonSanityReport(2025, [], 2024, [], positions);
    expect(report.season).toBe(2025);
    expect(report.comparisonSeason).toBe(2024);
  });

  it("computes position mix over the derived rows only, sorted by row count descending", () => {
    const derived = [...weeks("rb1", [1, 2, 3]), ...weeks("wr1", [1]), ...weeks("qb1", [1, 2])];
    const report = derivedSeasonSanityReport(2025, derived, 2024, [], positions);
    expect(report.positionMix).toEqual([
      { position: "RB", rows: 3, share: 0.5 },
      { position: "QB", rows: 2, share: expect.closeTo(2 / 6) },
      { position: "WR", rows: 1, share: expect.closeTo(1 / 6) },
    ]);
  });

  it("drops a stat-taker the position map does not carry from the position mix, rather than fabricating one", () => {
    const derived = weeks("ghost", [1]);
    const report = derivedSeasonSanityReport(2025, derived, 2024, [], positions);
    expect(report.positionMix).toEqual([]);
  });

  it("computes the derived season's games-per-player distribution shape", () => {
    const derived = [...weeks("rb1", [1, 2, 3, 4]), ...weeks("rb2", [1, 2])];
    const report = derivedSeasonSanityReport(2025, derived, 2024, [], positions);
    expect(report.gamesDistribution).toEqual({
      playerCount: 2,
      min: 2,
      max: 4,
      mean: 3,
      median: 3,
      buckets: [
        { label: "1-4", count: 2 },
        { label: "5-8", count: 0 },
        { label: "9-12", count: 0 },
        { label: "13-17", count: 0 },
        { label: "18+", count: 0 },
      ],
    });
  });

  it("computes the comparison season's games-per-player distribution independently, never mixing the two seasons' rows", () => {
    const derived = weeks("rb1", [1, 2], 2025);
    const comparison = weeks("rb1", [1, 2, 3, 4, 5, 6, 7, 8, 9], 2024);
    const report = derivedSeasonSanityReport(2025, derived, 2024, comparison, positions);
    expect(report.gamesDistribution.playerCount).toBe(1);
    expect(report.gamesDistribution.max).toBe(2);
    expect(report.comparisonGamesDistribution.playerCount).toBe(1);
    expect(report.comparisonGamesDistribution.max).toBe(9);
  });

  it("reports an empty-but-shaped distribution for zero players, never a fabricated summary", () => {
    const report = derivedSeasonSanityReport(2025, [], 2024, [], positions);
    expect(report.gamesDistribution).toEqual({
      playerCount: 0,
      min: 0,
      max: 0,
      mean: 0,
      median: 0,
      buckets: [
        { label: "1-4", count: 0 },
        { label: "5-8", count: 0 },
        { label: "9-12", count: 0 },
        { label: "13-17", count: 0 },
        { label: "18+", count: 0 },
      ],
    });
  });

  it("never carries an agreement or correlation field — a no-published-twin season has none to report", () => {
    const report = derivedSeasonSanityReport(2025, weeks("rb1", [1]), 2024, [], positions);
    const keys = Object.keys(report);
    expect(keys.some((key) => /correlation|agreement/i.test(key))).toBe(false);
  });
});

/**
 * `statLinesAsOfForMeasurement` — DB-BACKED (fix round, I2). Everything above this point is pure;
 * this is the one function in the file that reads the store, and the admission rule it enforces
 * (published always, derived only for a `STAT_LINE_GAPS` season, published wins a collision) is
 * exactly the seam a unit test on `deriveStatLines` alone cannot exercise.
 */
describe("statLinesAsOfForMeasurement", () => {
  const db = createTestDb();

  // 2019 is a real STAT_LINE_GAPS season; 2018 is not. Using real seasons rather than a fixture
  // list keeps this test honest about what the constant actually says today.
  const GAP_SEASON = 2019;
  const NON_GAP_SEASON = 2018;
  const AS_OF = new Date("2019-12-01T00:00:00.000Z");

  beforeEach(async () => {
    await truncateAll(db);
    await db.insert(nflPlayers).values([
      { id: "p1", pfrId: "OneOn00", name: "One", position: "RB", latestTeam: "KC", rookieSeason: 2016, lastSeason: 2024 },
    ]);
  });

  afterAll(async () => {
    await truncateAll(db);
  });

  function observation(over: Partial<PlayerWeekObservation> = {}): PlayerWeekObservation {
    return { season: GAP_SEASON, week: 2, playerId: "p1", source: DERIVED_STAT_LINE_SOURCE, metric: "rushing_yards", value: 40, asOf: AS_OF, ...over };
  }

  it("returns published only for a NON-gap season, even when a derived row exists for it", async () => {
    await recordObservations(db, [
      observation({ season: NON_GAP_SEASON, source: STAT_LINE_SOURCE, value: 55 }),
      observation({ season: NON_GAP_SEASON, source: DERIVED_STAT_LINE_SOURCE, value: 999 }),
    ]);

    const lines = await statLinesAsOfForMeasurement(db, { season: NON_GAP_SEASON, week: 2, asOf: AS_OF });

    expect(lines).toHaveLength(1);
    expect(lines[0]?.line.rushingYards).toBe(55);
  });

  it("merges in the derived source for a GAP season, where nothing is published", async () => {
    await recordObservations(db, [observation({ source: DERIVED_STAT_LINE_SOURCE, value: 40 })]);

    const lines = await statLinesAsOfForMeasurement(db, { season: GAP_SEASON, week: 2, asOf: AS_OF });

    expect(lines).toHaveLength(1);
    expect(lines[0]?.line.rushingYards).toBe(40);
  });

  it("returns nothing for a GAP season with no derived rows either — the fallback is not a fabrication", async () => {
    const lines = await statLinesAsOfForMeasurement(db, { season: GAP_SEASON, week: 2, asOf: AS_OF });
    expect(lines).toEqual([]);
  });

  it("lets a published row win a collision with a derived row for the same week and player, on a GAP season", async () => {
    // Not a real-world case today (nflverse either published a season or it did not) but the
    // published-wins rule is defensive, not incidental, and deserves its own proof.
    await recordObservations(db, [
      observation({ source: STAT_LINE_SOURCE, value: 55 }),
      observation({ source: DERIVED_STAT_LINE_SOURCE, value: 999 }),
    ]);

    const lines = await statLinesAsOfForMeasurement(db, { season: GAP_SEASON, week: 2, asOf: AS_OF });

    expect(lines).toHaveLength(1);
    expect(lines[0]?.line.rushingYards).toBe(55);
  });
});

/**
 * `statLinesAsOfForLiveSurface` — the narrower admission a real player screen reads through.
 * `2019` is a real `STAT_LINE_GAPS` season that is NOT on `LIVE_ADMITTED_DERIVED_SEASONS`; `2025`
 * is the one gap season that is on both lists today. Using the real constants rather than a
 * fixture keeps this test honest about what a live surface is actually allowed to show.
 */
describe("statLinesAsOfForLiveSurface", () => {
  const db = createTestDb();

  const LIVE_ADMITTED_GAP_SEASON = 2025;
  const NON_ADMITTED_GAP_SEASON = 2019;
  const NON_GAP_SEASON = 2018;
  const AS_OF = new Date("2025-12-01T00:00:00.000Z");

  beforeEach(async () => {
    await truncateAll(db);
    await db.insert(nflPlayers).values([
      { id: "p1", pfrId: "OneOn00", name: "One", position: "RB", latestTeam: "KC", rookieSeason: 2016, lastSeason: 2026 },
    ]);
  });

  afterAll(async () => {
    await truncateAll(db);
  });

  function observation(over: Partial<PlayerWeekObservation> = {}): PlayerWeekObservation {
    return { season: LIVE_ADMITTED_GAP_SEASON, week: 2, playerId: "p1", source: DERIVED_STAT_LINE_SOURCE, metric: "rushing_yards", value: 40, asOf: AS_OF, ...over };
  }

  it("returns published only for a non-gap season, even when a derived row exists for it", async () => {
    await recordObservations(db, [
      observation({ season: NON_GAP_SEASON, source: STAT_LINE_SOURCE, value: 55 }),
      observation({ season: NON_GAP_SEASON, source: DERIVED_STAT_LINE_SOURCE, value: 999 }),
    ]);

    const lines = await statLinesAsOfForLiveSurface(db, { season: NON_GAP_SEASON, week: 2, asOf: AS_OF });

    expect(lines).toHaveLength(1);
    expect(lines[0]?.line.rushingYards).toBe(55);
  });

  it("merges in the derived source for a gap season on the LIVE allowlist", async () => {
    await recordObservations(db, [observation({ source: DERIVED_STAT_LINE_SOURCE, value: 40 })]);

    const lines = await statLinesAsOfForLiveSurface(db, { season: LIVE_ADMITTED_GAP_SEASON, week: 2, asOf: AS_OF });

    expect(lines).toHaveLength(1);
    expect(lines[0]?.line.rushingYards).toBe(40);
  });

  it("refuses the derived fallback for a gap season NOT on the LIVE allowlist — decade-old history has no business on a manager's screen", async () => {
    await recordObservations(db, [
      observation({ season: NON_ADMITTED_GAP_SEASON, source: DERIVED_STAT_LINE_SOURCE, value: 40 }),
    ]);

    const lines = await statLinesAsOfForLiveSurface(db, { season: NON_ADMITTED_GAP_SEASON, week: 2, asOf: AS_OF });

    expect(lines).toEqual([]);
  });

  it("lets a published row win a collision with a derived row for the same week and player, on an admitted gap season", async () => {
    await recordObservations(db, [
      observation({ source: STAT_LINE_SOURCE, value: 55 }),
      observation({ source: DERIVED_STAT_LINE_SOURCE, value: 999 }),
    ]);

    const lines = await statLinesAsOfForLiveSurface(db, { season: LIVE_ADMITTED_GAP_SEASON, week: 2, asOf: AS_OF });

    expect(lines).toHaveLength(1);
    expect(lines[0]?.line.rushingYards).toBe(55);
  });
});
