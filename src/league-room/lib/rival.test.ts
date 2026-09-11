import { describe, it, expect } from "vitest";
import { HOME, MATCHUP } from "../test-fixtures";
import { rivalFacts } from "./rival";

const teams = HOME.teams;

describe("rivalFacts", () => {
  it("names both people, you first, with the final score and its basis once the week settled", () => {
    const facts = rivalFacts({ matchup: MATCHUP, myTeamId: "t1", teams, weekStatus: "final", projectionsByPlayerId: new Map() });
    expect(facts?.mine).toMatchObject({ teamName: "Bay Bandits", owner: { name: "Alex Rivera", avatar: null }, figure: { value: "112.50", basis: "week 5, final" } });
    expect(facts?.theirs).toMatchObject({ teamName: "Iron Owls", owner: { name: "Jordan Lee" }, figure: { value: "98.25", basis: "week 5, final" } });
  });

  it("puts you first even when you are the away side", () => {
    const facts = rivalFacts({ matchup: MATCHUP, myTeamId: "t2", teams, weekStatus: "final", projectionsByPlayerId: new Map() });
    expect(facts?.mine.teamName).toBe("Iron Owls");
    expect(facts?.theirs.teamName).toBe("Bay Bandits");
  });

  it("says so far while games run, and projected before kickoff when the snapshot has numbers", () => {
    const live = { ...MATCHUP, final: false, weekStatus: "in_progress" as const };
    expect(rivalFacts({ matchup: live, myTeamId: "t1", teams, weekStatus: "in_progress", projectionsByPlayerId: new Map() })?.mine.figure).toEqual({ value: "112.50", basis: "week 5, so far" });

    const scheduled = {
      ...MATCHUP,
      final: false,
      weekStatus: "scheduled" as const,
      home: { ...MATCHUP.home, score: null },
      away: { ...MATCHUP.away, score: null },
    };
    const projections = new Map([
      ["qb1", 21.4],
      ["rb1", 15.8],
    ]);
    const facts = rivalFacts({ matchup: scheduled, myTeamId: "t1", teams, weekStatus: "scheduled", projectionsByPlayerId: projections });
    expect(facts?.mine.figure).toEqual({ value: "37.20", basis: "projected, week 5" });
    // Their starters have no projection in the snapshot: a dash and the reason, never a zero.
    expect(facts?.theirs.figure).toEqual({ value: null, basis: "no projection yet, week 5" });
  });

  it("answers null with no matchup or no team of your own, and a null owner for a team that left", () => {
    expect(rivalFacts({ matchup: null, myTeamId: "t1", teams, weekStatus: "scheduled", projectionsByPlayerId: new Map() })).toBeNull();
    expect(rivalFacts({ matchup: MATCHUP, myTeamId: null, teams, weekStatus: "scheduled", projectionsByPlayerId: new Map() })).toBeNull();
    const facts = rivalFacts({ matchup: MATCHUP, myTeamId: "t1", teams: [], weekStatus: "final", projectionsByPlayerId: new Map() });
    expect(facts?.theirs.owner).toBeNull();
  });
});
