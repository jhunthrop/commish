import { describe, expect, it } from "vitest";
import type { PlayerWeekTouches, PlayerWeekUsage } from "../usage";
import {
  targetDepthMultiplier,
  targetDepthRatio,
  targetDepthTotals,
  TARGET_DEPTH_MULTIPLIER_BOUND,
  type TargetDepthPriors,
} from "./target-depth";

/** Readable rather than realistic — the fitted numbers live in `fitted.ts` and move with a refit. */
const PRIORS: TargetDepthPriors = {
  league: { QB: 0, RB: 1, WR: 9, TE: 7, K: 0, DEF: 0 },
  recencyDecay: 1,
  shrinkage: 120,
  yardsElasticity: 0.2,
  receptionsElasticity: -0.1,
};

function touches(over: Partial<PlayerWeekTouches> = {}): PlayerWeekTouches {
  return {
    carries: 0,
    targets: 0,
    redZoneCarries: 0,
    redZoneTargets: 0,
    insideTenCarries: 0,
    insideTenTargets: 0,
    airYards: 0,
    airYardTargets: 0,
    ...over,
  };
}

function week(playerTouches: PlayerWeekTouches | null, at: { season: number; week: number } = { season: 2024, week: 1 }): PlayerWeekUsage {
  return {
    season: at.season,
    week: at.week,
    playerId: "wideout",
    snapShare: 0.8,
    targetShare: 0.2,
    carryShare: 0,
    passAttemptShare: 0,
    targets: 0,
    carries: 0,
    passAttempts: 0,
    teamTargets: 33,
    teamCarries: 26,
    teamPassAttempts: 33,
    touches: playerTouches,
    asOf: new Date("2024-09-10T00:00:00.000Z"),
  };
}

const WINDOW = { season: 2024, week: 3, decay: 1 };

describe("targetDepthTotals", () => {
  it("skips the weeks the play-by-play never saw rather than counting them as zero depth", () => {
    const totals = targetDepthTotals([week(touches({ airYards: 90, airYardTargets: 8 })), week(null)], WINDOW);
    expect(totals.airYards).toBe(90);
    expect(totals.airYardTargets).toBe(8);
  });

  it("never reads the week it is predicting", () => {
    // The throws it would be averaging are the throws it is being scored on.
    const thisWeek = week(touches({ airYards: 90, airYardTargets: 8 }), { season: 2024, week: 3 });
    expect(targetDepthTotals([thisWeek], WINDOW).airYardTargets).toBe(0);
  });
});

describe("targetDepthRatio", () => {
  it("gives a player with no targets exactly 1, because no evidence shrinks to the prior", () => {
    expect(targetDepthRatio({ airYards: 0, airYardTargets: 0 }, "WR", PRIORS)).toBeCloseTo(1, 10);
  });

  it("separates a field-stretcher from a checkdown target on the same offence", () => {
    // Both take the same target share, and layer 1 predicts them identically. This is the only thing
    // in the engine that knows one of them is thrown to at fourteen yards and the other at four.
    const deep = targetDepthRatio({ airYards: 14 * 200, airYardTargets: 200 }, "WR", PRIORS)!;
    const shallow = targetDepthRatio({ airYards: 4 * 200, airYardTargets: 200 }, "WR", PRIORS)!;
    expect(deep).toBeGreaterThan(1.2);
    expect(shallow).toBeLessThan(0.9);
  });

  it("measures a back against backs, not against receivers", () => {
    // A running back's mean depth of target is near the line of scrimmage. Against a receiver's mean
    // every back in football would read as a catastrophic underachiever, which is a difference of
    // position dressed up as a difference of player.
    const totals = { airYards: 200, airYardTargets: 100 };
    expect(targetDepthRatio(totals, "RB", PRIORS)!).toBeGreaterThan(1);
    expect(targetDepthRatio(totals, "WR", PRIORS)!).toBeLessThan(1);
  });

  it("has no opinion where the position's own mean depth is not positive", () => {
    // A position thrown to behind the line on average cannot express "twice as deep", and returning
    // 1 would claim the player was exactly typical rather than admitting nothing is known.
    expect(targetDepthRatio({ airYards: 50, airYardTargets: 10 }, "QB", PRIORS)).toBeNull();
  });
});

describe("targetDepthMultiplier", () => {
  it("moves yards and receptions in opposite directions, which is the whole claim", () => {
    // A deeper target is worth more yards and is caught less often. A feature that moved only the
    // yards would be claiming free points.
    const deep = 1.4;
    expect(targetDepthMultiplier(deep, PRIORS.yardsElasticity)).toBeGreaterThan(1);
    expect(targetDepthMultiplier(deep, PRIORS.receptionsElasticity)).toBeLessThan(1);
  });

  it("is exactly 1 at league-average depth, so the feature never rescales the league", () => {
    expect(targetDepthMultiplier(1, PRIORS.yardsElasticity)).toBeCloseTo(1, 12);
    expect(targetDepthMultiplier(1, PRIORS.receptionsElasticity)).toBeCloseTo(1, 12);
  });

  it("leaves a rate alone when there is no ratio to apply", () => {
    expect(targetDepthMultiplier(null, PRIORS.yardsElasticity)).toBe(1);
  });

  it("is bounded, because layer 2 has already moved this rate toward the player's own history", () => {
    expect(targetDepthMultiplier(100, 1)).toBe(TARGET_DEPTH_MULTIPLIER_BOUND.max);
    expect(targetDepthMultiplier(0.001, 1)).toBe(TARGET_DEPTH_MULTIPLIER_BOUND.min);
  });
});
