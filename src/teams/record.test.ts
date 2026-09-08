import { describe, expect, it } from "vitest";
import { lastSeasonFor, pointsAllowedFor, recordFor, winTotalFor } from "./record";

const rows = [
  { week: 1, metric: "game_result", value: 1 },
  { week: 2, metric: "game_result", value: 0 },
  { week: 3, metric: "game_result", value: 0.5 },
  { week: 4, metric: "game_result", value: 1 },
  { week: 1, metric: "points_allowed", value: 20 },
  { week: 2, metric: "points_allowed", value: 27 },
  { week: 5, metric: "pace_seconds_per_play", value: 27.1 },
];

describe("recordFor", () => {
  it("counts wins, losses and ties from the result rows", () => {
    expect(recordFor(rows)).toEqual({ wins: 2, losses: 1, ties: 1 });
  });

  it("is null, never 0-0, with no result rows", () => {
    expect(recordFor([{ week: 1, metric: "points_allowed", value: 20 }])).toBeNull();
  });
});

describe("pointsAllowedFor", () => {
  it("sums the weeks that carry the figure and says how many did", () => {
    expect(pointsAllowedFor(rows)).toEqual({ points: 47, games: 2 });
    expect(pointsAllowedFor([])).toBeNull();
  });
});

describe("lastSeasonFor", () => {
  it("is null only when the store holds neither half", () => {
    expect(lastSeasonFor(2025, rows)).toEqual({ season: 2025, record: { wins: 2, losses: 1, ties: 1 }, pointsAllowed: { points: 47, games: 2 } });
    expect(lastSeasonFor(2025, [{ week: 1, metric: "game_result", value: 1 }])).toEqual({ season: 2025, record: { wins: 1, losses: 0, ties: 0 }, pointsAllowed: null });
    expect(lastSeasonFor(2025, [])).toBeNull();
  });
});

describe("winTotalFor", () => {
  it("reads the line and dates it by the observation's own stamp", () => {
    const stamped = [
      { metric: "vegas_win_total_over_price", value: -115, asOf: new Date("2026-08-15T20:43:34.996Z") },
      { metric: "vegas_win_total", value: 10.5, asOf: new Date("2026-08-15T20:43:34.996Z") },
    ];
    expect(winTotalFor(2026, stamped, "vegas_win_total")).toEqual({ season: 2026, line: 10.5, asOf: "2026-08-15" });
    expect(winTotalFor(2026, [], "vegas_win_total")).toBeNull();
  });
});
