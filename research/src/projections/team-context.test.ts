import { describe, expect, it } from "vitest";
import { contextWindow, indexTeamMetrics, latestTeams, rostersFrom, type TeamContext } from "./team-context";

const AS_OF = new Date("2024-10-15T12:00:00.000Z");

function contextOf(over: Partial<TeamContext> = {}): TeamContext {
  return { playerTeams: [], teamObservations: [], ...over };
}

describe("indexTeamMetrics", () => {
  it("keeps two seasons' week 5 apart — the collision that would be silent and wrong", () => {
    const metrics = indexTeamMetrics(
      contextOf({
        teamObservations: [
          { season: 2023, week: 5, team: "CLE", source: "nflverse_pbp", metric: "pace", value: 30, asOf: AS_OF },
          { season: 2024, week: 5, team: "CLE", source: "nflverse_pbp", metric: "pace", value: 26, asOf: AS_OF },
        ],
      }),
    );
    expect(metrics("CLE", { season: 2023, week: 5 }, "pace")).toBe(30);
    expect(metrics("CLE", { season: 2024, week: 5 }, "pace")).toBe(26);
  });

  it("answers null for a fact it does not hold — a team with no pace row did not play at zero", () => {
    expect(indexTeamMetrics(contextOf())("CLE", { season: 2024, week: 5 }, "pace")).toBeNull();
  });
});

describe("contextWindow", () => {
  it("covers all of the prior season and this season up to the week before the target", () => {
    const window = contextWindow(2024, 3, 22);
    expect(window.filter((week) => week.season === 2023)).toHaveLength(22);
    expect(window.filter((week) => week.season === 2024).map((week) => week.week)).toEqual([1, 2]);
  });

  it("never includes the week being predicted — the leak this window exists to prevent", () => {
    expect(contextWindow(2024, 3, 22).some((week) => week.season === 2024 && week.week === 3)).toBe(false);
  });

  it("gives a week-1 prediction the whole prior season rather than nothing at all", () => {
    const window = contextWindow(2024, 1, 22);
    expect(window.every((week) => week.season === 2023)).toBe(true);
    expect(window).toHaveLength(22);
  });
});

describe("latestTeams", () => {
  const edges = [
    { season: 2024, week: 5, playerId: "p1", team: "CLE", asOf: AS_OF },
    { season: 2024, week: 6, playerId: "p1", team: "CLE", asOf: AS_OF },
    { season: 2024, week: 7, playerId: "p1", team: "BUF", asOf: AS_OF },
    { season: 2024, week: 6, playerId: "p2", team: "CLE", asOf: AS_OF },
  ];

  it("takes the most recent week a player is known to have played, not the first", () => {
    // A trade is visible exactly one week after it happened, which is the earliest an engine
    // reading only snap counts can honestly claim to have known about it.
    expect(latestTeams(contextOf({ playerTeams: edges })).get("p1")).toBe("BUF");
  });

  it("builds a roster per team from the same read, so the two can never disagree", () => {
    const rosters = rostersFrom(latestTeams(contextOf({ playerTeams: edges })));
    expect(rosters.get("CLE")).toEqual(["p2"]);
    expect(rosters.get("BUF")).toEqual(["p1"]);
  });
});
