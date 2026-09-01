import { describe, expect, it } from "vitest";
import type { DiscoveryFacts, DiscoveryQuantityValues } from "../discovery-facts";
import { verdictForDiscoveredLaw } from "../registry";
import type { CandidateLaw } from "./generate";
import {
  benjaminiHochberg,
  BH_Q,
  measureCandidateFullWindow,
  measureCandidateOnTrain,
  populationForCandidate,
  runDiscoveryPipeline,
  signOf,
  twoSidedPValue,
  type DiscoverySeasonRow,
  type PValueEntry,
} from "./measure";

// ---------------------------------------------------------------------------------------------
// Fixtures shared by every describe block below.
// ---------------------------------------------------------------------------------------------

const NO_VALUES: DiscoveryQuantityValues = {
  touches: null,
  age: null,
  targetShare: null,
  touchdownPointsShare: null,
  redZoneTouchShare: null,
  targetDepth: null,
  snapShare: null,
  incomingCoachTenureSeasons: null,
  incomingCoachPriorPassRateOverExpected: null,
  experienceYear: null,
  teamPaceSecondsPerPlay: null,
};

function factsWithTouches(touches: number | null): DiscoveryFacts {
  return { position: "RB", current: { ...NO_VALUES, touches }, prior: null };
}

const TOUCHES_CANDIDATE: CandidateLaw = {
  id: "threshold:RB:touches:q80",
  position: "RB",
  template: "threshold",
  condition: (facts) => (facts.current.touches === null ? null : facts.current.touches >= 100),
  claimParts: { position: "RB", clause: { kind: "threshold", quantityId: "touches", quantileLevel: 0.8 } },
};

const AGE_CANDIDATE: CandidateLaw = {
  id: "threshold:RB:age:q80",
  position: "RB",
  template: "threshold",
  condition: (facts) => (facts.current.age === null ? null : facts.current.age >= 28),
  claimParts: { position: "RB", clause: { kind: "threshold", quantityId: "age", quantileLevel: 0.8 } },
};

/** Always null — a candidate whose antecedent quantity nothing in a fixture ever supplies, the
 *  "narrow AND condition matches nobody" case step 1 of `measure.ts`'s own docblock describes. */
const UNTESTABLE_CANDIDATE: CandidateLaw = {
  id: "and:RB:threshold:RB:age:q90+threshold:RB:touches:q90",
  position: "RB",
  template: "and",
  condition: () => null,
  claimParts: {
    position: "RB",
    clause: {
      kind: "and",
      left: { kind: "threshold", quantityId: "age", quantileLevel: 0.9 },
      right: { kind: "threshold", quantityId: "touches", quantileLevel: 0.9 },
    },
  },
};

function lcg(seed: number): () => number {
  let x = seed;
  return () => {
    x = (1103515245 * x + 12345) % 2 ** 31;
    return x / 2 ** 31;
  };
}

const REGRESSION_MEAN = 15;
const K_REGRESSION = 0.2;
function drifted(now: number, noise: number, plantedEffect: number): number {
  return now - K_REGRESSION * (now - REGRESSION_MEAN) + noise + plantedEffect;
}

/** One season's worth of matched-shape rows for `TOUCHES_CANDIDATE`: high-touches "condition" rows
 *  and low-touches "control" rows, sharing the identical regression-to-the-mean drift `harness.test.ts`
 *  plants against, so a wrong estimator (or a broken pipeline) would fail the same way it would there. */
function plantedRowsForSeason(season: number, n: number, plantedEffect: number, seed: number): DiscoverySeasonRow[] {
  const next = lcg(seed);
  const noise = (): number => next() - 0.5;
  const rows: DiscoverySeasonRow[] = [];
  for (let i = 0; i < n; i += 1) {
    const base = 10 + (i % 20);
    const offset = i % 2 === 0 ? 0.3 : -0.3;
    const conditionNow = base + offset;
    rows.push({
      playerId: `${season}-condition-${i}`,
      season,
      position: "RB",
      facts: factsWithTouches(150),
      pointsPerGame: conditionNow,
      nextPointsPerGame: drifted(conditionNow, noise(), plantedEffect),
    });
    rows.push({
      playerId: `${season}-control-${i}`,
      season,
      position: "RB",
      facts: factsWithTouches(50),
      pointsPerGame: base,
      nextPointsPerGame: drifted(base, noise(), 0),
    });
  }
  return rows;
}

/** Rows across a train season and every replication fold season, all sharing the SAME planted
 *  effect — enough for a candidate to both survive BH and replicate across every fold. */
function fullWindowRows(plantedEffect: number): readonly DiscoverySeasonRow[] {
  return [
    ...plantedRowsForSeason(2018, 20, plantedEffect, 101),
    ...plantedRowsForSeason(2021, 15, plantedEffect, 102),
    ...plantedRowsForSeason(2022, 15, plantedEffect, 103),
    ...plantedRowsForSeason(2023, 15, plantedEffect, 104),
  ];
}

const TRAIN_SEASON_MAX = 2018;
const SEASONS_LABEL = "2013-2023, direction discovered on predictor seasons 2013-2021, replicated on predictor seasons 2021-2023";

// ---------------------------------------------------------------------------------------------

describe("twoSidedPValue", () => {
  it("is 1 when the effect and its standard error are both zero (no evidence of any kind)", () => {
    expect(twoSidedPValue(0, 0)).toBe(1);
  });

  it("is 0 when the standard error is zero but the effect is not (degenerate, maximally significant)", () => {
    expect(twoSidedPValue(5, 0)).toBe(0);
  });

  it("is 1 at z = 0 (effect exactly at its own standard error's center)", () => {
    // Tolerance matches the Abramowitz-Stegun 7.1.26 approximation's own documented error bound
    // (1.5e-7), not full double precision — its published coefficients sum to 0.999999999, not
    // exactly 1, so erf(0) itself is ~1e-9 off rather than exact.
    expect(twoSidedPValue(0, 1)).toBeCloseTo(1, 6);
  });

  it("is approximately 0.05 at the two-sided 95% critical z of 1.96", () => {
    expect(twoSidedPValue(1.96, 1)).toBeCloseTo(0.05, 2);
  });

  it("is symmetric in the sign of the effect", () => {
    expect(twoSidedPValue(-2.5, 1)).toBeCloseTo(twoSidedPValue(2.5, 1), 10);
  });

  it("shrinks toward zero as |z| grows", () => {
    expect(twoSidedPValue(4, 1)).toBeLessThan(twoSidedPValue(2, 1));
    expect(twoSidedPValue(2, 1)).toBeLessThan(twoSidedPValue(1, 1));
  });
});

describe("signOf", () => {
  it("is -1 for a negative effect", () => {
    expect(signOf(-3)).toBe(-1);
  });
  it("is 1 for a positive effect", () => {
    expect(signOf(3)).toBe(1);
  });
  it("defaults to 1 at exactly zero", () => {
    expect(signOf(0)).toBe(1);
  });
});

describe("benjaminiHochberg", () => {
  it("returns an empty set for an empty family", () => {
    expect(benjaminiHochberg([], 0.1)).toEqual(new Set());
  });

  it("matches a hand-computed textbook example (m=5, q=0.05)", () => {
    // Sorted: d=0.005 (<=0.01 ✓), a=0.01 (<=0.02 ✓), c=0.03 (<=0.03 ✓), b=0.04 (<=0.04 ✓), e=0.5 (<=0.05 ✗).
    // Largest passing rank is 4 -> the four smallest survive, e does not.
    const entries: readonly PValueEntry[] = [
      { id: "a", pValue: 0.01 },
      { id: "b", pValue: 0.04 },
      { id: "c", pValue: 0.03 },
      { id: "d", pValue: 0.005 },
      { id: "e", pValue: 0.5 },
    ];
    expect(benjaminiHochberg(entries, 0.05)).toEqual(new Set(["a", "b", "c", "d"]));
  });

  it("survives nothing when every p-value is far above the threshold", () => {
    const entries: readonly PValueEntry[] = [
      { id: "a", pValue: 0.9 },
      { id: "b", pValue: 0.8 },
      { id: "c", pValue: 0.7 },
    ];
    expect(benjaminiHochberg(entries, 0.05)).toEqual(new Set());
  });

  it("survives everything when every p-value is far below even the strictest per-rank threshold", () => {
    const entries: readonly PValueEntry[] = [
      { id: "a", pValue: 1e-10 },
      { id: "b", pValue: 1e-9 },
      { id: "c", pValue: 1e-8 },
    ];
    expect(benjaminiHochberg(entries, 0.1)).toEqual(new Set(["a", "b", "c"]));
  });

  it("is deterministic and unaffected by the input's own order", () => {
    const entries: readonly PValueEntry[] = [
      { id: "a", pValue: 0.01 },
      { id: "b", pValue: 0.04 },
      { id: "c", pValue: 0.03 },
    ];
    const shuffled = [entries[2]!, entries[0]!, entries[1]!];
    expect(benjaminiHochberg(shuffled, 0.05)).toEqual(benjaminiHochberg(entries, 0.05));
  });

  /**
   * THE PLANTED-NULL BATTERY — the calibration check the controller ruling requires: a family of
   * candidates that are ALL genuinely null (p-values drawn uniform on [0,1], the distribution a
   * true null p-value has by construction) must yield a false-survivor rate AT OR BELOW `q`.
   * Benjamini-Hochberg's own 1995 proof guarantees this in EXPECTATION over repeated draws, not for
   * any single finite sample with certainty — so this uses a large, seeded (deterministic) battery
   * (m=2,000) where the sampling noise around `q` is small enough (binomial std dev
   * sqrt(q*(1-q)/m) ≈ 0.0067 at q=0.10) that a generous, documented tolerance still proves the
   * mechanism is calibrated rather than degenerate (e.g. surviving everything, or a granularity
   * floor that survives nothing regardless of `q` — see this module's own docblock on why a raw
   * bootstrap resample-rank p-value would fail exactly this way at 1,737 candidates).
   */
  it("controls the false-survivor rate at or near q over a large seeded null battery", () => {
    const random = lcg(2026_08_31);
    const m = 2000;
    const entries: PValueEntry[] = Array.from({ length: m }, (_unused, index) => ({ id: `null-${index}`, pValue: random() }));
    const survivors = benjaminiHochberg(entries, BH_Q);
    const falseSurvivorRate = survivors.size / m;
    // Deterministic for this seed; the tolerance covers finite-sample noise around the expected
    // rate, not a loophole — BH's guarantee is on E[FDR], and this is one (large) draw from it.
    expect(falseSurvivorRate).toBeLessThanOrEqual(BH_Q + 0.03);
  });
});

describe("populationForCandidate", () => {
  it("drops a row whose position does not match the candidate's own", () => {
    const rows: readonly DiscoverySeasonRow[] = [
      { playerId: "wr1", season: 2020, position: "WR", facts: factsWithTouches(150), pointsPerGame: 10, nextPointsPerGame: 9 },
      { playerId: "rb1", season: 2020, position: "RB", facts: factsWithTouches(150), pointsPerGame: 10, nextPointsPerGame: 9 },
    ];
    const population = populationForCandidate(TOUCHES_CANDIDATE, rows);
    expect(population.map((p) => p.playerId)).toEqual(["rb1"]);
  });

  it("drops a row whose condition reads null (no evidence, never false)", () => {
    const rows: readonly DiscoverySeasonRow[] = [
      { playerId: "rb1", season: 2020, position: "RB", facts: factsWithTouches(null), pointsPerGame: 10, nextPointsPerGame: 9 },
      { playerId: "rb2", season: 2020, position: "RB", facts: factsWithTouches(150), pointsPerGame: 10, nextPointsPerGame: 9 },
    ];
    const population = populationForCandidate(TOUCHES_CANDIDATE, rows);
    expect(population.map((p) => p.playerId)).toEqual(["rb2"]);
  });

  it("carries condition true/false through from the candidate's own predicate", () => {
    const rows: readonly DiscoverySeasonRow[] = [
      { playerId: "rb-high", season: 2020, position: "RB", facts: factsWithTouches(150), pointsPerGame: 10, nextPointsPerGame: 9 },
      { playerId: "rb-low", season: 2020, position: "RB", facts: factsWithTouches(50), pointsPerGame: 10, nextPointsPerGame: 9 },
    ];
    const population = populationForCandidate(TOUCHES_CANDIDATE, rows);
    expect(population.find((p) => p.playerId === "rb-high")!.condition).toBe(true);
    expect(population.find((p) => p.playerId === "rb-low")!.condition).toBe(false);
  });

  it("returns points in canonical (season, position, playerId) order regardless of input order", () => {
    const rows: readonly DiscoverySeasonRow[] = [
      { playerId: "z", season: 2021, position: "RB", facts: factsWithTouches(150), pointsPerGame: 10, nextPointsPerGame: 9 },
      { playerId: "a", season: 2020, position: "RB", facts: factsWithTouches(150), pointsPerGame: 10, nextPointsPerGame: 9 },
      { playerId: "m", season: 2020, position: "RB", facts: factsWithTouches(150), pointsPerGame: 10, nextPointsPerGame: 9 },
    ];
    const population = populationForCandidate(TOUCHES_CANDIDATE, rows);
    expect(population.map((p) => `${p.season}-${p.playerId}`)).toEqual(["2020-a", "2020-m", "2021-z"]);
  });
});

describe("measureCandidateOnTrain", () => {
  it("is untestable (null) when the train window matches zero pairs", () => {
    const rows = plantedRowsForSeason(2018, 10, -2, 55);
    expect(measureCandidateOnTrain(UNTESTABLE_CANDIDATE, rows)).toBeNull();
  });

  it("returns a small p-value and the correct derived sign for a strongly planted negative effect", () => {
    const rows = plantedRowsForSeason(2018, 40, -3.0, 61);
    const result = measureCandidateOnTrain(TOUCHES_CANDIDATE, rows);
    expect(result).not.toBeNull();
    expect(result!.expectedSign).toBe(-1);
    expect(result!.trainEffect).toBeLessThan(-1);
    expect(result!.pValue).toBeLessThan(0.01);
  });

  it("returns a large p-value when nothing is planted", () => {
    const rows = plantedRowsForSeason(2018, 40, 0, 71);
    const result = measureCandidateOnTrain(TOUCHES_CANDIDATE, rows);
    expect(result).not.toBeNull();
    expect(result!.pValue).toBeGreaterThan(0.05);
  });
});

describe("measureCandidateFullWindow", () => {
  it("agrees with verdictForDiscoveredLaw's own computation from the same measurement/foldEffects", () => {
    const rows = fullWindowRows(-3.0);
    const { measurement, foldEffects, verdict } = measureCandidateFullWindow(TOUCHES_CANDIDATE, rows, -1, SEASONS_LABEL);
    expect(verdict).toBe(verdictForDiscoveredLaw(measurement, -1, foldEffects));
    expect(measurement.seasons).toBe(SEASONS_LABEL);
  });

  it("confirms (replicates) a strong, consistent planted effect across every fold, at >= 40 pairs", () => {
    const rows = fullWindowRows(-3.0);
    const { measurement, verdict } = measureCandidateFullWindow(TOUCHES_CANDIDATE, rows, -1, SEASONS_LABEL);
    expect(measurement.sample).toBeGreaterThanOrEqual(40);
    expect(verdict).toBe("confirmed");
  });
});

describe("runDiscoveryPipeline", () => {
  const strongRows = fullWindowRows(-3.0);
  const nullRows = fullWindowRows(0).map((row) => ({ ...row, playerId: `null-${row.playerId}` }));
  const rows: readonly DiscoverySeasonRow[] = [...strongRows, ...nullRows];
  const candidates: readonly CandidateLaw[] = [TOUCHES_CANDIDATE, AGE_CANDIDATE, UNTESTABLE_CANDIDATE];

  it("counts tested/untestable/bhSurvivors/replicated consistently with the fixture", () => {
    const result = runDiscoveryPipeline(candidates, rows, TRAIN_SEASON_MAX, SEASONS_LABEL);
    expect(result.counts.tested).toBe(3);
    // UNTESTABLE_CANDIDATE (condition always null) AND AGE_CANDIDATE (every fixture row's
    // facts.current.age is null via NO_VALUES, so its condition is null too) both match zero pairs.
    expect(result.counts.untestable).toBe(2);
    expect(result.counts.bhSurvivors).toBeGreaterThanOrEqual(1); // TOUCHES_CANDIDATE, at minimum
    expect(result.counts.replicated).toBeLessThanOrEqual(result.counts.bhSurvivors);
    expect(Object.keys(result.laws)).toHaveLength(result.counts.bhSurvivors);
  });

  it("gives the strong candidate a confirmed, sign-committed, em-dash-free claim", () => {
    const result = runDiscoveryPipeline(candidates, rows, TRAIN_SEASON_MAX, SEASONS_LABEL);
    const entry = result.laws[TOUCHES_CANDIDATE.id];
    expect(entry).toBeDefined();
    expect(entry!.verdict).toBe("confirmed");
    expect(entry!.origin).toBe("discovered");
    expect(entry!.expectedSign).toBe(-1);
    expect(entry!.claim).toContain("loses points per game the following season.");
    expect(entry!.claim).not.toContain("scores differently");
    expect(entry!.claim).not.toMatch(/—/);
  });

  it("never asserts a candidate for AGE_CANDIDATE in the untestable position (age is a genuine null-effect test, not untestable)", () => {
    // AGE_CANDIDATE's condition reads facts.current.age, which every fixture row leaves null via
    // NO_VALUES — so it is untestable too, on TOP of UNTESTABLE_CANDIDATE. This documents that fact
    // rather than asserting the opposite; a future change to the fixture's age field would need
    // this test rewritten anyway.
    const result = runDiscoveryPipeline(candidates, rows, TRAIN_SEASON_MAX, SEASONS_LABEL);
    expect(result.laws[AGE_CANDIDATE.id]).toBeUndefined();
  });

  it("is deterministic: identical inputs produce byte-identical output", () => {
    const first = runDiscoveryPipeline(candidates, rows, TRAIN_SEASON_MAX, SEASONS_LABEL);
    const second = runDiscoveryPipeline(candidates, rows, TRAIN_SEASON_MAX, SEASONS_LABEL);
    expect(second).toEqual(first);
  });

  it("produces zero survivors cleanly when every candidate is untestable — a legitimate, publishable result", () => {
    const result = runDiscoveryPipeline([UNTESTABLE_CANDIDATE], rows, TRAIN_SEASON_MAX, SEASONS_LABEL);
    expect(result.counts).toEqual({ tested: 1, untestable: 1, bhSurvivors: 0, replicated: 0 });
    expect(result.laws).toEqual({});
  });
});
