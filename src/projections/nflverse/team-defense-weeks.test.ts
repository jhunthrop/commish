import { describe, expect, it } from "vitest";
import type { CsvRow } from "./csv";
import { mapSchedule } from "./schedule";
import { mapTeamDefenseWeekRows, pointsAllowedByTeamWeek, teamWeekKey } from "./team-defense-weeks";

/** The mapper with no scoreline for any week — every `pointsAllowed` comes back `null`. The
 *  cases below are about the stats file's own columns, which the schedule join does not touch. */
function mapWithoutScores(rows: readonly CsvRow[]) {
  return mapTeamDefenseWeekRows(rows, new Map<string, number>());
}

const COLUMNS = [
  "def_sacks", "def_interceptions", "fumble_recovery_opp", "def_tds", "def_safeties",
  "def_punt_blocks", "def_pat_blocks", "def_fg_blocks", "special_teams_tds",
  "passing_yards", "rushing_yards", "sack_yards_lost",
] as const;

function row(overrides: Record<string, string> = {}): CsvRow {
  const base: Record<string, string> = {
    season: "2024", week: "1", team: "ARI", season_type: "REG", opponent_team: "BUF",
  };
  for (const column of COLUMNS) base[column] = "0";
  return { ...base, ...overrides };
}

describe("mapTeamDefenseWeekRows", () => {
  it("writes each team's yards allowed from its OPPONENT's own offense row", () => {
    const mapped = mapWithoutScores([
      row({ team: "ARI", opponent_team: "BUF", passing_yards: "162", rushing_yards: "124", def_sacks: "2", sack_yards_lost: "31" }),
      row({ team: "BUF", opponent_team: "ARI", passing_yards: "232", rushing_yards: "88", def_sacks: "4", sack_yards_lost: "12" }),
    ]);
    const arizona = mapped.find((r) => r.team === "ARI");
    const buffalo = mapped.find((r) => r.team === "BUF");
    expect(arizona?.passingYardsAllowed).toBe(232);
    expect(arizona?.rushingYardsAllowed).toBe(88);
    expect(arizona?.sacks).toBe(2);
    // The sack yardage the OPPONENT lost, which is what nets Arizona's yards allowed.
    expect(arizona?.sackYardsLostAllowed).toBe(12);
    expect(buffalo?.sackYardsLostAllowed).toBe(31);
    expect(buffalo?.passingYardsAllowed).toBe(162);
    expect(buffalo?.rushingYardsAllowed).toBe(124);
    expect(buffalo?.sacks).toBe(4);
  });

  it("reads every defensive column the release publishes", () => {
    const [mapped] = mapWithoutScores([
      row({
        def_sacks: "3.5", def_interceptions: "2", fumble_recovery_opp: "1", def_tds: "1",
        def_safeties: "1", def_punt_blocks: "1", def_pat_blocks: "1", def_fg_blocks: "1",
        special_teams_tds: "1",
      }),
      row({ team: "BUF", opponent_team: "ARI" }),
    ]);
    expect(mapped).toEqual({
      season: 2024, week: 1, team: "ARI", opponentTeam: "BUF",
      sacks: 3.5, interceptions: 2, fumbleRecoveries: 1, defensiveTouchdowns: 1, safeties: 1,
      puntBlocks: 1, extraPointBlocks: 1, fieldGoalBlocks: 1, specialTeamsTouchdowns: 1,
      passingYardsAllowed: 0, rushingYardsAllowed: 0, pointsAllowed: null, sackYardsLostAllowed: 0,
    });
  });

  it("drops a row whose opponent has no row in the file, rather than inventing a zero", () => {
    expect(mapWithoutScores([row({ team: "ARI", opponent_team: "BUF" })])).toEqual([]);
  });

  it("drops the postseason", () => {
    expect(
      mapWithoutScores([
        row({ season_type: "POST" }),
        row({ team: "BUF", opponent_team: "ARI", season_type: "POST" }),
      ]),
    ).toEqual([]);
  });

  it("refuses a file missing an allowlisted column rather than reading it as zero", () => {
    const missing: Record<string, string> = { ...row() };
    delete missing.def_fg_blocks;
    expect(() => mapWithoutScores([missing])).toThrow(/def_fg_blocks/);
  });

  it("refuses an unreadable counting cell", () => {
    expect(() =>
      mapWithoutScores([row({ def_sacks: "n/a" }), row({ team: "BUF", opponent_team: "ARI" })]),
    ).toThrow(/def_sacks/);
  });

  it("refuses a row with no readable season or week", () => {
    expect(() => mapWithoutScores([row({ season: "" })])).toThrow(/season\/week/);
  });

  it("returns season, week, team order", () => {
    const mapped = mapWithoutScores([
      row({ week: "2", team: "BUF", opponent_team: "ARI" }),
      row({ week: "2", team: "ARI", opponent_team: "BUF" }),
      row({ week: "1", team: "BUF", opponent_team: "ARI" }),
      row({ week: "1", team: "ARI", opponent_team: "BUF" }),
    ]);
    expect(mapped.map((r) => [r.week, r.team])).toEqual([[1, "ARI"], [1, "BUF"], [2, "ARI"], [2, "BUF"]]);
  });
});

/** One `games.csv` row, with only the columns `mapSchedule` actually reads. */
function scheduleRow(overrides: Record<string, string> = {}): CsvRow {
  return {
    game_type: "REG", season: "2024", week: "1", gameday: "2024-09-08", gametime: "13:00",
    home_team: "ARI", away_team: "BUF", home_rest: "7", away_rest: "7",
    home_coach: "A Coach", away_coach: "B Coach", div_game: "0", roof: "outdoors",
    home_score: "17", away_score: "31",
    ...overrides,
  };
}

describe("pointsAllowedByTeamWeek", () => {
  it("gives each team the OTHER side's score", () => {
    const byKey = pointsAllowedByTeamWeek(mapSchedule([scheduleRow()], [2024]));
    expect(byKey.get(teamWeekKey(2024, 1, "ARI"))).toBe(31);
    expect(byKey.get(teamWeekKey(2024, 1, "BUF"))).toBe(17);
  });

  it("carries no entry at all for a game with no scoreline, rather than a shutout", () => {
    const byKey = pointsAllowedByTeamWeek(mapSchedule([scheduleRow({ home_score: "", away_score: "" })], [2024]));
    expect(byKey.size).toBe(0);
  });
});

/**
 * THE RELOCATION JOIN. The two files disagree about what a relocated franchise is called in the
 * seasons before it moved: `games.csv` keeps the contemporary code (`STL` for the 2014 Rams) and
 * `stats_team` normalises every row to the club's current code (`LA` for the same game). Folding
 * both through `productTeamCode` is the only reason those weeks join at all — without it, every
 * pre-move season of three franchises would carry a null points allowed and nothing would look
 * broken.
 */
describe("the points-allowed join across a relocation", () => {
  it("joins a 2014 St. Louis schedule row onto the 2014 `LA` stats row", () => {
    const schedule = mapSchedule(
      [scheduleRow({ season: "2014", gameday: "2014-09-07", home_team: "STL", away_team: "SF", home_score: "6", away_score: "28" })],
      [2014],
    );
    const mapped = mapTeamDefenseWeekRows(
      [
        row({ season: "2014", team: "LA", opponent_team: "SF" }),
        row({ season: "2014", team: "SF", opponent_team: "LA" }),
      ],
      pointsAllowedByTeamWeek(schedule),
    );
    expect(mapped.find((r) => r.team === "LA")?.pointsAllowed).toBe(28);
    expect(mapped.find((r) => r.team === "SF")?.pointsAllowed).toBe(6);
  });

  it("writes null for a week the schedule has no scoreline for", () => {
    const mapped = mapTeamDefenseWeekRows(
      [row({ week: "9", team: "ARI", opponent_team: "BUF" }), row({ week: "9", team: "BUF", opponent_team: "ARI" })],
      pointsAllowedByTeamWeek(mapSchedule([scheduleRow()], [2024])),
    );
    expect(mapped.map((r) => r.pointsAllowed)).toEqual([null, null]);
  });
});
