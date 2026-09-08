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
  const active = (weeks: readonly number[]) => weeks.map((week) => ({ week, status: "ACT" }));

  it("reads a healthy backup as games played, a first appearance and NO games missed: his unplayed weeks were a role, not an absence", () => {
    // Tyler Shough, 2025: active every rostered week, no designation all season, eleven games.
    expect(
      gamesMissedFor([
        {
          season: 2025,
          teamGames: 17,
          covered: true,
          rosterRows: active([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 13, 14, 15, 16, 17, 18]),
          injuryRows: [{ week: 16, reportStatus: "", primaryInjury: "" }],
          gamesPlayedWeeks: [3, 8, 9, 10, 12, 13, 14, 15, 16, 17, 18],
        },
      ]),
    ).toEqual([{ season: 2025, teamGames: 17, gamesPlayed: 11, firstPlayedWeek: 3, unavailableWeeks: [], healthyDidNotPlay: 6 }]);
  });

  it("dates every week the archives say he was unavailable, and counts the healthy scratches apart", () => {
    expect(
      gamesMissedFor([
        {
          season: 2025,
          teamGames: 17,
          covered: true,
          rosterRows: [...active([1, 2]), { week: 3, status: "INA" }, { week: 4, status: "RES" }, { week: 5, status: "RES" }, ...active([6, 7])],
          injuryRows: [{ week: 3, reportStatus: "Out", primaryInjury: "Knee" }],
          gamesPlayedWeeks: [1, 2, 7],
        },
      ]),
    ).toEqual([{ season: 2025, teamGames: 17, gamesPlayed: 3, firstPlayedWeek: 1, unavailableWeeks: [3, 4, 5], healthyDidNotPlay: 1 }]);
  });

  it("renders an uncovered season as played games with the injury count ABSENT, never zero", () => {
    expect(gamesMissedFor([{ season: 2024, teamGames: 17, covered: false, rosterRows: [], injuryRows: [], gamesPlayedWeeks: [5, 6] }])).toEqual([
      { season: 2024, teamGames: 17, gamesPlayed: 2, firstPlayedWeek: 5, unavailableWeeks: null, healthyDidNotPlay: null },
    ]);
  });

  it("omits a season neither the roster nor the stat store knows him in, rather than calling it clean", () => {
    expect(
      gamesMissedFor([
        { season: 2025, teamGames: 17, covered: true, rosterRows: active([1, 2]), injuryRows: [], gamesPlayedWeeks: [1, 2] },
        { season: 2024, teamGames: 17, covered: true, rosterRows: [], injuryRows: [], gamesPlayedWeeks: [] },
      ]),
    ).toEqual([{ season: 2025, teamGames: 17, gamesPlayed: 2, firstPlayedWeek: 1, unavailableWeeks: [], healthyDidNotPlay: 0 }]);
  });

  it("carries no first appearance for a man who never played, and every rostered week as unavailable when the roster says so", () => {
    expect(
      gamesMissedFor([
        { season: 2025, teamGames: 17, covered: true, rosterRows: Array.from({ length: 17 }, (_, index) => ({ week: index + 1, status: "RES" })), injuryRows: [], gamesPlayedWeeks: [] },
      ]),
    ).toEqual([{ season: 2025, teamGames: 17, gamesPlayed: 0, firstPlayedWeek: null, unavailableWeeks: Array.from({ length: 17 }, (_, index) => index + 1), healthyDidNotPlay: 0 }]);
  });
});
