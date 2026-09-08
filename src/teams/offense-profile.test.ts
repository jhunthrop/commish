import { describe, expect, it } from "vitest";
import { offenseProfilesFor } from "./offense-profile";

const week = (week: number, pace: number, passRate: number, proe: number, plays = 30) => [
  { week, metric: "pace_seconds_per_play", value: pace },
  { week, metric: "pass_rate", value: passRate },
  { week, metric: "pass_rate_over_expected", value: proe },
  { week, metric: "neutral_plays", value: plays },
];

const rowsByTeam = new Map([
  ["DET", [...week(1, 27.0, 0.58, 2.0), ...week(2, 27.2, 0.60, 2.8)]],
  ["MIA", [...week(1, 25.0, 0.62, 5.0), ...week(2, 25.4, 0.64, 5.4)]],
  ["CHI", [...week(1, 30.0, 0.50, -3.0)]],
]);

describe("offenseProfilesFor", () => {
  it("means the weeks held and ranks each club among the clubs with a reading", () => {
    const profiles = offenseProfilesFor(2025, rowsByTeam);
    expect(profiles.get("DET")).toEqual({
      season: 2025,
      pace: { value: 27.1, rank: 2, of: 3 },
      passRate: { value: 0.59, rank: 2, of: 3 },
      passRateOverExpected: { value: 2.4, rank: 2, of: 3 },
      neutralPlays: 60,
    });
    expect(profiles.get("MIA")?.pace).toEqual({ value: 25.2, rank: 1, of: 3 });
    expect(profiles.get("CHI")?.passRate).toEqual({ value: 0.5, rank: 3, of: 3 });
  });

  it("ranks fastest pace first and highest pass rate first", () => {
    const profiles = offenseProfilesFor(2025, rowsByTeam);
    expect(profiles.get("CHI")?.pace?.rank).toBe(3);
    expect(profiles.get("MIA")?.passRate?.rank).toBe(1);
  });

  it("shares a rank on a tie and skips the next place", () => {
    const tied = new Map([
      ["A", week(1, 26, 0.5, 0)],
      ["B", week(1, 26, 0.5, 0)],
      ["C", week(1, 28, 0.5, 0)],
    ]);
    const profiles = offenseProfilesFor(2025, tied);
    expect(profiles.get("A")?.pace?.rank).toBe(1);
    expect(profiles.get("B")?.pace?.rank).toBe(1);
    expect(profiles.get("C")?.pace?.rank).toBe(3);
  });

  it("leaves a metric null for a club with no reading of it, and drops a club with none at all", () => {
    const thin = new Map([
      ["DET", [{ week: 1, metric: "pace_seconds_per_play", value: 27 }]],
      ["NYJ", [{ week: 1, metric: "neutral_plays", value: 30 }]],
    ]);
    const profiles = offenseProfilesFor(2025, thin);
    expect(profiles.get("DET")).toEqual({ season: 2025, pace: { value: 27, rank: 1, of: 1 }, passRate: null, passRateOverExpected: null, neutralPlays: null });
    expect(profiles.has("NYJ")).toBe(false);
  });
});
