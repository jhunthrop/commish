import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { nflverseKickingWeeks, nflverseTeamDefenseWeeks } from "@research/db/schema";

describe("the kicking and team-defense history tables", () => {
  it("keys a kicking row on season, week and player", () => {
    const config = getTableConfig(nflverseKickingWeeks);
    expect(config.name).toBe("nflverse_kicking_weeks");
    expect(config.primaryKeys[0]?.columns.map((column) => column.name)).toEqual(["season", "week", "player_id"]);
  });

  it("stores every distance bucket the release publishes, made and missed alike", () => {
    const columns = new Set(getTableConfig(nflverseKickingWeeks).columns.map((column) => column.name));
    for (const bucket of ["0_19", "20_29", "30_39", "40_49", "50_59", "60"]) {
      expect(columns.has(`fg_made_${bucket}`)).toBe(true);
      expect(columns.has(`fg_missed_${bucket}`)).toBe(true);
    }
  });

  it("keys a team-defense row on season, week and team", () => {
    const config = getTableConfig(nflverseTeamDefenseWeeks);
    expect(config.name).toBe("nflverse_team_defense_weeks");
    expect(config.primaryKeys[0]?.columns.map((column) => column.name)).toEqual(["season", "week", "team"]);
  });

  it("carries yards allowed as its own column, already in the defense frame", () => {
    const columns = new Set(getTableConfig(nflverseTeamDefenseWeeks).columns.map((column) => column.name));
    expect(columns.has("passing_yards_allowed")).toBe(true);
    expect(columns.has("rushing_yards_allowed")).toBe(true);
    expect(columns.has("opponent_team")).toBe(true);
  });
});
