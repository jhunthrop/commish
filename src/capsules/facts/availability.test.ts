import { describe, expect, it } from "vitest";
import { gamesMissedFor, seasonEndingsFor } from "./availability";

describe("seasonEndingsFor", () => {
  it("reports the season the injury report anchored, with the league's own words for the body part", () => {
    expect(
      seasonEndingsFor([
        { season: 2025, injuryRows: [{ week: 5, reportStatus: "Out", primaryInjury: "Knee" }], statusRows: [], gamesPlayedWeeks: [1, 2, 3, 4] },
      ]),
    ).toEqual([{ season: 2025, lastPlayedWeek: 4, firstMissedWeek: 5, source: "report", reportStatus: "Out", rosterStatus: null, primaryInjury: "Knee" }]);
  });

  it("says nothing at all about a season the store holds no rows for", () => {
    expect(seasonEndingsFor([{ season: 2024, injuryRows: [], statusRows: [], gamesPlayedWeeks: [] }])).toEqual([]);
  });

  it("falls back to the weekly roster and invents no body part when the report is silent", () => {
    expect(
      seasonEndingsFor([
        {
          season: 2025,
          injuryRows: [],
          statusRows: [
            { week: 6, status: "RES" },
            { week: 7, status: "RES" },
          ],
          gamesPlayedWeeks: [1, 2, 3, 4, 5],
        },
      ]),
    ).toEqual([{ season: 2025, lastPlayedWeek: 5, firstMissedWeek: 6, source: "status", reportStatus: null, rosterStatus: "RES", primaryInjury: null }]);
  });

  it("reads an empty injury text as no body part on file rather than as an empty string", () => {
    const [ending] = seasonEndingsFor([
      { season: 2025, injuryRows: [{ week: 3, reportStatus: "Out", primaryInjury: "" }], statusRows: [], gamesPlayedWeeks: [1, 2] },
    ]);
    expect(ending!.primaryInjury).toBeNull();
  });

  it("never reports a mid-season absence he came back from", () => {
    expect(
      seasonEndingsFor([
        {
          season: 2025,
          injuryRows: [
            { week: 5, reportStatus: "Out", primaryInjury: "Ankle" },
            { week: 6, reportStatus: "Out", primaryInjury: "Ankle" },
          ],
          statusRows: [],
          gamesPlayedWeeks: [1, 2, 3, 4, 7, 8],
        },
      ]),
    ).toEqual([]);
  });
});

describe("gamesMissedFor", () => {
  it("counts only the weeks the roster actually carried him", () => {
    expect(gamesMissedFor([{ season: 2025, teamGames: 17, rosteredWeeks: [1, 2, 3, 4, 5, 6], gamesPlayedWeeks: [1, 2, 3] }])).toEqual([
      { season: 2025, missed: 3, teamGames: 17 },
    ]);
  });

  it("omits a season the roster never carried him at all rather than calling it zero missed", () => {
    expect(
      gamesMissedFor([
        { season: 2025, teamGames: 17, rosteredWeeks: [1, 2], gamesPlayedWeeks: [1, 2] },
        { season: 2024, teamGames: 17, rosteredWeeks: [], gamesPlayedWeeks: [] },
      ]),
    ).toEqual([{ season: 2025, missed: 0, teamGames: 17 }]);
  });
});
