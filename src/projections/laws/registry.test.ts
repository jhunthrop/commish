import { describe, expect, it } from "vitest";
import { registry, registryFrom, stratumKeyFor, type MeasuredEntry, type MeasuredJson } from "./registry";
import { verdictFor } from "./harness";
import { LAW_SPECS, type LawSpec } from "./populations";
import type { PlayerSeasonPoint } from "./types";

/**
 * `registryFrom` DRIVEN WITH HAND-BUILT FIXTURES — no DB, no `measured.json` on disk. Every test
 * here is about the merge/drift-guard logic itself; the six real `LAW_SPECS` and the real measured
 * evidence are exercised only by `scripts/measure-laws.ts`'s own run and this file's one
 * `registry()`-shaped assumption is never invoked.
 */

function specFixture(over: Partial<LawSpec> = {}): LawSpec {
  return {
    id: "fake_law",
    position: "RB",
    claim: "A fake claim, for fixtures only.",
    expectedSign: -1,
    caliper: 2,
    modelPath: null,
    population: async () => [],
    ...over,
  };
}

function measurementFixture(over: Partial<MeasuredEntry> = {}): MeasuredEntry {
  const base: MeasuredEntry = { effect: -3, ci: [-4, -2], sample: 40, seasons: "2011-2024, held out 2023-2024", verdict: "confirmed" };
  return { ...base, ...over };
}

describe("registryFrom", () => {
  it("merges a spec's static fields with its measurement into one Law", () => {
    const spec = specFixture();
    const measured = measurementFixture();
    const [law] = registryFrom([spec], { fake_law: measured });

    expect(law).toEqual({
      id: "fake_law",
      position: "RB",
      claim: spec.claim,
      measured: { effect: -3, ci: [-4, -2], sample: 40, seasons: "2011-2024, held out 2023-2024" },
      verdict: "confirmed",
      modelPath: null,
    });
  });

  it("throws when a LawSpec has no entry in measured.json", () => {
    const spec = specFixture({ id: "unmeasured_law" });
    expect(() => registryFrom([spec], {})).toThrow(/unmeasured_law.*no entry/);
  });

  it("throws when measured.json has an entry with no matching LawSpec — an orphaned measurement", () => {
    const spec = specFixture({ id: "kept_law" });
    const measuredJson: MeasuredJson = {
      kept_law: measurementFixture(),
      orphaned_law: measurementFixture(),
    };
    expect(() => registryFrom([spec], measuredJson)).toThrow(/orphaned_law.*no matching LawSpec/);
  });

  it("throws when the stored verdict disagrees with verdictFor's own computation", () => {
    const spec = specFixture({ expectedSign: -1 });
    // effect is negative and the CI excludes zero, so verdictFor computes "confirmed" — not "weak".
    const measured = measurementFixture({ effect: -3, ci: [-4, -2], verdict: "weak" });
    expect(() => registryFrom([spec], { fake_law: measured })).toThrow(/verdict for "fake_law" is "weak".*computes "confirmed"/);
  });

  it("accepts every verdict shape verdictFor can produce, when the stored verdict matches it", () => {
    const cases: readonly MeasuredEntry[] = [
      { effect: -3, ci: [-4, -2], sample: 40, seasons: "s", verdict: "confirmed" }, // CI excludes zero, sign matches
      { effect: -3, ci: [-1, 1], sample: 40, seasons: "s", verdict: "weak" }, // sign matches, CI spans zero
      { effect: 3, ci: [2, 4], sample: 40, seasons: "s", verdict: "debunked" }, // sign wrong
    ];
    for (const measured of cases) {
      const spec = specFixture({ expectedSign: -1 });
      expect(() => registryFrom([spec], { fake_law: measured })).not.toThrow();
      const [law] = registryFrom([spec], { fake_law: measured });
      expect(law!.verdict).toBe(verdictFor(measured, -1));
    }
  });

  it("returns one Law per spec, in the specs' own order, regardless of measured.json's key order", () => {
    const specA = specFixture({ id: "law_a" });
    const specB = specFixture({ id: "law_b" });
    const measuredJson: MeasuredJson = {
      law_b: measurementFixture(),
      law_a: measurementFixture(),
    };
    const laws = registryFrom([specA, specB], measuredJson);
    expect(laws.map((law) => law.id)).toEqual(["law_a", "law_b"]);
  });
});

describe("registry", () => {
  it("reads the committed measured.json against the real LAW_SPECS with no drift", () => {
    const laws = registry();
    expect(laws.map((law) => law.id).sort()).toEqual(LAW_SPECS.map((spec) => spec.id).sort());
    for (const law of laws) {
      const spec = LAW_SPECS.find((entry) => entry.id === law.id)!;
      expect(law.verdict).toBe(verdictFor(law.measured, spec.expectedSign));
    }
  });
});

describe("stratumKeyFor", () => {
  const point = (over: Partial<PlayerSeasonPoint> = {}): PlayerSeasonPoint => ({
    playerId: "p",
    season: 2020,
    position: "WR",
    pointsPerGame: 10,
    nextPointsPerGame: 8,
    matchKey: 10,
    condition: true,
    ...over,
  });

  it("keys a single-position law by season alone", () => {
    const spec = specFixture({ position: "RB" });
    expect(stratumKeyFor(spec, point({ season: 2019, position: "WR" }))).toBe("2019");
  });

  it("keys a law whose population spans positions (position: \"all\") by season AND position", () => {
    const spec = specFixture({ position: "all" });
    expect(stratumKeyFor(spec, point({ season: 2019, position: "TE" }))).toBe("2019|TE");
    expect(stratumKeyFor(spec, point({ season: 2019, position: "WR" }))).toBe("2019|WR");
  });
});
