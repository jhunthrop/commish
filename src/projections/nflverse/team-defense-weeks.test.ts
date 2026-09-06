import { describe, expect, it } from "vitest";
import type { CsvRow } from "./csv";
import { mapTeamDefenseWeekRows } from "./team-defense-weeks";

const COLUMNS = [
  "def_sacks", "def_interceptions", "fumble_recovery_opp", "def_tds", "def_safeties",
  "def_punt_blocks", "def_pat_blocks", "def_fg_blocks", "special_teams_tds",
  "passing_yards", "rushing_yards",
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
    const mapped = mapTeamDefenseWeekRows([
      row({ team: "ARI", opponent_team: "BUF", passing_yards: "162", rushing_yards: "124", def_sacks: "2" }),
      row({ team: "BUF", opponent_team: "ARI", passing_yards: "232", rushing_yards: "88", def_sacks: "4" }),
    ]);
    const arizona = mapped.find((r) => r.team === "ARI");
    const buffalo = mapped.find((r) => r.team === "BUF");
    expect(arizona?.passingYardsAllowed).toBe(232);
    expect(arizona?.rushingYardsAllowed).toBe(88);
    expect(arizona?.sacks).toBe(2);
    expect(buffalo?.passingYardsAllowed).toBe(162);
    expect(buffalo?.rushingYardsAllowed).toBe(124);
    expect(buffalo?.sacks).toBe(4);
  });

  it("reads every defensive column the release publishes", () => {
    const [mapped] = mapTeamDefenseWeekRows([
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
      passingYardsAllowed: 0, rushingYardsAllowed: 0,
    });
  });

  it("drops a row whose opponent has no row in the file, rather than inventing a zero", () => {
    expect(mapTeamDefenseWeekRows([row({ team: "ARI", opponent_team: "BUF" })])).toEqual([]);
  });

  it("drops the postseason", () => {
    expect(
      mapTeamDefenseWeekRows([
        row({ season_type: "POST" }),
        row({ team: "BUF", opponent_team: "ARI", season_type: "POST" }),
      ]),
    ).toEqual([]);
  });

  it("refuses a file missing an allowlisted column rather than reading it as zero", () => {
    const missing: Record<string, string> = { ...row() };
    delete missing.def_fg_blocks;
    expect(() => mapTeamDefenseWeekRows([missing])).toThrow(/def_fg_blocks/);
  });

  it("refuses an unreadable counting cell", () => {
    expect(() =>
      mapTeamDefenseWeekRows([row({ def_sacks: "n/a" }), row({ team: "BUF", opponent_team: "ARI" })]),
    ).toThrow(/def_sacks/);
  });

  it("refuses a row with no readable season or week", () => {
    expect(() => mapTeamDefenseWeekRows([row({ season: "" })])).toThrow(/season\/week/);
  });

  it("returns season, week, team order", () => {
    const mapped = mapTeamDefenseWeekRows([
      row({ week: "2", team: "BUF", opponent_team: "ARI" }),
      row({ week: "2", team: "ARI", opponent_team: "BUF" }),
      row({ week: "1", team: "BUF", opponent_team: "ARI" }),
      row({ week: "1", team: "ARI", opponent_team: "BUF" }),
    ]);
    expect(mapped.map((r) => [r.week, r.team])).toEqual([[1, "ARI"], [1, "BUF"], [2, "ARI"], [2, "BUF"]]);
  });
});
