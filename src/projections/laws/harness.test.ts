import { describe, expect, it } from "vitest";
import { matchedPairs, measureEffect, verdictFor } from "./harness";
import type { PlayerSeasonPoint } from "./types";

/** A synthetic population: `n` condition/control pairs at identical matchKeys, with the
 *  condition group's next season shifted by `plantedEffect` beyond the control's. */
function planted(n: number, plantedEffect: number, seed = 7): readonly PlayerSeasonPoint[] {
  // Deterministic LCG noise ±0.5 — same generator every call, so the same (n, plantedEffect, seed)
  // always produces the same population.
  let x = seed;
  const next = (): number => {
    x = (1103515245 * x + 12345) % 2 ** 31;
    return x / 2 ** 31;
  };
  const noise = (): number => next() - 0.5;

  const points: PlayerSeasonPoint[] = [];
  for (let i = 0; i < n; i += 1) {
    const now = 10 + (i % 20);
    points.push({
      playerId: `condition-${i}`,
      season: 2020,
      pointsPerGame: now,
      nextPointsPerGame: now + noise() + plantedEffect,
      matchKey: now,
      condition: true,
    });
    points.push({
      playerId: `control-${i}`,
      season: 2020,
      pointsPerGame: now,
      nextPointsPerGame: now + noise(),
      matchKey: now,
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

  const m = measureEffect(pairs);
  expect(m.sample).toBe(0);
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
