import { describe, expect, it } from "vitest";
import type { Position } from "@research/domain/player";
import type { PlayerWeekUsage } from "../usage";
import {
  fitExperienceMultiplier,
  fitLeagueTeamVolume,
  fitOpportunityPriors,
  fitRolePriors,
  fitShareShrinkageForPosition,
  scoreShares,
  opportunityObservations,
  opportunityObservationsForPosition,
  type ExperienceObservation,
} from "./fit";
import { FITTED_EFFICIENCY_PRIORS, FITTED_OPPORTUNITY_PRIORS, FIT_SEASONS, HELD_OUT_SEASONS } from "./fitted";
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

  /**
   * TASK 5's ACCEPTANCE DECISIONS, PINNED. Both the WR/TE share-shrinkage recalibration and the
   * years-4-6 experience multiplier were measured for real (`npm run projections:calibrate`,
   * predictor 2021 outcome 2022) and REVERTED: the share-shrinkage search landed exactly on the
   * pooled base (a null result), and the experience multiplier came back within 3% of neutral for
   * every skill position while degrading WR's own starter band, the diagnosis's own named target
   * (see `task-5-report.md`). "The shipped model is provably identical with or without Task 5's
   * mechanism" was previously only a one-off manual calibration run's finding; this test is what
   * makes it a standing guarantee. It fails loudly — forcing a fresh acceptance decision rather than
   * a silent re-activation — the moment either field is populated again: by a hand edit, or by a
   * `projections:fit` re-run whose `ACCEPTED_SHARE_SHRINKAGE_POSITIONS`/`ACCEPTED_EXPERIENCE_POSITIONS`
   * were left non-empty from a future, different measurement.
   */
  it("ships neither reverted Task 5 term — the calibration mechanisms stay inert until a fresh acceptance decision keeps one", () => {
    expect(FITTED_OPPORTUNITY_PRIORS.shareShrinkageByPosition).toBeUndefined();
    expect(FITTED_EFFICIENCY_PRIORS.experienceMultiplier).toBeUndefined();
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

describe("opportunityObservationsForPosition", () => {
  it("narrows to one position, and pools to the same total as scoring every position separately", () => {
    const rows = [
      usage({ season: 2021, week: 1, playerId: "wr1", snapShare: 0.8, targetShare: 0.2 }),
      usage({ season: 2021, week: 2, playerId: "wr1", snapShare: 0.8, targetShare: 0.2 }),
      usage({ season: 2021, week: 1, playerId: "rb1", snapShare: 0.4, targetShare: 0.05 }),
      usage({ season: 2021, week: 2, playerId: "rb1", snapShare: 0.4, targetShare: 0.05 }),
    ];
    const input = { usage: rows, positions: POSITIONS, seasons: [2021] };
    const wrOnly = opportunityObservationsForPosition(input, FITTED_OPPORTUNITY_PRIORS, "WR");
    const rbOnly = opportunityObservationsForPosition(input, FITTED_OPPORTUNITY_PRIORS, "RB");
    const pooled = opportunityObservations(input, FITTED_OPPORTUNITY_PRIORS);
    expect(wrOnly.length).toBeGreaterThan(0);
    expect(rbOnly.length).toBeGreaterThan(0);
    expect(wrOnly.length + rbOnly.length).toBe(pooled.length);
  });

  it("returns nothing for a position absent from the history", () => {
    const rows = [usage({ season: 2021, week: 1, playerId: "wr1", snapShare: 0.8, targetShare: 0.2 })];
    const input = { usage: rows, positions: POSITIONS, seasons: [2021] };
    expect(opportunityObservationsForPosition(input, FITTED_OPPORTUNITY_PRIORS, "TE")).toEqual([]);
  });
});

describe("fitShareShrinkageForPosition", () => {
  it("searches the same grids fitOpportunityPriors does, never past the input's own seasons", () => {
    // A player whose target share swings wildly week to week, on the fit's own seasons — the search
    // should be able to find SOME shrinkage worth reporting rather than erroring.
    const rows = [0.4, 0.02, 0.35, 0.03, 0.38, 0.05].map((value, index) =>
      usage({ season: 2021, week: index + 1, playerId: "wr1", snapShare: 0.8, targetShare: value }),
    );
    const shrinkage = fitShareShrinkageForPosition({ usage: rows, positions: POSITIONS, seasons: [2021] }, "WR", FITTED_OPPORTUNITY_PRIORS);
    expect(shrinkage.season).toBeGreaterThanOrEqual(0);
    expect(shrinkage.inSeason).toBeGreaterThanOrEqual(0);
    // teamVolume is never re-searched — carried through from the base priors untouched.
    expect(shrinkage.teamVolume).toBe(FITTED_OPPORTUNITY_PRIORS.shrinkage.teamVolume);
  });

  it("never beats the base shrinkage by more than the base priors' own error, restricted to the position", () => {
    const rows = [
      usage({ season: 2021, week: 1, playerId: "wr1", snapShare: 0.8, targetShare: 0.25 }),
      usage({ season: 2021, week: 2, playerId: "wr1", snapShare: 0.8, targetShare: 0.25 }),
    ];
    const input = { usage: rows, positions: POSITIONS, seasons: [2021] };
    const fitted = fitShareShrinkageForPosition(input, "WR", FITTED_OPPORTUNITY_PRIORS);
    const candidatePriors = { ...FITTED_OPPORTUNITY_PRIORS, shrinkage: { ...fitted, teamVolume: FITTED_OPPORTUNITY_PRIORS.shrinkage.teamVolume } };
    const fittedError = scoreShares(opportunityObservationsForPosition(input, candidatePriors, "WR")).rootMeanSquaredError!;
    const baseError = scoreShares(opportunityObservationsForPosition(input, FITTED_OPPORTUNITY_PRIORS, "WR")).rootMeanSquaredError!;
    expect(fittedError).toBeLessThanOrEqual(baseError + 1e-9);
  });
});

describe("fitExperienceMultiplier", () => {
  function observation(over: Partial<ExperienceObservation>): ExperienceObservation {
    return { position: "WR", cohort: "year4to6", actualPoints: 100, populationPoints: 100, ...over };
  }

  it("is a ratio of totals, not a mean of per-player ratios", () => {
    const observations = [
      observation({ actualPoints: 120, populationPoints: 100 }),
      observation({ actualPoints: 80, populationPoints: 100 }),
    ];
    // A mean of ratios would give 1.1 average; the totals ratio is 200/200 = 1.
    expect(fitExperienceMultiplier(observations).WR).toBeCloseTo(1, 10);
  });

  it("ignores observations outside the years-4-6 cohort", () => {
    const observations = [observation({ cohort: "other", actualPoints: 10, populationPoints: 1000 })];
    expect(fitExperienceMultiplier(observations).WR).toBeUndefined();
  });

  it("omits a position with zero population total rather than reporting a division artifact", () => {
    const observations = [observation({ populationPoints: 0 })];
    expect(fitExperienceMultiplier(observations).WR).toBeUndefined();
  });

  it("keeps positions independent", () => {
    const observations = [
      observation({ position: "WR", actualPoints: 80, populationPoints: 100 }),
      observation({ position: "TE", actualPoints: 120, populationPoints: 100 }),
    ];
    const result = fitExperienceMultiplier(observations);
    expect(result.WR).toBeCloseTo(0.8, 10);
    expect(result.TE).toBeCloseTo(1.2, 10);
  });
});
