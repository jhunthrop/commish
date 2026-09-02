import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb, truncateAll } from "@/db/test-db";
import { nflPlayers } from "@/db/schema";
import { recordDraftPicks, draftKnownByAsOf, type DraftPickRow } from "../nflverse/draft-picks";
import { STAT_LINE_SOURCE } from "../lines";
import { DERIVED_STAT_LINE_SOURCE } from "../nflverse/derived-stat-lines";
import { recordObservations, type PlayerWeekObservation } from "../store";
import { FITTED_ROOKIE_CURVE } from "./rookie-curve-fitted";
import {
  fitRookieCurve,
  loadRookieCurveObservations,
  rookieCurve,
  ROOKIE_CURVE_TRAIN_CUTOFF_SEASON,
  type RookieCurveObservation,
  type RookieCurvePriors,
} from "./rookie-curve";

function observation(overrides: Partial<RookieCurveObservation> = {}): RookieCurveObservation {
  return { season: 2020, position: "RB", overallPick: 10, points: 100, ...overrides };
}

describe("fitRookieCurve", () => {
  it("REFUSES a held-out season — a curve fitted on a season it is later scored against is not a measurement", () => {
    expect(() => fitRookieCurve([observation({ season: 2022 })], { heldOutSeasons: [2022] })).toThrow(/held out/);
  });

  it("REFUSES a season past ROOKIE_CURVE_TRAIN_CUTOFF_SEASON even with an EMPTY held-out list — the constant is the contract, not caller discipline", () => {
    // Fix round: the earlier version of this gate lived entirely behind `heldOutSeasons`, and
    // `rookie-curve-fit.ts` calls this with `heldOutSeasons: []` for real — so the guard the module
    // docblock and the generated file's header both advertised never actually armed. This pins that
    // it now fires unconditionally, straight off the cutoff constant.
    const observations = [observation({ season: ROOKIE_CURVE_TRAIN_CUTOFF_SEASON + 1 })];
    expect(() => fitRookieCurve(observations, { heldOutSeasons: [] })).toThrow(
      new RegExp(`past ROOKIE_CURVE_TRAIN_CUTOFF_SEASON \\(${ROOKIE_CURVE_TRAIN_CUTOFF_SEASON}\\)`),
    );
  });

  it("accepts the cutoff season itself, exactly at the boundary", () => {
    expect(() => fitRookieCurve([observation({ season: ROOKIE_CURVE_TRAIN_CUTOFF_SEASON })], { heldOutSeasons: [] })).not.toThrow();
  });

  it("takes the mean at a pick with more than one observation across draft classes", () => {
    const priors = fitRookieCurve(
      [observation({ overallPick: 5, points: 100 }), observation({ overallPick: 5, points: 200, season: 2021 })],
      { heldOutSeasons: [] },
    );
    expect(priors.RB).toEqual([{ pick: 5, points: 150 }]);
  });

  it("LEAVES AN ALREADY-MONOTONE SEQUENCE EXACTLY WHERE THE MEANS PUT IT — no smoothing where none is needed", () => {
    const priors = fitRookieCurve(
      [
        observation({ overallPick: 1, points: 300 }),
        observation({ overallPick: 50, points: 150 }),
        observation({ overallPick: 100, points: 50 }),
      ],
      { heldOutSeasons: [] },
    );
    expect(priors.RB).toEqual([
      { pick: 1, points: 300 },
      { pick: 50, points: 150 },
      { pick: 100, points: 50 },
    ]);
  });

  it("POOLS A VIOLATION — a later pick whose raw mean is noisily HIGHER than an earlier one is never left that way", () => {
    // Pick 20 (120) sits above pick 10 (100), which draft capital cannot mean. PAVA pools the two
    // (and, since 30's 40 is still below the pool, leaves it be) into their weighted mean, 110.
    const priors = fitRookieCurve(
      [observation({ overallPick: 10, points: 100 }), observation({ overallPick: 20, points: 120 }), observation({ overallPick: 30, points: 40 })],
      { heldOutSeasons: [] },
    );
    expect(priors.RB).toEqual([
      { pick: 10, points: 110 },
      { pick: 20, points: 110 },
      { pick: 30, points: 40 },
    ]);
  });

  it("weights the pool by how many observations backed each pick, not by pick count alone", () => {
    // Pick 10 carries three observations at 100 apiece; pick 20 carries one noisy 400. A violation
    // pools them to a WEIGHTED mean (3*100 + 1*400) / 4 = 175, not the unweighted (100+400)/2 = 250.
    const priors = fitRookieCurve(
      [
        observation({ overallPick: 10, points: 100, season: 2018 }),
        observation({ overallPick: 10, points: 100, season: 2019 }),
        observation({ overallPick: 10, points: 100, season: 2020 }),
        observation({ overallPick: 20, points: 400, season: 2021 }),
      ],
      { heldOutSeasons: [] },
    );
    expect(priors.RB).toEqual([
      { pick: 10, points: 175 },
      { pick: 20, points: 175 },
    ]);
  });

  it("keeps QB, WR and TE independent of RB and of each other", () => {
    const priors = fitRookieCurve(
      [observation({ position: "RB", overallPick: 5, points: 300 }), observation({ position: "WR", overallPick: 5, points: 50 })],
      { heldOutSeasons: [] },
    );
    expect(priors.RB).toEqual([{ pick: 5, points: 300 }]);
    expect(priors.WR).toEqual([{ pick: 5, points: 50 }]);
    expect(priors.QB).toEqual([]);
    expect(priors.TE).toEqual([]);
  });
});

describe("rookieCurve", () => {
  const PRIORS: RookieCurvePriors = {
    QB: [
      { pick: 1, points: 280 },
      { pick: 10, points: 200 },
      { pick: 100, points: 40 },
    ],
    RB: [],
    WR: [],
    TE: [],
  };

  it("returns the exact fitted value AT a knot, never an interpolated approximation of it", () => {
    expect(rookieCurve("QB", 10, PRIORS)).toBe(200);
    expect(rookieCurve("QB", 1, PRIORS)).toBe(280);
    expect(rookieCurve("QB", 100, PRIORS)).toBe(40);
  });

  it("interpolates linearly between the two nearest knots", () => {
    // Halfway from pick 1 (280) to pick 10 (200) in pick-space is pick 5.5, expecting 240.
    expect(rookieCurve("QB", 5.5, PRIORS)).toBeCloseTo(240, 10);
  });

  it("clamps below the earliest knot and above the latest, rather than extrapolating a curve nobody fitted", () => {
    expect(rookieCurve("QB", -5, PRIORS)).toBe(280);
    expect(rookieCurve("QB", 250, PRIORS)).toBe(40);
  });

  it("returns 0 for a position the curve carries no knots for, K and DEF included", () => {
    expect(rookieCurve("RB", 5, PRIORS)).toBe(0);
    expect(rookieCurve("K", 5, PRIORS)).toBe(0);
    expect(rookieCurve("DEF", 5, PRIORS)).toBe(0);
  });

  it("defaults to the committed fit when no priors are supplied", () => {
    expect(rookieCurve("RB", 1)).toBe(rookieCurve("RB", 1, FITTED_ROOKIE_CURVE));
  });

  it("is monotone non-increasing across the whole pick axis, for a synthetic curve with real gaps between knots", () => {
    for (let pick = 1; pick < 260; pick += 1) {
      expect(rookieCurve("QB", pick + 1, PRIORS)).toBeLessThanOrEqual(rookieCurve("QB", pick, PRIORS) + 1e-9);
    }
  });

  it("CLAMPS A SUB-ZERO FITTED VALUE AT ZERO — a points baseline for a blend is non-negative by construction", () => {
    const negativeTail: RookieCurvePriors = {
      QB: [
        { pick: 1, points: 200 },
        { pick: 250, points: -0.05 },
      ],
      RB: [],
      WR: [],
      TE: [],
    };
    expect(rookieCurve("QB", 250, negativeTail)).toBe(0);
    // And not just at the exact knot: any pick in the clamped region reads as zero too, never a
    // negative interpolated-toward value.
    expect(rookieCurve("QB", 260, negativeTail)).toBe(0);
  });

  it("PIN: the committed fit currently carries NO negative knot at any position, so the clamp above is inert on today's constants", () => {
    // THIS PIN INVERTED IN THE FIT-ROUND (Task 4), and the inversion is the point rather than a
    // fixture repair. It used to name the real QB knots at picks 250 and 253, both fitted to -0.05:
    // the seventh-round/UDFA tail where a rookie season was a mop-up interception and nothing else.
    // Re-fitting on nineteen rookie classes (2003-2021) instead of nine put enough men in every tail
    // cell that no cell's mean is negative any more, at any position.
    //
    // So the clamp's live example is gone. The clamp itself is NOT gone and is not now untested: the
    // test directly above exercises it against a synthetic negative-tail curve, which is where a
    // behavioural guarantee belongs. What this test pins is the STATE OF THE COMMITTED FILE, and it
    // is worth pinning in this direction because a future fit that produces a negative again is a
    // fact somebody should be told about rather than one the accessor silently absorbs.
    for (const position of ["QB", "RB", "WR", "TE"] as const) {
      const negative = FITTED_ROOKIE_CURVE[position].filter((knot) => knot.points < 0);
      expect(negative).toEqual([]);
    }
    // And the accessor still floors, whatever the file says: the deepest knot at every position
    // reads as a non-negative number.
    for (const position of ["QB", "RB", "WR", "TE"] as const) {
      const deepest = FITTED_ROOKIE_CURVE[position][FITTED_ROOKIE_CURVE[position].length - 1]!;
      expect(rookieCurve(position, deepest.pick)).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("the committed fit", () => {
  it("PIN: is monotone non-increasing across picks 1..260, at every skill position", () => {
    // The premise the whole curve exists to serve: more draft capital can never imply a lower
    // expected rookie season. Checked over the real committed fit, not a synthetic stand-in.
    for (const position of ["QB", "RB", "WR", "TE"] as const) {
      for (let pick = 1; pick < 260; pick += 1) {
        const above = rookieCurve(position, pick);
        const below = rookieCurve(position, pick + 1);
        expect(below).toBeLessThanOrEqual(above + 1e-9);
      }
    }
  });

  it("has real, non-degenerate knots for every skill position", () => {
    for (const position of ["QB", "RB", "WR", "TE"] as const) {
      expect(FITTED_ROOKIE_CURVE[position].length).toBeGreaterThan(0);
    }
  });

  it("never fits past ROOKIE_CURVE_TRAIN_CUTOFF_SEASON", () => {
    expect(ROOKIE_CURVE_TRAIN_CUTOFF_SEASON).toBe(2021);
  });
});

describe("loadRookieCurveObservations", () => {
  const db = createTestDb();

  const PLAYER_A = "00-0036442"; // drafted RB, pick 3
  const PLAYER_B = "00-0036355"; // drafted RB, pick 40, never dresses
  const PLAYER_C = "00-0036358"; // drafted RB in the 2019 GAP season

  beforeEach(async () => {
    await truncateAll(db);
    await db.insert(nflPlayers).values([
      { id: PLAYER_A, pfrId: "AA", name: "A", position: "RB", latestTeam: "KC", rookieSeason: 2020, lastSeason: 2024 },
      { id: PLAYER_B, pfrId: "BB", name: "B", position: "RB", latestTeam: "KC", rookieSeason: 2020, lastSeason: 2020 },
      { id: PLAYER_C, pfrId: "CC", name: "C", position: "RB", latestTeam: "KC", rookieSeason: 2019, lastSeason: 2024 },
    ]);
  });

  function pick(overrides: Partial<DraftPickRow> = {}): DraftPickRow {
    return { season: 2020, round: 1, pick: 3, playerId: PLAYER_A, position: "RB", team: "KC", asOf: draftKnownByAsOf(2020), ...overrides };
  }

  it("sums a season's worth of weekly stat lines into one rookie-season points total", async () => {
    await recordDraftPicks(db, [pick()]);
    await recordObservations(db, [
      statLine({ season: 2020, week: 1, playerId: PLAYER_A, value: 100 }),
      statLine({ season: 2020, week: 2, playerId: PLAYER_A, value: 50 }),
    ]);
    const observations = await loadRookieCurveObservations(db, [2020]);
    // 150 rushing yards at PPR_SCORING.pointsPerRushingYard (0.1) each => 15 points.
    expect(observations).toEqual([{ season: 2020, position: "RB", overallPick: 3, points: 15 }]);
  });

  it("counts a rookie who never recorded a single stat line at ZERO, never dropping him", async () => {
    await recordDraftPicks(db, [pick({ pick: 40, playerId: PLAYER_B })]);
    const observations = await loadRookieCurveObservations(db, [2020]);
    expect(observations).toEqual([{ season: 2020, position: "RB", overallPick: 40, points: 0 }]);
  });

  it("reads a rookie season via the pbp-derived fallback when it falls in a published stats gap", async () => {
    await recordDraftPicks(db, [pick({ season: 2019, playerId: PLAYER_C })]);
    await recordObservations(db, [statLine({ season: 2019, week: 1, playerId: PLAYER_C, value: 200, source: DERIVED_STAT_LINE_SOURCE })]);
    const observations = await loadRookieCurveObservations(db, [2019]);
    expect(observations).toEqual([{ season: 2019, position: "RB", overallPick: 3, points: 20 }]);
  });

  it("answers empty for a season with no draft picks ingested, never a guess", async () => {
    expect(await loadRookieCurveObservations(db, [2017])).toEqual([]);
  });

  function statLine(overrides: Partial<PlayerWeekObservation> = {}): PlayerWeekObservation {
    return {
      season: 2020,
      week: 1,
      playerId: PLAYER_A,
      source: STAT_LINE_SOURCE,
      metric: "rushing_yards",
      value: 0,
      asOf: new Date("2020-09-15T00:00:00.000Z"),
      ...overrides,
    };
  }
});
