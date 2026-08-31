import { describe, expect, it } from "vitest";
import { matchedPairs, measureEffect, verdictFor } from "./harness";
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
      pointsPerGame: conditionNow,
      nextPointsPerGame: drifted(conditionNow, noise(), plantedEffect),
      matchKey: conditionNow,
      condition: true,
    });
    points.push({
      playerId: `control-${i}`,
      season: 2020,
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
      pointsPerGame: base,
      nextPointsPerGame: mirageDrift(base, plantedEffect),
      matchKey: base,
      condition: true,
    });
    points.push({
      playerId: `mirage-partner-${i}`,
      season: 2020,
      pointsPerGame: base + partnerOffset,
      nextPointsPerGame: mirageDrift(base + partnerOffset, 0),
      matchKey: base + partnerOffset,
      condition: false,
    });
    points.push({
      playerId: `mirage-decoy-${i}`,
      season: 2020,
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
      pointsPerGame: 10,
      nextPointsPerGame: 9,
      matchKey: 10,
      condition: true,
    },
    {
      playerId: "condition-far",
      season: 2020,
      pointsPerGame: 10,
      nextPointsPerGame: 9,
      matchKey: 10,
      condition: true,
    },
    {
      playerId: "control-only",
      season: 2020,
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
        pointsPerGame: 10,
        nextPointsPerGame: null,
        matchKey: 10,
        condition: true,
      },
      {
        playerId: "control-out",
        season: 2020,
        pointsPerGame: 10,
        nextPointsPerGame: null,
        matchKey: 10,
        condition: false,
      },
      {
        playerId: "condition-returns",
        season: 2020,
        pointsPerGame: 15,
        nextPointsPerGame: 14,
        matchKey: 15,
        condition: true,
      },
      {
        playerId: "control-returns",
        season: 2020,
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
