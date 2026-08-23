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

  it("ranks a 5-1-1 record above a 5-2-0 record, even when the 5-2-0 team has more points for", () => {
    // x: 5 wins (low-scoring blowouts) + 1 tie + 1 loss → win pct 5.5/7.
    // y: 5 wins (high-scoring blowouts) + 2 losses → win pct 5/7, but far more points for.
    // A ties-blind sort (wins, then points for) would rank y above x; ties must count.
    const matchups: Matchup[] = [
      ...Array.from({ length: 5 }, (_, i) => m(i + 1, "x", "z", 10, 0)),
      m(6, "x", "w", 5, 5),
      m(7, "x", "w", 0, 100),
      ...Array.from({ length: 5 }, (_, i) => m(i + 1, "y", "z", 100, 0)),
      m(6, "y", "w", 0, 100),
      m(7, "y", "w", 0, 100),
    ];
    const rows = computeStandings({ teamIds: ["x", "y", "z", "w"], matchups });
    const x = rows.find((r) => r.teamId === "x")!;
    const y = rows.find((r) => r.teamId === "y")!;
    expect(x).toMatchObject({ wins: 5, losses: 1, ties: 1 });
    expect(y).toMatchObject({ wins: 5, losses: 2, ties: 0 });
    expect(y.pointsFor).toBeGreaterThan(x.pointsFor);
    expect(rows.findIndex((r) => r.teamId === "x")).toBeLessThan(rows.findIndex((r) => r.teamId === "y"));
  });

  it("gives every team a second result each week when the median is on", () => {
    // Twelve teams, one week, scores 1..12. The median is 6.5, so six teams beat it and six do
    // not: the median game cannot invent wins for the league as a whole, it redistributes them.
    const teamIds = Array.from({ length: 12 }, (_, i) => `t${i + 1}`);
    const weekOne: Matchup[] = [
      m(1, "t1", "t2", 1, 2), m(1, "t3", "t4", 3, 4), m(1, "t5", "t6", 5, 6),
      m(1, "t7", "t8", 7, 8), m(1, "t9", "t10", 9, 10), m(1, "t11", "t12", 11, 12),
    ];
    const rows = computeStandings({ teamIds, matchups: weekOne, medianByWeek: new Map([[1, 6.5]]) });
    expect(rows.reduce((n, r) => n + r.wins, 0)).toBe(12);
    expect(rows.reduce((n, r) => n + r.wins + r.losses + r.ties, 0)).toBe(24);
  });

  it("leaves points for and points against alone, because the median is not an opponent", () => {
    // The median's own win/loss shifts a team's RANK (byRecord sorts on wins first), so the two
    // result sets are compared by team id rather than by array position, which the median run
    // deliberately reorders.
    const teamIds = ["a", "b", "c", "d"];
    const weekOne: Matchup[] = [m(1, "a", "b", 100, 90), m(1, "c", "d", 80, 70)];
    const withMedian = computeStandings({ teamIds, matchups: weekOne, medianByWeek: new Map([[1, 85]]) });
    const without = computeStandings({ teamIds, matchups: weekOne });
    const byId = <T extends { readonly teamId: string }>(rows: readonly T[]) => new Map(rows.map((r) => [r.teamId, r]));
    const withMedianById = byId(withMedian);
    const withoutById = byId(without);
    for (const teamId of teamIds) {
      expect(withMedianById.get(teamId)!.pointsFor).toBe(withoutById.get(teamId)!.pointsFor);
      expect(withMedianById.get(teamId)!.pointsAgainst).toBe(withoutById.get(teamId)!.pointsAgainst);
    }
  });

  it("ignores a week whose median is absent, exactly as it ignores a half-scored matchup", () => {
    const teamIds = ["a", "b"];
    const weekOne: Matchup[] = [m(1, "a", "b", 100, 90)];
    expect(computeStandings({ teamIds, matchups: weekOne, medianByWeek: new Map() })).toEqual(
      computeStandings({ teamIds, matchups: weekOne }),
    );
  });

  it("scores a team's own median result the same three-way split a head-to-head gets", () => {
    const teamIds = ["a", "b"];
    // "a" ties the median exactly; "b" beats it.
    const weekOne: Matchup[] = [m(1, "a", "b", 100, 110)];
    const rows = computeStandings({ teamIds, matchups: weekOne, medianByWeek: new Map([[1, 100]]) });
    const a = rows.find((r) => r.teamId === "a")!;
    const b = rows.find((r) => r.teamId === "b")!;
    // Head-to-head: a lost to b. Median: a ties it (score === median), b beats it.
    expect(a).toMatchObject({ wins: 0, losses: 1, ties: 1 });
    expect(b).toMatchObject({ wins: 2, losses: 0, ties: 0 });
  });
});
