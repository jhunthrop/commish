import { describe, expect, it } from "vitest";
import { fitRookieGameRate, fitRookiePriors, type RookieObservation } from "./fit";
import { DRAFT_BUCKETS } from "./rookies";

/**
 * THE REGRESSION TEST FOR THE CALIBRATION FIX ROUND'S TASK 1 DEFECT (2026-09-04): a thin, noisy
 * early-round cell no longer drags every later, genuinely-lower-capital bucket down to its own low
 * value. See `fit.ts`'s `isotonicRateOrdering` docblock for the mechanism this pins.
 */

const LEAGUE_TEAM_VOLUME = { targets: 30, carries: 25, passAttempts: 32 } as const;

function observation(overrides: Partial<RookieObservation> = {}): RookieObservation {
  return {
    season: 2023,
    playerId: "p",
    position: "RB",
    overallPick: 16,
    incumbentClaim: 1,
    shares: { snapShare: 0.4, targetShare: 0.05, carryShare: 0.3, passAttemptShare: 0 },
    gamesPlayed: 10,
    teamGames: 17,
    ...overrides,
  };
}

describe("fitRookieGameRate", () => {
  it("refuses a held-out season", () => {
    expect(() => fitRookieGameRate([observation({ season: 2025 })], { heldOutSeasons: [2025] })).toThrow(/held out/);
  });

  it("does NOT let one thin, noisy early bucket drag every later bucket down to its own value", () => {
    // Round one: a single unlucky top pick who barely played (n=1, the exact shape of the real
    // defect — Trent Richardson, pick 3, 2012, is the one real observation at that exact pick).
    // Rounds two/three/four-five: many players with a much higher, mutually consistent rate.
    const observations: readonly RookieObservation[] = [
      observation({ playerId: "r1-a", overallPick: 3, gamesPlayed: 2, teamGames: 17 }),
      ...Array.from({ length: 12 }, (_, index) =>
        observation({ playerId: `r2-${index}`, overallPick: 40, gamesPlayed: 14, teamGames: 17 }),
      ),
      ...Array.from({ length: 12 }, (_, index) =>
        observation({ playerId: `r3-${index}`, overallPick: 90, gamesPlayed: 14, teamGames: 17 }),
      ),
    ];
    const gameRate = fitRookieGameRate(observations, { heldOutSeasons: [] });

    // Still monotone non-increasing — the constraint this whole mechanism exists to enforce.
    for (let index = 1; index < DRAFT_BUCKETS.length; index += 1) {
      expect(gameRate.RB[DRAFT_BUCKETS[index]!]).toBeLessThanOrEqual(gameRate.RB[DRAFT_BUCKETS[index - 1]!]);
    }

    // THE FIX: round one's fitted rate is pulled UP toward its well-evidenced neighbours rather than
    // pulling round two and round three DOWN to its own noisy 2/17. The old "cap each bucket at the
    // one above it" mechanism made round2 and round3 collapse to round1's own raw value; the pooled
    // isotonic fit instead lands all three near their shared weighted mean, well above round one's
    // own unpooled 2/17 ≈ 0.12.
    expect(gameRate.RB.round1).toBeGreaterThan(2 / 17);
    expect(gameRate.RB.round2).toBeGreaterThan(0.5);
    expect(gameRate.RB.round3).toBeGreaterThan(0.5);
  });

  it("is exactly monotone non-increasing even on real, already-ordered input", () => {
    const observations: readonly RookieObservation[] = DRAFT_BUCKETS.flatMap((bucket, index) =>
      Array.from({ length: 8 }, (_, i) =>
        observation({
          playerId: `${bucket}-${i}`,
          overallPick: bucket === "undrafted" ? null : 16 + index * 40,
          gamesPlayed: 14 - index,
          teamGames: 17,
        }),
      ),
    );
    const gameRate = fitRookieGameRate(observations, { heldOutSeasons: [] });
    for (let index = 1; index < DRAFT_BUCKETS.length; index += 1) {
      expect(gameRate.RB[DRAFT_BUCKETS[index]!]).toBeLessThanOrEqual(gameRate.RB[DRAFT_BUCKETS[index - 1]!]);
    }
  });
});

describe("fitRookiePriors", () => {
  it("still computes the shares table, and its own gameRate is the same isotonic fit", () => {
    const observations: readonly RookieObservation[] = [
      observation({ overallPick: 3, gamesPlayed: 2 }),
      ...Array.from({ length: 10 }, (_, index) => observation({ playerId: `x-${index}`, overallPick: 40, gamesPlayed: 14 })),
    ];
    const priors = fitRookiePriors(observations, { heldOutSeasons: [], leagueTeamVolume: LEAGUE_TEAM_VOLUME });
    const gameRate = fitRookieGameRate(observations, { heldOutSeasons: [] });
    expect(priors.gameRate).toEqual(gameRate);
    expect(priors.byBucket.RB.round1.carryShare).toBeGreaterThan(0);
  });
});
