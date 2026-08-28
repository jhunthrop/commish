import { describe, expect, it } from "vitest";
import type { Position } from "@/domain/player";
import type { PlayerWeekUsage } from "../usage";
import { fitLeagueTeamVolume, fitOpportunityPriors, fitRolePriors, scoreShares, opportunityObservations } from "./fit";
import { FITTED_OPPORTUNITY_PRIORS, FIT_SEASONS, HELD_OUT_SEASONS } from "./fitted";
import { lastObservedPriors } from "./opportunity";

function usage(over: Partial<PlayerWeekUsage> & Pick<PlayerWeekUsage, "season" | "week" | "playerId">): PlayerWeekUsage {
  return {
    snapShare: 0.5,
    targetShare: 0.1,
    carryShare: 0,
    passAttemptShare: 0,
    targets: 4,
    carries: 0,
    passAttempts: 0,
    teamTargets: 33,
    teamCarries: 26,
    teamPassAttempts: 33,
    touches: null,
    asOf: new Date("2024-09-10T00:00:00.000Z"),
    ...over,
  };
}

const POSITIONS: ReadonlyMap<string, Position> = new Map([
  ["wr1", "WR"],
  ["wr2", "WR"],
  ["rb1", "RB"],
]);

describe("fitRolePriors", () => {
  it("reads a position's slope as a ratio of sums, not a mean of ratios", () => {
    // One player-week of two snaps and one target would claim a target share per snap of ~30 under
    // a mean of ratios and would move the whole position's prior on its own. Weighting each week by
    // the evidence it carries is what "what does a snap of this role buy" actually means.
    const priors = fitRolePriors({
      usage: [
        usage({ season: 2021, week: 1, playerId: "wr1", snapShare: 0.9, targetShare: 0.27 }),
        usage({ season: 2021, week: 1, playerId: "wr2", snapShare: 0.02, targetShare: 0.03 }),
      ],
      positions: POSITIONS,
      seasons: [2021],
    });
    expect(priors.WR.targetsPerSnap).toBeCloseTo((0.27 + 0.03) / (0.9 + 0.02), 10);
  });

  it("reads only the seasons it was told it could", () => {
    const rows = [
      usage({ season: 2021, week: 1, playerId: "wr1", snapShare: 0.8, targetShare: 0.2 }),
      usage({ season: 2024, week: 1, playerId: "wr1", snapShare: 0.1, targetShare: 0.01 }),
    ];
    expect(fitRolePriors({ usage: rows, positions: POSITIONS, seasons: [2021] }).WR.snapShare).toBeCloseTo(0.8, 10);
  });

  it("gives a position it has never seen an empty prior rather than a guess", () => {
    const priors = fitRolePriors({ usage: [], positions: POSITIONS, seasons: [2021] });
    expect(priors.TE).toEqual({ snapShare: 0, targetsPerSnap: 0, carriesPerSnap: 0, passAttemptsPerSnap: 0 });
  });
});

describe("fitLeagueTeamVolume", () => {
  it("averages over team-weeks, not player-weeks", () => {
    // Team totals ride on every player's row, so averaging player-weeks would weight a team by how
    // many receivers it dressed. Two offences, one of them carrying three players, must count once
    // each.
    const rows = [
      usage({ season: 2021, week: 1, playerId: "wr1", teamTargets: 40, teamCarries: 20, teamPassAttempts: 40 }),
      usage({ season: 2021, week: 1, playerId: "wr2", teamTargets: 40, teamCarries: 20, teamPassAttempts: 40 }),
      usage({ season: 2021, week: 1, playerId: "rb1", teamTargets: 40, teamCarries: 20, teamPassAttempts: 40 }),
      usage({ season: 2021, week: 1, playerId: "wr1", teamTargets: 20, teamCarries: 30, teamPassAttempts: 20 }),
    ];
    expect(fitLeagueTeamVolume({ usage: rows, positions: POSITIONS, seasons: [2021] }).targets).toBeCloseTo(30, 10);
  });
});

describe("fitOpportunityPriors", () => {
  it("refuses to fit on a season it will later be reported on", () => {
    expect(() =>
      fitOpportunityPriors({ usage: [], positions: POSITIONS, seasons: [2023], heldOut: [2023, 2024] }),
    ).toThrow(/not a parameter/);
  });

  it("refuses to fit on nothing at all", () => {
    expect(() => fitOpportunityPriors({ usage: [], positions: POSITIONS, seasons: [] })).toThrow(/at least one season/);
  });
});

describe("the committed fit", () => {
  it("was never fitted on a season it is reported on", () => {
    // The held-out discipline, asserted against the generated artifact rather than against the
    // script that generated it — so a regeneration that quietly widened the fit fails here.
    expect(FIT_SEASONS.some((season) => HELD_OUT_SEASONS.includes(season))).toBe(false);
    expect(HELD_OUT_SEASONS.length).toBeGreaterThanOrEqual(2);
  });

  it("carries a role prior for every position the engine projects", () => {
    for (const position of ["QB", "RB", "WR", "TE"] as const) {
      expect(FITTED_OPPORTUNITY_PRIORS.byPosition[position].snapShare).toBeGreaterThan(0);
    }
  });

  it("regresses at all — the floor it beats is the version that does not", () => {
    const floor = lastObservedPriors(FITTED_OPPORTUNITY_PRIORS);
    expect(FITTED_OPPORTUNITY_PRIORS.shrinkage.season).toBeGreaterThan(floor.shrinkage.season);
    expect(FITTED_OPPORTUNITY_PRIORS.shrinkage.inSeason).toBeGreaterThan(floor.shrinkage.inSeason);
    expect(FITTED_OPPORTUNITY_PRIORS.recencyDecay).toBeGreaterThan(floor.recencyDecay);
  });
});

describe("scoreShares", () => {
  it("beats the last-observed floor on a history that says a player is steady", () => {
    // Layer 1's own floor. If a shrunk average of a steady player's weeks cannot beat "whatever he
    // did last week", nothing above this layer can be worth reviewing.
    const noisy = [0.3, 0.05, 0.28, 0.06, 0.31, 0.04, 0.29, 0.07, 0.3, 0.05];
    const rows = noisy.map((value, index) =>
      usage({ season: 2021, week: index + 1, playerId: "wr1", snapShare: 0.8, targetShare: value }),
    );
    const input = { usage: rows, positions: POSITIONS, seasons: [2021] };
    const model = scoreShares(opportunityObservations(input, FITTED_OPPORTUNITY_PRIORS));
    const floor = scoreShares(opportunityObservations(input, lastObservedPriors(FITTED_OPPORTUNITY_PRIORS)));
    expect(model.rootMeanSquaredError!).toBeLessThan(floor.rootMeanSquaredError!);
  });
});
