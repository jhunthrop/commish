import { describe, it, expect } from "vitest";
import * as league from "./index";

describe("the league barrel", () => {
  it("exports every public entry point", () => {
    for (const name of ["LEAGUE_CONFIG", "generateSchedule", "currentWeekNumber", "computeStandings", "clinchedTeamIds", "defaultLineup", "setSlotPlayer", "startersOf", "benchOf", "generateInviteCode"]) {
      expect(league).toHaveProperty(name);
    }
  });
});
