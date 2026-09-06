import { describe, expect, it } from "vitest";
import type { CsvRow } from "./csv";
import { mapKickingWeekRows } from "./kicking-weeks";

const KICKING_COLUMNS = [
  "fg_made", "fg_att", "fg_missed", "fg_blocked",
  "fg_made_0_19", "fg_made_20_29", "fg_made_30_39", "fg_made_40_49", "fg_made_50_59", "fg_made_60_",
  "fg_missed_0_19", "fg_missed_20_29", "fg_missed_30_39", "fg_missed_40_49", "fg_missed_50_59", "fg_missed_60_",
  "pat_made", "pat_att", "pat_missed", "pat_blocked",
] as const;

function row(overrides: Record<string, string> = {}): CsvRow {
  const base: Record<string, string> = {
    player_id: "00-0023853",
    position: "K",
    season: "2024",
    week: "1",
    season_type: "REG",
    team: "ARI",
  };
  for (const column of KICKING_COLUMNS) base[column] = "0";
  return { ...base, ...overrides };
}

describe("mapKickingWeekRows", () => {
  it("keeps a kicker's regular-season week and reads every published column", () => {
    const mapped = mapKickingWeekRows([
      row({ fg_made: "2", fg_att: "2", fg_made_20_29: "1", fg_made_30_39: "1", pat_made: "2", pat_att: "2" }),
    ]);
    expect(mapped).toEqual([
      {
        season: 2024, week: 1, playerId: "00-0023853", team: "ARI",
        fieldGoalsMade: 2, fieldGoalsAttempted: 2, fieldGoalsMissed: 0, fieldGoalsBlocked: 0,
        fieldGoalsMade0To19: 0, fieldGoalsMade20To29: 1, fieldGoalsMade30To39: 1,
        fieldGoalsMade40To49: 0, fieldGoalsMade50To59: 0, fieldGoalsMade60Plus: 0,
        fieldGoalsMissed0To19: 0, fieldGoalsMissed20To29: 0, fieldGoalsMissed30To39: 0,
        fieldGoalsMissed40To49: 0, fieldGoalsMissed50To59: 0, fieldGoalsMissed60Plus: 0,
        extraPointsMade: 2, extraPointsAttempted: 2, extraPointsMissed: 0, extraPointsBlocked: 0,
      },
    ]);
  });

  it("drops every row that is not a kicker", () => {
    expect(mapKickingWeekRows([row({ player_id: "00-0023459", position: "QB" })])).toEqual([]);
  });

  it("drops the postseason", () => {
    expect(mapKickingWeekRows([row({ season_type: "POST" })])).toEqual([]);
  });

  it("drops a kicker with no gsis id rather than refusing the file", () => {
    expect(mapKickingWeekRows([row({ player_id: "" })])).toEqual([]);
  });

  it("refuses a file missing an allowlisted column rather than reading it as zero", () => {
    const missing: Record<string, string> = { ...row() };
    delete missing.fg_made_50_59;
    expect(() => mapKickingWeekRows([missing])).toThrow(/fg_made_50_59/);
  });

  it("refuses a row whose counting column is not a number, rather than coarsening it", () => {
    expect(() => mapKickingWeekRows([row({ fg_made: "n/a" })])).toThrow(/fg_made/);
  });

  it("reads an empty counting cell as zero, which is what the release means by it", () => {
    expect(mapKickingWeekRows([row({ fg_blocked: "" })])[0]?.fieldGoalsBlocked).toBe(0);
  });

  it("refuses a row with no readable season or week", () => {
    expect(() => mapKickingWeekRows([row({ week: "" })])).toThrow(/season\/week/);
  });

  it("takes the last row for a duplicated key and returns season, week, player order", () => {
    const mapped = mapKickingWeekRows([
      row({ week: "2", fg_made: "1" }),
      row({ week: "1", fg_made: "3" }),
      row({ week: "1", fg_made: "4" }),
    ]);
    expect(mapped.map((r) => [r.week, r.fieldGoalsMade])).toEqual([[1, 4], [2, 1]]);
  });
});
