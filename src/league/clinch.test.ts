import { describe, it, expect } from "vitest";
import { clinchedTeamIds } from "./clinch";
import type { StandingsRow } from "./standings";

const row = (teamId: string, wins: number): StandingsRow => ({ teamId, wins, losses: 0, ties: 0, pointsFor: 0, pointsAgainst: 0 });

describe("clinchedTeamIds", () => {
  it("names the teams nobody outside the cut can still catch", () => {
    const standings = [row("a", 9), row("b", 8), row("c", 4), row("d", 3)];
    expect(clinchedTeamIds({ standings, weeksRemaining: 3, playoffTeams: 2 })).toEqual(["a", "b"]);
  });

  it("names nobody while the chasing team could still catch up", () => {
    const standings = [row("a", 6), row("b", 5), row("c", 4)];
    expect(clinchedTeamIds({ standings, weeksRemaining: 3, playoffTeams: 2 })).toEqual([]);
  });

  it("treats a league no bigger than the playoff field as everybody clinched", () => {
    const standings = [row("a", 1), row("b", 0)];
    expect(clinchedTeamIds({ standings, weeksRemaining: 5, playoffTeams: 6 })).toEqual(["a", "b"]);
  });

  it("requires being strictly ahead once the season is over", () => {
    const standings = [row("a", 5), row("b", 4), row("c", 4)];
    expect(clinchedTeamIds({ standings, weeksRemaining: 0, playoffTeams: 2 })).toEqual(["a"]);
  });
});
