import { describe, it, expect } from "vitest";
import type { Matchup } from "@/domain/schedule";
import { computeStandings } from "./standings";

const m = (weekNumber: number, home: string, away: string, homeScore: number | null, awayScore: number | null): Matchup => ({
  leagueId: "L", weekNumber, homeTeamId: home, awayTeamId: away, homeScore, awayScore,
});

const TEAMS = ["a", "b", "c"];

describe("computeStandings", () => {
  it("counts wins, losses, ties and both points columns", () => {
    const rows = computeStandings({
      teamIds: TEAMS,
      matchups: [m(1, "a", "b", 100.5, 90.25), m(2, "b", "c", 80, 80), m(3, "a", "c", 70, 99)],
    });
    expect(rows.find((r) => r.teamId === "a")).toEqual({ teamId: "a", wins: 1, losses: 1, ties: 0, pointsFor: 170.5, pointsAgainst: 189.25 });
    expect(rows.find((r) => r.teamId === "b")).toEqual({ teamId: "b", wins: 0, losses: 1, ties: 1, pointsFor: 170.25, pointsAgainst: 180.5 });
    expect(rows.find((r) => r.teamId === "c")).toEqual({ teamId: "c", wins: 1, losses: 0, ties: 1, pointsFor: 179, pointsAgainst: 150 });
  });

  it("ignores a week that has not been scored yet", () => {
    const rows = computeStandings({
      teamIds: TEAMS,
      matchups: [m(1, "a", "b", null, null), m(2, "a", "b", null, 90), m(3, "a", "b", 90, null)],
    });
    expect(rows.every((r) => r.wins === 0 && r.losses === 0 && r.ties === 0 && r.pointsFor === 0)).toBe(true);
  });

  it("lists a team with no games at all, so a new league is not an empty table", () => {
    expect(computeStandings({ teamIds: ["a"], matchups: [] })).toEqual([
      { teamId: "a", wins: 0, losses: 0, ties: 0, pointsFor: 0, pointsAgainst: 0 },
    ]);
  });

  it("ignores a matchup involving a team that isn't in the league", () => {
    const rows = computeStandings({ teamIds: ["a"], matchups: [m(1, "a", "ghost", 10, 5), m(2, "ghost", "a", 10, 5)] });
    expect(rows[0]!.wins).toBe(0);
    expect(rows[0]!.losses).toBe(0);
    expect(rows[0]!.pointsFor).toBe(0);
  });

  it("orders by wins, then points for, then team id", () => {
    const rows = computeStandings({
      teamIds: ["a", "b", "c"],
      matchups: [m(1, "a", "c", 50, 40), m(2, "b", "c", 90, 10)],
    });
    expect(rows.map((r) => r.teamId)).toEqual(["b", "a", "c"]);
  });

  it("rounds points the same way the scoring engine does", () => {
    const rows = computeStandings({ teamIds: ["a", "b"], matchups: [m(1, "a", "b", 0.1, 0.2), m(2, "a", "b", 0.2, 0.1)] });
    expect(rows.find((r) => r.teamId === "a")!.pointsFor).toBe(0.3);
  });
});
