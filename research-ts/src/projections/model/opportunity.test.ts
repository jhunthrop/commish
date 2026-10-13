import { describe, expect, it } from "vitest";
import type { Position } from "@research-ts/domain/player";
import type { PlayerWeekUsage } from "../usage";
import { lastObservedPriors, predictOpportunity, type OpportunityPriors } from "./opportunity";

/**
 * Priors chosen to be READABLE rather than realistic — the fitted ones live in `fitted.ts` and are
 * measured on held-out-from-test seasons. A test that used the real numbers would be asserting
 * against whatever the last fit happened to produce, which is not a test of behaviour.
 */
const PRIORS: OpportunityPriors = {
  recencyDecay: 0.8,
  byPosition: {
    QB: { snapShare: 0.5, targetsPerSnap: 0, carriesPerSnap: 0.1, passAttemptsPerSnap: 1 },
    RB: { snapShare: 0.4, targetsPerSnap: 0.1, carriesPerSnap: 0.5, passAttemptsPerSnap: 0 },
    WR: { snapShare: 0.6, targetsPerSnap: 0.25, carriesPerSnap: 0.01, passAttemptsPerSnap: 0 },
    TE: { snapShare: 0.5, targetsPerSnap: 0.15, carriesPerSnap: 0, passAttemptsPerSnap: 0 },
    K: { snapShare: 0, targetsPerSnap: 0, carriesPerSnap: 0, passAttemptsPerSnap: 0 },
    DEF: { snapShare: 0, targetsPerSnap: 0, carriesPerSnap: 0, passAttemptsPerSnap: 0 },
  },
  shrinkage: { season: 4, inSeason: 3, teamVolume: 4 },
  leagueTeamVolume: { targets: 33, carries: 26, passAttempts: 33 },
};

function usage(over: Partial<PlayerWeekUsage> & Pick<PlayerWeekUsage, "season" | "week" | "playerId">): PlayerWeekUsage {
  return {
    snapShare: 0.5,
    targetShare: 0.2,
    carryShare: 0,
    passAttemptShare: 0,
    targets: 7,
    carries: 0,
    passAttempts: 0,
    teamTargets: 35,
    teamCarries: 25,
    teamPassAttempts: 35,
    touches: null,
    asOf: new Date("2024-09-10T00:00:00.000Z"),
    ...over,
  };
}

const POSITIONS: ReadonlyMap<string, Position> = new Map([
  ["star", "WR"],
  ["rookie", "WR"],
  ["back", "RB"],
]);

function predictFor(history: readonly PlayerWeekUsage[], week: number) {
  return predictOpportunity(history, { season: 2024, week, positions: POSITIONS }, PRIORS);
}

describe("predictOpportunity", () => {
  it("pulls a player with a long record closer to his own average than a one-week player", () => {
    // Twelve identical weeks and one identical week make the same AVERAGE and are completely
    // different evidence. Shrinkage is the only thing in the model that knows the difference, so
    // this is the assertion that says it is wired up at all.
    const week = (index: number) => usage({ season: 2024, week: index + 1, playerId: "star", snapShare: 0.9, targetShare: 0.3 });
    const long = predictFor(Array.from({ length: 12 }, (_, index) => week(index)), 13).get("star")!;
    const short = predictFor([week(11)], 13).get("star")!;
    expect(long.targetShare).toBeGreaterThan(short.targetShare);
    expect(Math.abs(long.targetShare - 0.3)).toBeLessThan(Math.abs(short.targetShare - 0.3) / 2);
    expect(long.snapShare).toBeGreaterThan(0.75);
  });

  it("regresses a player with one loud week hard toward his role", () => {
    // One 55% target share is the single most over-read number in fantasy. With three games of
    // shrinkage against one game of evidence, most of it has to come back.
    const predicted = predictFor([usage({ season: 2024, week: 1, playerId: "star", snapShare: 0.9, targetShare: 0.55 })], 2).get("star")!;
    expect(predicted.targetShare).toBeLessThan(0.35);
    expect(predicted.targetShare).toBeGreaterThan(0.2);
  });

  it("weights recent weeks over old ones", () => {
    const rising = [
      usage({ season: 2024, week: 1, playerId: "star", snapShare: 0.4, targetShare: 0.1 }),
      usage({ season: 2024, week: 2, playerId: "star", snapShare: 0.6, targetShare: 0.2 }),
      usage({ season: 2024, week: 3, playerId: "star", snapShare: 0.9, targetShare: 0.35 }),
    ];
    const falling = [
      usage({ season: 2024, week: 1, playerId: "star", snapShare: 0.9, targetShare: 0.35 }),
      usage({ season: 2024, week: 2, playerId: "star", snapShare: 0.6, targetShare: 0.2 }),
      usage({ season: 2024, week: 3, playerId: "star", snapShare: 0.4, targetShare: 0.1 }),
    ];
    expect(predictFor(rising, 4).get("star")!.targetShare).toBeGreaterThan(predictFor(falling, 4).get("star")!.targetShare);
  });

  it("leans on last season in week 1 and on this season by week 10", () => {
    // The naive floor decays 0.679 to 0.436 across a season precisely because it never stops
    // reading January. A model that reads the current season must move off the prior season as
    // evidence accumulates, or its in-season features are doing nothing.
    const priorSeason = Array.from({ length: 10 }, (_, index) =>
      usage({ season: 2023, week: index + 1, playerId: "star", snapShare: 0.9, targetShare: 0.35 }),
    );
    const thisSeason = Array.from({ length: 9 }, (_, index) =>
      usage({ season: 2024, week: index + 1, playerId: "star", snapShare: 0.4, targetShare: 0.05 }),
    );
    const week1 = predictFor(priorSeason, 1).get("star")!.targetShare;
    const week10 = predictFor([...priorSeason, ...thisSeason], 10).get("star")!.targetShare;
    expect(week1).toBeGreaterThan(0.28);
    expect(week10).toBeLessThan(week1 * 0.6);
  });

  it("gives a player with no usable history a role prior rather than throwing", () => {
    // Every share null: his offence ran no plays we can divide by. That is a week with no evidence,
    // not a week of no opportunity, and a model that threw here would fail on every bye week.
    const blank = [
      usage({
        season: 2024,
        week: 1,
        playerId: "rookie",
        snapShare: null,
        targetShare: null,
        carryShare: null,
        passAttemptShare: null,
        teamTargets: 0,
        teamCarries: 0,
        teamPassAttempts: 0,
      }),
    ];
    const predicted = predictFor(blank, 2).get("rookie")!;
    expect(predicted.snapShare).toBeCloseTo(0.6, 10);
    // The role prior for a share is the position's slope against the predicted SNAP share — the
    // depth chart read through the only signal we have for one.
    expect(predicted.targetShare).toBeCloseTo(0.25 * 0.6, 10);
    expect(predicted.teamTargets).toBeCloseTo(33, 10);
  });

  it("predicts every player it was given history for, and nobody else", () => {
    const history = [
      usage({ season: 2024, week: 1, playerId: "star" }),
      usage({ season: 2024, week: 1, playerId: "back", snapShare: 0.5, targetShare: 0.05, carryShare: 0.6 }),
    ];
    expect([...predictFor(history, 2).keys()].sort()).toEqual(["back", "star"]);
  });

  it("omits a player whose position the universe cannot narrow — there is no role to regress to", () => {
    const history = [usage({ season: 2024, week: 1, playerId: "lineman" })];
    expect(predictFor(history, 2).has("lineman")).toBe(false);
  });

  it("never predicts a share outside the unit interval, whatever the history says", () => {
    const history = [usage({ season: 2024, week: 1, playerId: "star", snapShare: 1, targetShare: 1 })];
    const predicted = predictFor(history, 2).get("star")!;
    for (const share of [predicted.snapShare, predicted.targetShare, predicted.carryShare, predicted.passAttemptShare]) {
      expect(share).toBeGreaterThanOrEqual(0);
      expect(share).toBeLessThanOrEqual(1);
    }
  });

  it("cannot see a week at or after the one it is predicting, even when handed it", () => {
    // The purely structural leakage guard, held at the model's own boundary as well as at the
    // store's. `replay` reads history through `as_of <= …` and would never pass this; a future
    // caller might, and a model that silently used the week it was predicting would look excellent
    // and be worthless.
    const past = [usage({ season: 2024, week: 1, playerId: "star", snapShare: 0.9, targetShare: 0.3 })];
    const withFuture = [
      ...past,
      usage({ season: 2024, week: 2, playerId: "star", snapShare: 0.1, targetShare: 0.01 }),
      usage({ season: 2024, week: 5, playerId: "star", snapShare: 0.1, targetShare: 0.01 }),
    ];
    expect(predictFor(withFuture, 2).get("star")).toEqual(predictFor(past, 2).get("star"));
  });

  it("reads team volume from the player's own rows, so a traded player carries his new offence", () => {
    const history = [
      usage({ season: 2024, week: 1, playerId: "star", teamTargets: 20, teamCarries: 40 }),
      usage({ season: 2024, week: 2, playerId: "star", teamTargets: 20, teamCarries: 40 }),
      usage({ season: 2024, week: 3, playerId: "star", teamTargets: 20, teamCarries: 40 }),
      usage({ season: 2024, week: 4, playerId: "star", teamTargets: 20, teamCarries: 40 }),
      usage({ season: 2024, week: 5, playerId: "star", teamTargets: 20, teamCarries: 40 }),
      usage({ season: 2024, week: 6, playerId: "star", teamTargets: 20, teamCarries: 40 }),
    ];
    const predicted = predictFor(history, 7).get("star")!;
    expect(predicted.teamTargets).toBeLessThan(PRIORS.leagueTeamVolume.targets);
    expect(predicted.teamCarries).toBeGreaterThan(PRIORS.leagueTeamVolume.carries);
  });
});

describe("shareShrinkageByPosition", () => {
  // Five identical weeks against a role prior of 0.25: with the base shrinkage (season 4) the
  // in-season mean of 0.5 is pulled toward the role, and with an override of season 0 (no shrinkage
  // at all) the player's own record should win outright.
  const history = Array.from({ length: 5 }, (_, index) =>
    usage({ season: 2023, week: index + 1, playerId: "star", snapShare: 0.9, targetShare: 0.5 }),
  );

  it("overrides the position's own share shrinkage, and only that position's", () => {
    const overridden: OpportunityPriors = {
      ...PRIORS,
      shareShrinkageByPosition: { WR: { season: 0, inSeason: 0 } },
    };
    const withOverride = predictOpportunity(history, { season: 2023, week: 6, positions: POSITIONS }, overridden).get("star")!;
    const withoutOverride = predictOpportunity(history, { season: 2023, week: 6, positions: POSITIONS }, PRIORS).get("star")!;
    expect(withOverride.targetShare).toBeCloseTo(0.5, 10);
    expect(withOverride.targetShare).toBeGreaterThan(withoutOverride.targetShare);

    // "back" is RB, unnamed in `shareShrinkageByPosition`: identical either way.
    const backHistory = [usage({ season: 2023, week: 1, playerId: "back", snapShare: 0.6, targetShare: 0.2 })];
    const backWith = predictOpportunity(backHistory, { season: 2023, week: 2, positions: POSITIONS }, overridden).get("back")!;
    const backWithout = predictOpportunity(backHistory, { season: 2023, week: 2, positions: POSITIONS }, PRIORS).get("back")!;
    expect(backWith).toEqual(backWithout);
  });

  it("never overrides team volume, which is not named in the override", () => {
    const overridden: OpportunityPriors = { ...PRIORS, shareShrinkageByPosition: { WR: { season: 0, inSeason: 0 } } };
    const withOverride = predictOpportunity(history, { season: 2023, week: 6, positions: POSITIONS }, overridden).get("star")!;
    const withoutOverride = predictOpportunity(history, { season: 2023, week: 6, positions: POSITIONS }, PRIORS).get("star")!;
    expect(withOverride.teamTargets).toBe(withoutOverride.teamTargets);
  });

  it("lastObservedPriors clears the override, so the floor is genuinely shrinkage-free everywhere", () => {
    const overridden: OpportunityPriors = { ...PRIORS, shareShrinkageByPosition: { WR: { season: 20, inSeason: 20 } } };
    const floor = predictOpportunity(history, { season: 2023, week: 6, positions: POSITIONS }, lastObservedPriors(overridden)).get(
      "star",
    )!;
    // With the override still in place a season-20 shrinkage would pull hard toward the role prior
    // (0.25); the floor must ignore it entirely and read the last observed week (0.5) instead.
    expect(floor.targetShare).toBeCloseTo(0.5, 10);
  });
});
