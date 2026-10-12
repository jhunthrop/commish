import { describe, expect, it } from "vitest";
import type { PlayerWeekUsage, PlayerWeekTouches } from "../usage";
import {
  redZoneLeverage,
  redZoneMultiplier,
  redZoneTotals,
  RED_ZONE_MULTIPLIER_BOUND,
  type RedZonePriors,
} from "./red-zone";

/** Readable rather than realistic — the fitted numbers live in `fitted.ts` and move with a refit. */
const PRIORS: RedZonePriors = {
  league: {
    QB: { insideTenCarriesPerCarry: 0.16, redZoneTargetsPerTarget: 0.4 },
    RB: { insideTenCarriesPerCarry: 0.08, redZoneTargetsPerTarget: 0.13 },
    WR: { insideTenCarriesPerCarry: 0.05, redZoneTargetsPerTarget: 0.12 },
    TE: { insideTenCarriesPerCarry: 0.17, redZoneTargetsPerTarget: 0.16 },
    K: { insideTenCarriesPerCarry: 0, redZoneTargetsPerTarget: 0 },
    DEF: { insideTenCarriesPerCarry: 0, redZoneTargetsPerTarget: 0 },
  },
  recencyDecay: 1,
  carryShrinkage: 20,
  targetShrinkage: 5,
  rushingElasticity: 0.25,
  receivingElasticity: 0.2,
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

function week(playerTouches: PlayerWeekTouches | null): PlayerWeekUsage {
  return {
    season: 2024,
    week: 1,
    playerId: "back",
    snapShare: 0.5,
    targetShare: 0,
    carryShare: 0.4,
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

/**
 * Rows are stamped in week 1 by `week`, so a window anchored two weeks later sees all of them and
 * weights them equally at the default decay of 1. Tests about the WINDOW itself set their own.
 */
function totalsOf(rows: readonly PlayerWeekUsage[], decay = 1) {
  return redZoneTotals(rows, { season: 2024, week: 3, decay });
}

describe("redZoneTotals", () => {
  it("sums the weeks the play-by-play saw and skips the weeks it did not", () => {
    // A week with no play-by-play row is not a week of zero red-zone carries. Counting it as one
    // would read an un-ingested season as a league of players who never reach the goal line.
    const totals = totalsOf([
      week(touches({ carries: 10, insideTenCarries: 3 })),
      week(null),
      week(touches({ carries: 8, insideTenCarries: 1 })),
    ]);
    expect(totals.carries).toBe(18);
    expect(totals.insideTenCarries).toBe(4);
  });

  it("never reads the week it is predicting, whatever the caller hands it", () => {
    // A goal-line carry and the touchdown it produced are in large part the same play, so a leverage
    // that had seen its own week would look excellent and be worthless. The filter is here rather
    // than trusted to the caller, exactly as `predictOpportunity` filters its own history.
    const thisWeek = { ...week(touches({ carries: 10, insideTenCarries: 5 })), week: 3 };
    expect(redZoneTotals([thisWeek], { season: 2024, week: 3, decay: 1 }).carries).toBe(0);
  });

  it("fades the past, so last week outweighs a week in the season before", () => {
    const lastWeek = { ...week(touches({ carries: 10, insideTenCarries: 5 })), season: 2024, week: 2 };
    const lastJanuary = { ...week(touches({ carries: 10, insideTenCarries: 5 })), season: 2023, week: 18 };
    const totals = redZoneTotals([lastWeek, lastJanuary], { season: 2024, week: 3, decay: 0.9 });
    expect(totals.carries).toBeGreaterThan(10);
    expect(totals.carries).toBeLessThan(20);
  });

  it("ignores a season further back than the two the backtest hands a source", () => {
    // Matching `backtest.ts`' own two-season window is what makes a fitted elasticity apply to the
    // quantity the model will actually compute.
    const ancient = { ...week(touches({ carries: 10, insideTenCarries: 5 })), season: 2022, week: 1 };
    expect(redZoneTotals([ancient], { season: 2024, week: 3, decay: 1 }).carries).toBe(0);
  });
});

describe("redZoneLeverage", () => {
  it("gives a player with no touches at all exactly 1, because no evidence shrinks to the prior", () => {
    const leverage = redZoneLeverage(totalsOf([]), "RB", PRIORS);
    expect(leverage.rushing).toBeCloseTo(1, 10);
    expect(leverage.receiving).toBeCloseTo(1, 10);
  });

  it("separates two backs with identical carries and different goal-line roles", () => {
    // The claim the whole feature rests on. Layer 1 predicts these two identically and layer 2 hands
    // them the same touchdown rate, because it has been fitted to regress that rate entirely to the
    // position mean. Only this tells them apart.
    const goalLine = redZoneLeverage(totalsOf([week(touches({ carries: 120, insideTenCarries: 24 }))]), "RB", PRIORS);
    const thirdDown = redZoneLeverage(totalsOf([week(touches({ carries: 120, insideTenCarries: 2 }))]), "RB", PRIORS);
    expect(goalLine.rushing!).toBeGreaterThan(1.5);
    expect(thirdDown.rushing!).toBeLessThan(0.7);
  });

  it("shrinks a small sample hard, so four carries cannot claim a goal-line role", () => {
    // One carry from the two-yard line in a four-carry week is a 25% inside-ten rate, three times
    // the league's. Unshrunk it would triple a touchdown rate on the strength of one play.
    const unshrunk = 0.25 / PRIORS.league.RB.insideTenCarriesPerCarry;
    const thin = redZoneLeverage(totalsOf([week(touches({ carries: 4, insideTenCarries: 1 }))]), "RB", PRIORS);
    const thick = redZoneLeverage(totalsOf([week(touches({ carries: 200, insideTenCarries: 50 }))]), "RB", PRIORS);
    expect(unshrunk).toBeCloseTo(3.125, 10);
    expect(thin.rushing!).toBeLessThan(1.5);
    // The same 25% rate over two hundred carries is a role rather than a coincidence, and is
    // allowed most of the way to its unshrunk value.
    expect(thick.rushing!).toBeGreaterThan(2.5);
  });

  it("measures each position against its own league rate, not a single one", () => {
    // A tight end takes a sixth of his carries inside the ten because the only carries a tight end
    // ever gets are the goal-line ones. Against a running back's rate he would look like a
    // superhuman scorer; against his own position's he is ordinary.
    const totals = totalsOf([week(touches({ carries: 6, insideTenCarries: 1 }))]);
    expect(redZoneLeverage(totals, "TE", PRIORS).rushing!).toBeLessThan(redZoneLeverage(totals, "RB", PRIORS).rushing!);
  });
});

describe("redZoneMultiplier", () => {
  it("leaves a rate alone when there is no leverage to apply", () => {
    expect(redZoneMultiplier(null, 0.25)).toBe(1);
    expect(redZoneMultiplier(0, 0.25)).toBe(1);
  });

  it("is bounded far wider than a team-level multiplier, because a role difference really is a multiple", () => {
    // 0.8 to 1.25 is right for an offensive line and wrong here: a goal-line back and a third-down
    // back differ in touchdowns per carry by a multiple, and capping this at a quarter would delete
    // the finding rather than bound it.
    expect(redZoneMultiplier(100, 1)).toBe(RED_ZONE_MULTIPLIER_BOUND.max);
    expect(redZoneMultiplier(0.001, 1)).toBe(RED_ZONE_MULTIPLIER_BOUND.min);
  });

  it("is exactly 1 at league-average leverage, whatever the elasticity", () => {
    // The multiplier must not move the league. An average player getting anything other than 1 would
    // mean the feature had quietly rescaled every touchdown in the model.
    expect(redZoneMultiplier(1, 0.25)).toBeCloseTo(1, 12);
    expect(redZoneMultiplier(1, -3)).toBeCloseTo(1, 12);
  });
});
