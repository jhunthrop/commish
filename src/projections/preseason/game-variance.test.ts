import { describe, expect, it } from "vitest";
import type { GamesPlayedOutlook } from "./availability";
import { fitGameVariance, seasonPointsBand, VARIANCE_POSITIONS, type GameVarianceObservation } from "./game-variance";

function observation(overrides: Partial<GameVarianceObservation> = {}): GameVarianceObservation {
  return { season: 2023, playerId: "p", position: "RB", playerClass: "veteran", weeklyPoints: [10, 12, 8, 11], ...overrides };
}

function outlook(expected: number, probabilities: readonly number[]): GamesPlayedOutlook {
  return { expected, rate: expected / 17, distribution: { floor: 0, median: 0, ceiling: 17 }, probabilities };
}

describe("fitGameVariance", () => {
  it("refuses a held-out season", () => {
    expect(() => fitGameVariance([observation({ season: 2025 })], { heldOutSeasons: [2025] })).toThrow(/held out/);
  });

  it("measures a real, non-negative pooled variance from real weekly spread", () => {
    const observations: readonly GameVarianceObservation[] = Array.from({ length: 25 }, (_, index) =>
      observation({ playerId: `v-${index}`, weeklyPoints: [10 + (index % 3), 8, 14, 9] }),
    );
    const priors = fitGameVariance(observations, { heldOutSeasons: [] });
    expect(priors.veteran.RB).toBeGreaterThan(0);
    // Every position gets SOME cell, even one with no observations (falls back to zero via the
    // combined-pool branch, which itself sees nothing).
    for (const position of VARIANCE_POSITIONS) {
      expect(priors.veteran[position]).toBeGreaterThanOrEqual(0);
      expect(priors.rookie[position]).toBeGreaterThanOrEqual(0);
    }
  });

  it("drops a single-week player-season from the estimate rather than treating it as zero spread", () => {
    const oneWeekOnly = Array.from({ length: 25 }, (_, index) => observation({ playerId: `s-${index}`, weeklyPoints: [15] }));
    const priors = fitGameVariance(oneWeekOnly, { heldOutSeasons: [] });
    expect(priors.veteran.RB).toBe(0);
  });

  it("falls back to the position's combined pool when one class's own cell is too thin", () => {
    const thinRookies = [observation({ playerClass: "rookie", playerId: "r-1", weeklyPoints: [5, 25] })];
    const manyVeterans = Array.from({ length: 25 }, (_, index) => observation({ playerId: `v-${index}`, weeklyPoints: [10, 10, 10, 10] }));
    const priors = fitGameVariance([...thinRookies, ...manyVeterans], { heldOutSeasons: [] });
    // The rookie cell (n=1) is too thin to trust alone, so it borrows the COMBINED pool rather than
    // reporting the single pair's own unstable spread — which would be (25-5)^2/2/1 = 200, wildly
    // larger than the combined pool (dominated by twenty-five zero-spread veteran-seasons).
    expect(priors.rookie.RB).toBeLessThan(50);
  });
});

describe("seasonPointsBand", () => {
  it("widens the band as per-game variance grows, holding availability fixed", () => {
    const games = outlook(14, [0, 0, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0, 0, 0, 0, 0, 0, 0]);
    const narrow = seasonPointsBand(15, games, 4);
    const wide = seasonPointsBand(15, games, 100);
    expect(wide.ceiling - wide.floor).toBeGreaterThan(narrow.ceiling - narrow.floor);
    expect(narrow.median).toBeCloseTo(wide.median, 6);
  });

  it("keeps floor <= median <= ceiling, and floor never negative", () => {
    const games = outlook(2, [0.5, 0.3, 0.2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    const band = seasonPointsBand(30, games, 400);
    expect(band.floor).toBeGreaterThanOrEqual(0);
    expect(band.floor).toBeLessThanOrEqual(band.median);
    expect(band.median).toBeLessThanOrEqual(band.ceiling);
  });

  it("degrades gracefully with no probability vector at all (a hand-built test fixture)", () => {
    const games: GamesPlayedOutlook = { expected: 14, rate: 0.82, distribution: { floor: 10, median: 14, ceiling: 17 }, probabilities: [] };
    const band = seasonPointsBand(15, games, 20);
    expect(band.floor).toBeLessThanOrEqual(band.median);
    expect(band.median).toBeLessThanOrEqual(band.ceiling);
    expect(band.median).toBeCloseTo(15 * 14, 6);
  });

  it("still varies availability risk into the band even at zero per-game variance", () => {
    const games = outlook(10, [0.2, 0.2, 0.2, 0.2, 0.2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    const band = seasonPointsBand(20, games, 0);
    expect(band.ceiling).toBeGreaterThan(band.floor);
  });
});
