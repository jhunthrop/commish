import { describe, expect, it } from "vitest";
import { teamContextFor, type TeamMetricRow } from "./team-context";

const pace = (week: number, value: number): TeamMetricRow => ({ week, metric: "pace_seconds_per_play", value });

describe("teamContextFor", () => {
  it("averages only the weeks the store holds and leaves an absent metric absent", () => {
    expect(teamContextFor(2025, [pace(1, 28), pace(2, 30)], [{ week: 1, metric: "implied_team_total", value: 21.5 }])).toEqual({
      priorSeason: 2025,
      paceSecondsPerPlay: 29,
      passRate: null,
      wins: null,
      weekOneImpliedTotal: 21.5,
      weekOneSpread: null,
    });
  });

  it("sums the schedule's own result rows into a record, half a win for a tie", () => {
    const results = [1, 1, 0.5, 0].map((value, index): TeamMetricRow => ({ week: index + 1, metric: "game_result", value }));
    expect(teamContextFor(2025, results, [])!.wins).toBe(2.5);
  });

  it("returns nothing at all when neither store holds a row about the team", () => {
    expect(teamContextFor(2025, [], [])).toBeNull();
  });

  it("never averages a missing week in as a zero", () => {
    expect(teamContextFor(2025, [pace(1, 30)], [])!.paceSecondsPerPlay).toBe(30);
  });
});
