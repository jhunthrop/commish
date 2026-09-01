import { describe, expect, it } from "vitest";
import { mulberry32 } from "../harness";
import type { DiscoveryFacts, DiscoveryQuantityValues } from "../discovery-facts";
import { verdictForDiscoveredLaw } from "../registry";
import type { CandidateLaw } from "./generate";
import {
  benjaminiHochberg,
  BH_Q,
  matchedPairsFor,
  measureCandidateFullWindow,
  measureCandidateOnTrain,
  MIN_TRAIN_PAIRS,
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

const REGRESSION_MEAN = 15;
const K_REGRESSION = 0.2;
function drifted(now: number, noise: number, plantedEffect: number): number {
  return now - K_REGRESSION * (now - REGRESSION_MEAN) + noise + plantedEffect;
}

/** One season's worth of matched-shape rows for `TOUCHES_CANDIDATE`: high-touches "condition" rows
 *  and low-touches "control" rows, sharing the identical regression-to-the-mean drift `harness.test.ts`
 *  plants against, so a wrong estimator (or a broken pipeline) would fail the same way it would there.
 *  Seeded with `mulberry32` (production's own PRNG — fix round, MINOR: the earlier hand-rolled
 *  `a*x+c mod m` LCG lost precision via naive floating-point multiplication for large `x`, the exact
 *  "fixture LCG overflow" a review of this file caught). */
function plantedRowsForSeason(season: number, n: number, plantedEffect: number, seed: number): DiscoverySeasonRow[] {
  const random = mulberry32(seed);
  const noise = (): number => random() - 0.5;
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
 *  effect — comfortably clears `MIN_TRAIN_PAIRS` on the train season alone, `MIN_REPLICATION_PAIRS`
 *  on the full window, and `MIN_OUT_OF_TRAIN_FOLD_PAIRS` on each of the 2022/2023 out-of-train
 *  folds. */
function fullWindowRows(plantedEffect: number): readonly DiscoverySeasonRow[] {
  return [
    ...plantedRowsForSeason(2018, 40, plantedEffect, 101),
    ...plantedRowsForSeason(2021, 20, plantedEffect, 102),
    ...plantedRowsForSeason(2022, 20, plantedEffect, 103),
    ...plantedRowsForSeason(2023, 20, plantedEffect, 104),
  ];
}

/** A DEGENERATE population: every condition row shares the IDENTICAL (pointsPerGame,
 *  nextPointsPerGame) pair, and every control row shares the IDENTICAL pair too — bit-for-bit
 *  identical floating-point inputs, so every matched pair's own difference is the IDENTICAL double,
 *  with no floating-point rounding drift between rows (which a per-row-VARYING construction, e.g.
 *  `conditionNow + delta` for a `conditionNow` that itself varies by row, would introduce: each
 *  subtraction rounds slightly differently, giving a `se` on the order of 1e-16, not exactly 0 —
 *  caught empirically while writing this fixture). `CONTROL_PPG` sits within
 *  `POINTS_PER_GAME_CALIPER` (2) of `CONDITION_PPG` so matching succeeds. Used to exercise
 *  `measureCandidateOnTrain`'s `se === 0` guard (CRITICAL 1) exactly, not approximately. */
function degenerateRows(n: number, delta: number): DiscoverySeasonRow[] {
  const CONDITION_PPG = 20;
  const CONTROL_PPG = 19;
  const rows: DiscoverySeasonRow[] = [];
  for (let i = 0; i < n; i += 1) {
    rows.push({
      playerId: `deg-condition-${i}`,
      season: 2018,
      position: "RB",
      facts: factsWithTouches(150),
      pointsPerGame: CONDITION_PPG,
      nextPointsPerGame: CONDITION_PPG + delta,
    });
    rows.push({
      playerId: `deg-control-${i}`,
      season: 2018,
      position: "RB",
      facts: factsWithTouches(50),
      pointsPerGame: CONTROL_PPG,
      nextPointsPerGame: CONTROL_PPG,
    });
  }
  return rows;
}

const TRAIN_SEASON_MAX = 2018;
const SEASONS_LABEL = "2013-2023, direction discovered on predictor seasons 2013-2021, replicated on predictor seasons 2021-2023";

// ---------------------------------------------------------------------------------------------

describe("twoSidedPValue — two-sided Student's-t tail probability", () => {
  it("is exactly 0.5 at df=1 (Cauchy), t=1 — an exact, hand-checkable case (I_0.5(a,a) = 0.5)", () => {
    expect(twoSidedPValue(1, 1, 1)).toBeCloseTo(0.5, 8);
  });

  it("is exactly 1 at t=0, for any df (the boundary x=1 case, returned exactly by the incomplete beta)", () => {
    expect(twoSidedPValue(0, 1, 5)).toBe(1);
    expect(twoSidedPValue(0, 1, 100)).toBe(1);
  });

  it("matches the textbook two-tailed 5% critical value at df=10 (t=2.228 -> p≈0.05)", () => {
    expect(twoSidedPValue(2.228, 1, 10)).toBeCloseTo(0.05, 2);
  });

  it("matches the textbook two-tailed 5% critical value at df=5 (t=2.571 -> p≈0.05)", () => {
    expect(twoSidedPValue(2.571, 1, 5)).toBeCloseTo(0.05, 2);
  });

  it("matches the textbook two-tailed 5% critical value at df=30 (t=2.042 -> p≈0.05)", () => {
    expect(twoSidedPValue(2.042, 1, 30)).toBeCloseTo(0.05, 2);
  });

  it("converges to the standard normal's own two-tailed 5% critical value as df grows large (t=1.96 -> p≈0.05)", () => {
    expect(twoSidedPValue(1.96, 1, 5000)).toBeCloseTo(0.05, 2);
  });

  it("is symmetric in the sign of the effect", () => {
    expect(twoSidedPValue(-2.5, 1, 20)).toBeCloseTo(twoSidedPValue(2.5, 1, 20), 10);
  });

  it("shrinks toward zero as |t| grows, at fixed df", () => {
    expect(twoSidedPValue(4, 1, 20)).toBeLessThan(twoSidedPValue(2, 1, 20));
    expect(twoSidedPValue(2, 1, 20)).toBeLessThan(twoSidedPValue(1, 1, 20));
  });

  it("CRITICAL 2 — at fixed effect/se, a SMALLER df (heavier tails) gives a LARGER p-value than a larger df, never smaller", () => {
    // This is the exact anti-conservatism a normal approximation misses: the same z-like ratio is
    // LESS significant under Student's-t at low df than it would be treated under a normal reference.
    const lowDf = twoSidedPValue(2.5, 1, 5);
    const highDf = twoSidedPValue(2.5, 1, 500);
    expect(lowDf).toBeGreaterThan(highDf);
  });

  it("throws when se is not positive — a degenerate standard error must be filtered out before reaching here, never assigned a p-value", () => {
    expect(() => twoSidedPValue(3, 0, 20)).toThrow(/se must be positive/);
    expect(() => twoSidedPValue(3, -1, 20)).toThrow(/se must be positive/);
  });

  it("throws when df is below 1", () => {
    expect(() => twoSidedPValue(3, 1, 0)).toThrow(/df must be at least 1/);
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

describe("benjaminiHochberg — pure math over hand-built p-values", () => {
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

  it("controls the false-survivor rate at or near q over a large seeded uniform-p-value battery (the theorem, in isolation)", () => {
    const random = mulberry32(2026_08_31);
    const m = 2000;
    const entries: PValueEntry[] = Array.from({ length: m }, (_unused, index) => ({ id: `null-${index}`, pValue: random() }));
    const survivors = benjaminiHochberg(entries, BH_Q);
    expect(survivors.size / m).toBeLessThanOrEqual(BH_Q + 0.03);
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

  it("CRITICAL 1 — is untestable (null) below MIN_TRAIN_PAIRS matched pairs, even with a huge planted effect", () => {
    const rows = plantedRowsForSeason(2018, MIN_TRAIN_PAIRS - 1, -50, 201);
    const pairs = matchedPairsFor(TOUCHES_CANDIDATE, populationForCandidate(TOUCHES_CANDIDATE, rows));
    expect(pairs.length).toBeLessThan(MIN_TRAIN_PAIRS); // the fixture's own precondition
    expect(measureCandidateOnTrain(TOUCHES_CANDIDATE, rows)).toBeNull();
  });

  it("is testable right at the MIN_TRAIN_PAIRS boundary (inclusive), given real sampling noise", () => {
    const rows = plantedRowsForSeason(2018, MIN_TRAIN_PAIRS, -3, 202);
    const pairs = matchedPairsFor(TOUCHES_CANDIDATE, populationForCandidate(TOUCHES_CANDIDATE, rows));
    expect(pairs.length).toBeGreaterThanOrEqual(MIN_TRAIN_PAIRS); // the fixture's own precondition
    expect(measureCandidateOnTrain(TOUCHES_CANDIDATE, rows)).not.toBeNull();
  });

  it("CRITICAL 1 — is untestable (null) for a DEGENERATE zero-variance population, even well above MIN_TRAIN_PAIRS and with a large nonzero effect", () => {
    // Every condition row shares the IDENTICAL pointsPerGame/nextPointsPerGame pair (not merely the
    // identical DELTA computed from varying inputs — bit-for-bit identical floating-point inputs, so
    // the subtraction that derives each pair's own difference produces the IDENTICAL double every
    // time, with no floating-point rounding drift between rows). Every control row is likewise
    // identical to every other control row. Every possible matched pair therefore shares the SAME
    // difference, the bootstrap's 1,000 resample means are all identical, and `se` comes back EXACTLY
    // zero. The pre-fix code (`se === 0 ? (effect === 0 ? 1 : 0)`) would have scored this p=0 —
    // "maximally significant" — precisely backwards: a zero standard error means NO evidence was ever
    // generated about the estimate's own uncertainty, not overwhelming evidence.
    const rows = degenerateRows(30, 4.5);
    const pairs = matchedPairsFor(TOUCHES_CANDIDATE, populationForCandidate(TOUCHES_CANDIDATE, rows));
    expect(pairs.length).toBeGreaterThanOrEqual(MIN_TRAIN_PAIRS); // clears the floor on pair COUNT alone
    expect(measureCandidateOnTrain(TOUCHES_CANDIDATE, rows)).toBeNull(); // still untestable — se === 0
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

  it("carries a raw pairs count on every fold, present even when effect is null", () => {
    const rows = fullWindowRows(-3.0);
    const { foldEffects } = measureCandidateFullWindow(TOUCHES_CANDIDATE, rows, -1, SEASONS_LABEL);
    for (const fold of foldEffects) {
      expect(typeof fold.pairs).toBe("number");
      expect(fold.pairs === 0).toBe(fold.effect === null);
    }
  });

  it("confirms (replicates) a strong, consistent planted effect across every fold, with an out-of-train fold clearing its own floor", () => {
    const rows = fullWindowRows(-3.0);
    const { measurement, foldEffects, verdict } = measureCandidateFullWindow(TOUCHES_CANDIDATE, rows, -1, SEASONS_LABEL);
    expect(measurement.sample).toBeGreaterThanOrEqual(40);
    const outOfTrain = foldEffects.filter((fold) => fold.season > 2021);
    expect(outOfTrain.some((fold) => fold.pairs >= 5)).toBe(true);
    expect(verdict).toBe("confirmed");
  });
});

describe("runDiscoveryPipeline", () => {
  const strongRows = fullWindowRows(-3.0);
  const nullRows = fullWindowRows(0).map((row) => ({ ...row, playerId: `null-${row.playerId}` }));
  const rows: readonly DiscoverySeasonRow[] = [...strongRows, ...nullRows];
  const candidates: readonly CandidateLaw[] = [TOUCHES_CANDIDATE, AGE_CANDIDATE, UNTESTABLE_CANDIDATE];

  it("counts candidates/untestable/bhSurvivors/replicated consistently with the fixture", () => {
    const result = runDiscoveryPipeline(candidates, rows, TRAIN_SEASON_MAX, SEASONS_LABEL);
    expect(result.counts.candidates).toBe(3);
    // UNTESTABLE_CANDIDATE (condition always null) AND AGE_CANDIDATE (every fixture row's
    // facts.current.age is null via NO_VALUES, so its condition is null too) both match zero pairs.
    expect(result.counts.untestable).toBe(2);
    expect(result.counts.bhSurvivors).toBeGreaterThanOrEqual(1); // TOUCHES_CANDIDATE, at minimum
    expect(result.counts.replicated).toBeLessThanOrEqual(result.counts.bhSurvivors);
    expect(Object.keys(result.laws)).toHaveLength(result.counts.bhSurvivors);
  });

  it("gives the strong candidate a confirmed, sign-committed, em-dash-free, value-committed claim", () => {
    const result = runDiscoveryPipeline(candidates, rows, TRAIN_SEASON_MAX, SEASONS_LABEL);
    const entry = result.laws[TOUCHES_CANDIDATE.id];
    expect(entry).toBeDefined();
    expect(entry!.verdict).toBe("confirmed");
    expect(entry!.origin).toBe("discovered");
    expect(entry!.expectedSign).toBe(-1);
    // The real committed DISCOVERY_QUANTILES threshold for touches/RB/0.8 is 182 — a real value, not
    // a re-stated quantile percentage.
    expect(entry!.claim).toContain("is 182 or more");
    expect(entry!.claim).toContain("loses points per game the following season.");
    expect(entry!.claim).not.toContain("scores differently");
    expect(entry!.claim).not.toContain("top 20%");
    expect(entry!.claim).not.toMatch(/—/);
    expect(entry!.claim.startsWith("Running back carries and receptions (182): ")).toBe(true);
    // The PRESENTATION fields (Task 8 fix round) — written here from `primaryQuantityDefOf`, the
    // same rule `board-reasons.ts`'s own consistency guard re-derives at board-build time.
    expect(entry!.primaryQuantityId).toBe("touches");
    expect(entry!.primaryQuantityNoun).toBe("carries and receptions");
    expect(entry!.primaryQuantityUnit).toBe("whole");
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
    expect(result.counts).toEqual({ candidates: 1, untestable: 1, bhSurvivors: 0, replicated: 0 });
    expect(result.laws).toEqual({});
  });
});

// ---------------------------------------------------------------------------------------------
// THE PLANTED-NULL BATTERY — tests the PIPELINE, not the theorem (CRITICAL 2 / process contract).
// ---------------------------------------------------------------------------------------------

describe("the discovery pipeline, run on a genuinely null candidate family", () => {
  /** The family's real n-profile: `MIN_TRAIN_PAIRS` (20) through 200, the same range the real
   *  discovery run's own testable candidates span. */
  const N_PROFILE = [20, 25, 30, 40, 50, 75, 100, 150, 200] as const;
  const REPLICATES_PER_SIZE = 3;
  const TRIALS = 25;
  /** How many DEGENERATE (zero-variance) null candidates ride along in every trial, specifically to
   *  keep this test SENSITIVE to a CRITICAL 1 regression (see the mutation-verified test below, and
   *  this suite's own comment on why a purely-noisy null family alone would never exercise that
   *  branch: with real sampling noise, `se` is essentially never exactly zero, so a battery built
   *  ONLY from noisy data could not tell a correct `se === 0` guard from a reintroduced bug). */
  const DEGENERATE_PER_TRIAL = 6;
  const DEGENERATE_DELTA = 4.5;

  function nullCandidate(id: string): CandidateLaw {
    return {
      id,
      position: "RB",
      template: "threshold",
      condition: (facts) => (facts.current.touches === null ? null : facts.current.touches >= 100),
      claimParts: { position: "RB", clause: { kind: "threshold", quantityId: "touches", quantileLevel: 0.8 } },
    };
  }

  /** A genuinely null population: condition and control groups share the identical regression drift
   *  and NO planted effect — the same `drifted(..., 0)` model `plantedRowsForSeason` uses with
   *  `plantedEffect: 0`, seeded independently per candidate. */
  function noisyNullRows(n: number, seed: number): readonly DiscoverySeasonRow[] {
    return plantedRowsForSeason(2018, n, 0, seed);
  }

  /** Genuinely null in the sense that matters here: nothing about this construction (this module's
   *  own `degenerateRows`) is real evidence of an effect, and the one honest response is UNTESTABLE,
   *  never "maximally significant" — see `measureCandidateOnTrain`'s own docblock (CRITICAL 1). */
  function degenerateNullRows(n: number): readonly DiscoverySeasonRow[] {
    return degenerateRows(n, DEGENERATE_DELTA);
  }

  function trialMembers(trialIndex: number): readonly { readonly candidate: CandidateLaw; readonly rows: readonly DiscoverySeasonRow[] }[] {
    const members: { candidate: CandidateLaw; rows: readonly DiscoverySeasonRow[] }[] = [];
    let seed = 5_000_000 + trialIndex * 100_000;
    for (const n of N_PROFILE) {
      for (let replicate = 0; replicate < REPLICATES_PER_SIZE; replicate += 1) {
        seed += 7;
        const id = `null-real-${trialIndex}-${n}-${replicate}`;
        members.push({ candidate: nullCandidate(id), rows: noisyNullRows(n, seed) });
      }
    }
    for (let d = 0; d < DEGENERATE_PER_TRIAL; d += 1) {
      members.push({ candidate: nullCandidate(`null-degenerate-${trialIndex}-${d}`), rows: degenerateNullRows(25) });
    }
    return members;
  }

  /**
   * THE PIPELINE-LEVEL CALIBRATION CHECK. Every member is run through the REAL production chain —
   * `measureCandidateOnTrain` (which itself calls `populationForCandidate` -> `matchedPairsFor` ->
   * `bootstrapStatistics` -> `twoSidedPValue`) — never a synthetic p-value handed straight to
   * `benjaminiHochberg`. Aggregated over `TRIALS` seeded draws (825 candidate-measurements total:
   * 675 noisy + 150 degenerate) so the false-survivor rate's own sampling noise around `q` is small.
   *
   * MUTATION-VERIFIED (documented here per the process contract — see `task-7-report.md`'s fix-round
   * section for the actual before/after run): temporarily reverting `measureCandidateOnTrain`'s
   * `se === 0` guard to the pre-fix `twoSidedPValue`-style `effect === 0 ? 1 : 0` branch makes EVERY
   * one of the 150 degenerate candidates (`effect = DEGENERATE_DELTA ≠ 0`, so `p = 0`) an automatic,
   * guaranteed BH survivor — a false-survivor rate spike this assertion catches immediately. A purely
   * noisy battery (real `se > 0` everywhere) would never exercise that branch at all, which is
   * exactly why `DEGENERATE_PER_TRIAL` exists.
   */
  it("keeps the empirical false-survivor rate at or near q, including the degenerate candidates C1 exists to exclude", () => {
    let totalTestable = 0;
    let totalSurvivors = 0;
    for (let trial = 0; trial < TRIALS; trial += 1) {
      const members = trialMembers(trial);
      const testable: PValueEntry[] = [];
      for (const { candidate, rows } of members) {
        const result = measureCandidateOnTrain(candidate, rows);
        if (result === null) continue; // untestable — never counted as tested or as a survivor
        testable.push({ id: candidate.id, pValue: result.pValue });
      }
      const survivorIds = benjaminiHochberg(testable, BH_Q);
      totalTestable += testable.length;
      totalSurvivors += survivorIds.size;
    }
    expect(totalTestable).toBeGreaterThan(0);
    const falseSurvivorRate = totalSurvivors / totalTestable;
    expect(falseSurvivorRate).toBeLessThanOrEqual(BH_Q + 0.03);
  });

  it("the direct C1 regression check: a degenerate zero-variance population is ALWAYS untestable, never scored, regardless of sample size", () => {
    for (const n of [MIN_TRAIN_PAIRS, 50, 200]) {
      const rows = degenerateNullRows(n);
      const candidate = nullCandidate(`direct-check-${n}`);
      const pairs = matchedPairsFor(candidate, populationForCandidate(candidate, rows));
      expect(pairs.length).toBeGreaterThanOrEqual(MIN_TRAIN_PAIRS); // the fixture's own precondition
      expect(measureCandidateOnTrain(candidate, rows)).toBeNull();
    }
  });
});
