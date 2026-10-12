import { describe, expect, it } from "vitest";
import type { Db, ReadonlyDb } from "@research/db/client";
import { HISTORICAL_ROSTER_FLOOR } from "@research/projections/nflverse/rosters";
import { ROOKIE_CURVE_TRAIN_CUTOFF_SEASON, type RookieCurveObservation } from "@research/projections/preseason/rookie-curve";
import { rookieCurveTrainSeasons, runRookieCurveFit, type RookieCurveFitDeps } from "./rookie-curve-fit";

/**
 * THE `--check` SIDE-EFFECT BUG (fit-round, ledgered by Task 1's adjudication 5 and fixed here).
 * `npm run projections:rookie-curve:fit -- --check` ingested nflverse's whole draft-pick release
 * BEFORE deciding it was only checking, so a read-only drift check wrote 259 draft picks into the
 * store — enough to move the discovery decomposition's own reconstruction, which is where Task 2
 * found the residual. A check is a question, not a write.
 */

/** No database is touched by these tests: `runRookieCurveFit` takes every read it makes as a dep. */
const NO_DB = {} as Db;

function deps(observations: readonly RookieCurveObservation[] = []): {
  readonly deps: RookieCurveFitDeps;
  readonly ingestCalls: string[];
  readonly loadCalls: (readonly number[])[];
} {
  const ingestCalls: string[] = [];
  const loadCalls: (readonly number[])[] = [];
  return {
    ingestCalls,
    loadCalls,
    deps: {
      ingest: async () => {
        ingestCalls.push("called");
        return { entriesRead: 1, written: 1, unknownToUniverse: 0 };
      },
      loadObservations: async (_unused: ReadonlyDb, seasons: readonly number[]) => {
        loadCalls.push(seasons);
        return observations;
      },
    },
  };
}

function observation(overrides: Partial<RookieCurveObservation> = {}): RookieCurveObservation {
  return { season: 2015, position: "RB", overallPick: 10, points: 120, gamesPlayed: 10, teamGames: 17, ...overrides };
}

describe("runRookieCurveFit — CHECK MODE IS READ-ONLY", () => {
  it("NEVER ingests draft picks in check mode", async () => {
    const { deps: fake, ingestCalls } = deps([observation()]);
    const result = await runRookieCurveFit(NO_DB, { check: true }, fake);
    expect(ingestCalls).toEqual([]);
    expect(result.ingestReport).toBeNull();
  });

  it("DOES ingest in write mode — the fix removes the write from a check, not from the fit", async () => {
    const { deps: fake, ingestCalls } = deps([observation()]);
    const result = await runRookieCurveFit(NO_DB, { check: false }, fake);
    expect(ingestCalls).toEqual(["called"]);
    expect(result.ingestReport).not.toBeNull();
  });

  it("still fits and renders in check mode — read-only, not inert", async () => {
    const { deps: fake } = deps([observation(), observation({ overallPick: 200, points: 5 })]);
    const result = await runRookieCurveFit(NO_DB, { check: true }, fake);
    expect(result.rendered).toContain("FITTED_ROOKIE_CURVE");
    expect(result.observationCount).toBe(2);
    expect(result.priors.RB.length).toBe(2);
  });
});

describe("rookieCurveTrainSeasons — the full-cohort window", () => {
  it("runs from the roster floor to the train cutoff, inclusive", () => {
    const seasons = rookieCurveTrainSeasons();
    expect(seasons[0]).toBe(HISTORICAL_ROSTER_FLOOR);
    expect(seasons[seasons.length - 1]).toBe(ROOKIE_CURVE_TRAIN_CUTOFF_SEASON);
    expect(seasons.length).toBe(ROOKIE_CURVE_TRAIN_CUTOFF_SEASON - HISTORICAL_ROSTER_FLOOR + 1);
  });

  it("reaches the old decade Task 1 unlocked — nineteen rookie classes, not nine", () => {
    expect(HISTORICAL_ROSTER_FLOOR).toBeLessThanOrEqual(2003);
    expect(rookieCurveTrainSeasons()).toContain(2003);
    expect(rookieCurveTrainSeasons().length).toBeGreaterThanOrEqual(19);
  });

  it("is the ONLY season list the fit loads observations for", async () => {
    const { deps: fake, loadCalls } = deps([observation()]);
    await runRookieCurveFit(NO_DB, { check: true }, fake);
    expect(loadCalls).toHaveLength(1);
    expect(loadCalls[0]).toEqual(rookieCurveTrainSeasons());
  });

  it("never loads a season past the cutoff — the held-out classes are unreachable from the fit", async () => {
    const { deps: fake, loadCalls } = deps([observation()]);
    await runRookieCurveFit(NO_DB, { check: false }, fake);
    for (const season of loadCalls.flat()) expect(season).toBeLessThanOrEqual(ROOKIE_CURVE_TRAIN_CUTOFF_SEASON);
  });
});
