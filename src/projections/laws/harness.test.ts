import { describe, expect, it } from "vitest";
import { matchedPairs, matchedPairsStratified, measureEffect, verdictFor } from "./harness";
import type { PlayerSeasonPoint } from "./types";

/** Strength of the regression-to-the-mean drift both synthetic groups share, and the mean they
 *  drift toward. The drift is the CONFOUND the harness exists to cancel: a wrong estimator that
 *  reads a group's raw before/after change measures this drift and calls it an effect. */
const K_REGRESSION = 0.2;
const REGRESSION_MEAN = 15;

function lcg(seed: number): () => number {
  // Deterministic — same seed, same sequence, so every population below is byte-stable.
  let x = seed;
  return () => {
    x = (1103515245 * x + 12345) % 2 ** 31;
    return x / 2 ** 31;
  };
}

/** Next-season value under the shared drift model: regression toward `REGRESSION_MEAN` plus noise,
 *  plus whatever effect the scenario plants on the condition group. */
function drifted(now: number, noise: number, plantedEffect: number): number {
  return now - K_REGRESSION * (now - REGRESSION_MEAN) + noise + plantedEffect;
}

/**
 * A synthetic population built to catch WRONG estimators, not just exercise the right one.
 *
 * Both groups share the same regression drift toward `REGRESSION_MEAN`, and pair baselines sit
 * mostly ABOVE that mean — so an estimator that reads the condition group's raw before/after
 * change (ignoring the control) measures the drift too, lands near `plantedEffect - 0.96` here,
 * and fails the null test below (|effect| < 0.5 with nothing planted). Condition and control rows
 * also differ by an alternating ±0.3 in baseline (mean zero, inside the 0.5 caliper), so the
 * matcher genuinely pairs unequal keys rather than trivially identical ones.
 */
function planted(n: number, plantedEffect: number, seed = 7): readonly PlayerSeasonPoint[] {
  const next = lcg(seed);
  const noise = (): number => next() - 0.5;

  const points: PlayerSeasonPoint[] = [];
  for (let i = 0; i < n; i += 1) {
    const base = 10 + (i % 20);
    const offset = i % 2 === 0 ? 0.3 : -0.3;
    const conditionNow = base + offset;
    points.push({
      playerId: `condition-${i}`,
      season: 2020,
      position: "RB",
      pointsPerGame: conditionNow,
      nextPointsPerGame: drifted(conditionNow, noise(), plantedEffect),
      matchKey: conditionNow,
      condition: true,
    });
    points.push({
      playerId: `control-${i}`,
      season: 2020,
      position: "RB",
      pointsPerGame: base,
      nextPointsPerGame: drifted(base, noise(), 0),
      matchKey: base,
      condition: false,
    });
  }
  return points;
}

/**
 * SYSTEMATIC WITHIN-CALIPER MISMATCH — the population that separates true difference-in-
 * differences from a matched next-minus-next. Every condition row sits exactly 0.4 ABOVE its one
 * admissible control (caliper 0.5; neighboring controls are 0.6 away, inadmissible), so the
 * baseline gap never averages out. On this population, with drift k = 0.2:
 *   true DiD           = planted - k * 0.4        = planted - 0.08
 *   matched next-next  = planted + 0.4 * (1 - k)  = planted + 0.32
 * The band asserted below admits the first and excludes the second — an estimator that fails to
 * subtract the baseline gap cannot pass. (The alternating generator above keeps this gap
 * mean-zero on purpose, for the null test; this one makes it systematic on purpose, for this.)
 */
function systematicMismatch(n: number, plantedEffect: number, seed = 13): readonly PlayerSeasonPoint[] {
  const next = lcg(seed);
  const noise = (): number => next() - 0.5;
  const delta = 0.4;

  const points: PlayerSeasonPoint[] = [];
  for (let i = 0; i < n; i += 1) {
    const base = 10 + (i % 20);
    const conditionNow = base + delta;
    points.push({
      playerId: `sys-condition-${i}`,
      season: 2020,
      position: "RB",
      pointsPerGame: conditionNow,
      nextPointsPerGame: drifted(conditionNow, noise(), plantedEffect),
      matchKey: conditionNow,
      condition: true,
    });
    points.push({
      playerId: `sys-control-${i}`,
      season: 2020,
      position: "RB",
      pointsPerGame: base,
      nextPointsPerGame: drifted(base, noise(), 0),
      matchKey: base,
      condition: false,
    });
  }
  return points;
}

/**
 * THE REGRESSION MIRAGE — the exact scenario the folk "cliff" laws are born from: a condition
 * group that sits at systematically HIGH baselines (career years), a strong shared drift pulling
 * everyone back toward the mean, and a pool of unremarkable low-baseline controls. A raw
 * before/after estimator reads the drift as roughly -4.8 points of "cliff" here; an unmatched
 * group comparison is poisoned by the low decoys. Only baseline-matched difference-in-differences
 * recovers what was actually planted.
 */
function regressionMirage(n: number, plantedEffect: number, seed = 11): readonly PlayerSeasonPoint[] {
  const next = lcg(seed);
  const noise = (): number => next() - 0.5;
  const k = 0.4;
  const mirageDrift = (now: number, plantedHere: number): number =>
    now - k * (now - REGRESSION_MEAN) + noise() + plantedHere;

  const points: PlayerSeasonPoint[] = [];
  for (let i = 0; i < n; i += 1) {
    const base = 24 + 6 * next();
    const partnerOffset = i % 2 === 0 ? 0.2 : -0.2;
    const decoyBase = 10 + 6 * next();
    points.push({
      playerId: `mirage-condition-${i}`,
      season: 2020,
      position: "RB",
      pointsPerGame: base,
      nextPointsPerGame: mirageDrift(base, plantedEffect),
      matchKey: base,
      condition: true,
    });
    points.push({
      playerId: `mirage-partner-${i}`,
      season: 2020,
      position: "RB",
      pointsPerGame: base + partnerOffset,
      nextPointsPerGame: mirageDrift(base + partnerOffset, 0),
      matchKey: base + partnerOffset,
      condition: false,
    });
    points.push({
      playerId: `mirage-decoy-${i}`,
      season: 2020,
      position: "RB",
      pointsPerGame: decoyBase,
      nextPointsPerGame: mirageDrift(decoyBase, 0),
      matchKey: decoyBase,
      condition: false,
    });
  }
  return points;
}

it("recovers a planted -2.0 effect within the CI", () => {
  const pairs = matchedPairs(planted(400, -2.0), 0.5);
  const m = measureEffect(pairs);
  expect(m.effect).toBeLessThan(-1.5);
  expect(m.ci[1]).toBeLessThan(0);
  expect(verdictFor(m, -1)).toBe("confirmed");
});

it("returns debunked on a pure-regression population with no planted effect", () => {
  const m = measureEffect(matchedPairs(planted(400, 0), 0.5));
  expect(verdictFor(m, -1)).not.toBe("confirmed");
  expect(Math.abs(m.effect)).toBeLessThan(0.5);
});

it("never matches outside the caliper and reports the reduced sample", () => {
  const points: readonly PlayerSeasonPoint[] = [
    {
      playerId: "condition-near",
      season: 2020,
      position: "RB",
      pointsPerGame: 10,
      nextPointsPerGame: 9,
      matchKey: 10,
      condition: true,
    },
    {
      playerId: "condition-far",
      season: 2020,
      position: "RB",
      pointsPerGame: 10,
      nextPointsPerGame: 9,
      matchKey: 10,
      condition: true,
    },
    {
      playerId: "control-only",
      season: 2020,
      position: "RB",
      pointsPerGame: 20,
      nextPointsPerGame: 19,
      matchKey: 20,
      condition: false,
    },
  ];

  const pairs = matchedPairs(points, 0.5);
  expect(pairs).toHaveLength(0);
  // And a zero-match population is never a measurement — see the throw test below.
  expect(() => measureEffect(pairs)).toThrow(/no matched pairs/);
});

it("subtracts a systematic baseline gap: DiD lands at planted - k*delta, matched next-minus-next cannot", () => {
  const pairs = matchedPairs(systematicMismatch(400, -1.0), 0.5);
  const m = measureEffect(pairs);
  // True DiD: -1.0 - 0.2 * 0.4 = -1.08. Matched next-minus-next: -1.0 + 0.4 * 0.8 = -0.68,
  // far outside this band. The 0.15 tolerance covers seeded noise only.
  expect(Math.abs(m.effect - -1.08)).toBeLessThan(0.15);
});

it("recovers a planted effect through the regression mirage, where a raw before/after reads a -4.8 cliff", () => {
  const pairs = matchedPairs(regressionMirage(300, -1.0), 0.5);
  const m = measureEffect(pairs);
  // The planted truth is -1.0. The condition group's RAW year-over-year change here is about
  // -5.8 (drift plus effect): an estimator that skips baseline cancellation cannot land in
  // this band. The tolerance covers matching mismatch and noise, nothing else.
  expect(Math.abs(m.effect - -1.0)).toBeLessThan(0.3);
});

it("reports no effect through the regression mirage when nothing was planted", () => {
  const pairs = matchedPairs(regressionMirage(300, 0), 0.5);
  const m = measureEffect(pairs);
  // The folk estimator sees a -4.8 "cliff" in this population. The harness must not.
  expect(Math.abs(m.effect)).toBeLessThan(0.3);
  expect(verdictFor(m, -1)).not.toBe("confirmed");
});

it("throws on an empty pairs list rather than minting a zero-evidence measurement", () => {
  expect(() => measureEffect([])).toThrow(/no matched pairs/);
});

it("is reproducible: two runs yield identical measurements", () => {
  const a = measureEffect(matchedPairs(planted(100, -1), 0.5));
  const b = measureEffect(matchedPairs(planted(100, -1), 0.5));
  expect(a).toEqual(b);
});

describe("matchedPairs", () => {
  it("drops points where the player did not return the following season", () => {
    const points: readonly PlayerSeasonPoint[] = [
      {
        playerId: "condition-out",
        season: 2020,
        position: "RB",
        pointsPerGame: 10,
        nextPointsPerGame: null,
        matchKey: 10,
        condition: true,
      },
      {
        playerId: "control-out",
        season: 2020,
        position: "RB",
        pointsPerGame: 10,
        nextPointsPerGame: null,
        matchKey: 10,
        condition: false,
      },
      {
        playerId: "condition-returns",
        season: 2020,
        position: "RB",
        pointsPerGame: 15,
        nextPointsPerGame: 14,
        matchKey: 15,
        condition: true,
      },
      {
        playerId: "control-returns",
        season: 2020,
        position: "RB",
        pointsPerGame: 15,
        nextPointsPerGame: 13,
        matchKey: 15,
        condition: false,
      },
    ];

    const pairs = matchedPairs(points, 0.5);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]!.condition.playerId).toBe("condition-returns");
    expect(pairs[0]!.control.playerId).toBe("control-returns");
  });
});

/** Two strata sharing an OVERLAPPING matchKey range but different baselines and different planted
 *  effects — proof `keyOf` keeps them apart, not merely a caliper that happens to separate them. */
function stratumPoints(n: number, position: "RB" | "WR", baseOffset: number, plantedEffect: number, seed: number): readonly PlayerSeasonPoint[] {
  const next = lcg(seed);
  const noise = (): number => next() - 0.5;
  const points: PlayerSeasonPoint[] = [];
  for (let i = 0; i < n; i += 1) {
    const base = baseOffset + (i % 20);
    const offset = i % 2 === 0 ? 0.3 : -0.3;
    const conditionNow = base + offset;
    points.push({
      playerId: `${position}-condition-${i}`,
      season: 2020,
      position,
      pointsPerGame: conditionNow,
      nextPointsPerGame: drifted(conditionNow, noise(), plantedEffect),
      matchKey: conditionNow,
      condition: true,
    });
    points.push({
      playerId: `${position}-control-${i}`,
      season: 2020,
      position,
      pointsPerGame: base,
      nextPointsPerGame: drifted(base, noise(), 0),
      matchKey: base,
      condition: false,
    });
  }
  return points;
}

describe("matchedPairsStratified", () => {
  it("never pairs across strata, even when matchKeys overlap and baselines differ", () => {
    // RB: base 10-29, planted -2.0. WR: base 12-31 (overlapping RB's range), no planted effect.
    // Unstratified, plenty of RB-condition/WR-control pairs would fall inside the 0.5 caliper.
    const rb = stratumPoints(200, "RB", 10, -2.0, 31);
    const wr = stratumPoints(200, "WR", 12, 0, 37);
    const pairs = matchedPairsStratified([...rb, ...wr], 0.5, (p) => p.position);

    expect(pairs.length).toBeGreaterThan(0);
    expect(pairs.every((pair) => pair.condition.position === pair.control.position)).toBe(true);

    // Each stratum's own effect is recovered independently — RB's -2.0 never bleeds into WR's null.
    const rbPairs = pairs.filter((pair) => pair.condition.position === "RB");
    const wrPairs = pairs.filter((pair) => pair.condition.position === "WR");
    expect(measureEffect(rbPairs).effect).toBeLessThan(-1.0);
    expect(Math.abs(measureEffect(wrPairs).effect)).toBeLessThan(0.5);
  });

  it("matches identically to matchedPairs within a single stratum", () => {
    const points = stratumPoints(50, "RB", 10, -1.0, 41);
    expect(matchedPairsStratified(points, 0.5, (p) => p.position)).toEqual(matchedPairs(points, 0.5));
  });
});

describe("verdictFor", () => {
  const measurement = (effect: number, ci: readonly [number, number]) => ({
    effect,
    ci,
    sample: 100,
    seasons: "2011-2024, held out 2023-2024",
  });

  it("confirms when the CI excludes zero and the sign matches", () => {
    expect(verdictFor(measurement(-2, [-3, -1]), -1)).toBe("confirmed");
    expect(verdictFor(measurement(2, [1, 3]), 1)).toBe("confirmed");
  });

  it("is weak when the sign matches but the CI spans zero", () => {
    expect(verdictFor(measurement(-2, [-3, 1]), -1)).toBe("weak");
  });

  it("is debunked when the sign does not match, regardless of the CI", () => {
    expect(verdictFor(measurement(2, [1, 3]), -1)).toBe("debunked");
    expect(verdictFor(measurement(2, [-1, 3]), -1)).toBe("debunked");
  });
});
