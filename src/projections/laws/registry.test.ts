import { describe, expect, it } from "vitest";
import {
  parseMeasuredJson,
  registry,
  registryFrom,
  stratumKeyFor,
  verdictForFullWindow,
  type FoldEffect,
  type MeasuredEntry,
  type MeasuredJson,
} from "./registry";
import { LAW_SPECS, type LawSpec } from "./populations";
import type { PlayerSeasonPoint } from "./types";
import { predictOpportunity } from "../model/opportunity";
import { TOUCHDOWN_RATES } from "../model/efficiency";
import { fitRedistributionPriors } from "../model/redistribution-fit";

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

/** Three folds, all agreeing with a `-1` expected sign — the default "every fold agrees" shape. */
const AGREEING_FOLDS: readonly FoldEffect[] = [
  { season: 2021, effect: -1 },
  { season: 2022, effect: -1 },
  { season: 2023, effect: -1 },
];

function measurementFixture(over: Partial<MeasuredEntry> = {}): MeasuredEntry {
  const base: MeasuredEntry = {
    effect: -3,
    ci: [-4, -2],
    sample: 40,
    seasons: "2013-2023 (2019 missing upstream), direction replicated on predictor seasons 2021-2023",
    foldEffects: AGREEING_FOLDS,
    verdict: "confirmed",
  };
  return { ...base, ...over };
}

describe("registryFrom", () => {
  it("merges a spec's static fields with its measurement into one Law, dropping foldEffects from `measured`", () => {
    const spec = specFixture();
    const measured = measurementFixture();
    const [law] = registryFrom([spec], { fake_law: measured });

    expect(law).toEqual({
      id: "fake_law",
      position: "RB",
      claim: spec.claim,
      measured: { effect: -3, ci: [-4, -2], sample: 40, seasons: measured.seasons },
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

  it("throws when the stored verdict disagrees with verdictForFullWindow's own computation", () => {
    const spec = specFixture({ expectedSign: -1 });
    // Full-window CI excludes zero, sign matches, every fold agrees in sign — verdictForFullWindow
    // computes "confirmed", not "weak".
    const measured = measurementFixture({ effect: -3, ci: [-4, -2], foldEffects: AGREEING_FOLDS, verdict: "weak" });
    expect(() => registryFrom([spec], { fake_law: measured })).toThrow(/verdict for "fake_law" is "weak".*computes "confirmed"/);
  });

  it("accepts every verdict shape verdictForFullWindow can produce, when the stored verdict matches it", () => {
    const oneFoldDisagrees: readonly FoldEffect[] = [
      { season: 2021, effect: -1 },
      { season: 2022, effect: 1 }, // disagrees with expectedSign -1
      { season: 2023, effect: -1 },
    ];
    const oneFoldSkippedRestAgree: readonly FoldEffect[] = [
      { season: 2021, effect: null }, // zero pairs that predictor season — skipped, not counted against the law
      { season: 2022, effect: -1 },
      { season: 2023, effect: -1 },
    ];
    const zeroFoldsWithPairs: readonly FoldEffect[] = [
      { season: 2021, effect: null },
      { season: 2022, effect: null },
      { season: 2023, effect: null },
    ];
    const cases: readonly MeasuredEntry[] = [
      { effect: -3, ci: [-4, -2], sample: 40, seasons: "s", foldEffects: AGREEING_FOLDS, verdict: "confirmed" }, // full CI excludes zero, sign matches, every fold agrees
      { effect: -3, ci: [-1, 1], sample: 40, seasons: "s", foldEffects: AGREEING_FOLDS, verdict: "weak" }, // sign matches, full CI spans zero
      { effect: 3, ci: [2, 4], sample: 40, seasons: "s", foldEffects: [{ season: 2021, effect: 1 }], verdict: "debunked" }, // full sign wrong
      { effect: -3, ci: [-4, -2], sample: 40, seasons: "s", foldEffects: oneFoldDisagrees, verdict: "weak" }, // full confirms, one fold disagrees — capped
      { effect: -3, ci: [-4, -2], sample: 40, seasons: "s", foldEffects: oneFoldSkippedRestAgree, verdict: "confirmed" }, // full confirms, a zero-pair fold is skipped, the rest agree
      { effect: -3, ci: [-4, -2], sample: 40, seasons: "s", foldEffects: zeroFoldsWithPairs, verdict: "weak" }, // full confirms, zero folds carry any pairs — capped, never confirmed
    ];
    for (const measured of cases) {
      const spec = specFixture({ expectedSign: -1 });
      expect(() => registryFrom([spec], { fake_law: measured })).not.toThrow();
      const [law] = registryFrom([spec], { fake_law: measured });
      expect(law!.verdict).toBe(verdictForFullWindow(measured, -1, measured.foldEffects));
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

describe("verdictForFullWindow", () => {
  const EXPECTED: -1 = -1;
  const FULL_WINDOW_CONFIRMS = { effect: -3, ci: [-4, -2] as const, sample: 10, seasons: "s" };
  const FULL_WINDOW_SPANS_ZERO = { effect: -3, ci: [-1, 1] as const, sample: 10, seasons: "s" };
  const FULL_WINDOW_WRONG_SIGN = { effect: 3, ci: [2, 4] as const, sample: 10, seasons: "s" };

  it("confirms when the full window's CI excludes zero, the sign matches, AND every fold agrees in sign", () => {
    const allFoldsAgree: readonly FoldEffect[] = [
      { season: 2021, effect: -1 },
      { season: 2022, effect: -2 },
      { season: 2023, effect: -0.5 },
    ];
    expect(verdictForFullWindow(FULL_WINDOW_CONFIRMS, EXPECTED, allFoldsAgree)).toBe("confirmed");
  });

  it("caps a full-window confirm at weak when one fold disagrees in sign", () => {
    const oneFoldDisagrees: readonly FoldEffect[] = [
      { season: 2021, effect: -1 },
      { season: 2022, effect: 1 },
      { season: 2023, effect: -1 },
    ];
    expect(verdictForFullWindow(FULL_WINDOW_CONFIRMS, EXPECTED, oneFoldDisagrees)).toBe("weak");
  });

  it("skips a fold that matched zero pairs (effect: null) rather than counting it against the law, and still confirms when every other fold agrees", () => {
    const oneFoldSkipped: readonly FoldEffect[] = [
      { season: 2021, effect: null },
      { season: 2022, effect: -1 },
      { season: 2023, effect: -1 },
    ];
    expect(verdictForFullWindow(FULL_WINDOW_CONFIRMS, EXPECTED, oneFoldSkipped)).toBe("confirmed");
  });

  it("caps a full-window confirm at weak when zero folds carry any pairs at all — never confirmed on no replication evidence", () => {
    const zeroFoldsWithPairs: readonly FoldEffect[] = [
      { season: 2021, effect: null },
      { season: 2022, effect: null },
      { season: 2023, effect: null },
    ];
    expect(verdictForFullWindow(FULL_WINDOW_CONFIRMS, EXPECTED, zeroFoldsWithPairs)).toBe("weak");
  });

  it("stays weak when the full-window sign matches but its own CI spans zero, regardless of the folds", () => {
    const allFoldsAgree: readonly FoldEffect[] = [{ season: 2021, effect: -1 }];
    const zeroFoldsWithPairs: readonly FoldEffect[] = [{ season: 2021, effect: null }];
    expect(verdictForFullWindow(FULL_WINDOW_SPANS_ZERO, EXPECTED, allFoldsAgree)).toBe("weak");
    expect(verdictForFullWindow(FULL_WINDOW_SPANS_ZERO, EXPECTED, zeroFoldsWithPairs)).toBe("weak");
  });

  it("stays debunked when the full-window sign disagrees with expectedSign, regardless of the folds", () => {
    const allFoldsAgree: readonly FoldEffect[] = [{ season: 2021, effect: -1 }];
    const zeroFoldsWithPairs: readonly FoldEffect[] = [{ season: 2021, effect: null }];
    expect(verdictForFullWindow(FULL_WINDOW_WRONG_SIGN, EXPECTED, allFoldsAgree)).toBe("debunked");
    expect(verdictForFullWindow(FULL_WINDOW_WRONG_SIGN, EXPECTED, zeroFoldsWithPairs)).toBe("debunked");
  });
});

describe("registry", () => {
  it("reads the committed measured.json against the real LAW_SPECS with no drift", () => {
    const laws = registry();
    expect(laws.map((law) => law.id).sort()).toEqual(LAW_SPECS.map((spec) => spec.id).sort());
  });
});

describe("parseMeasuredJson", () => {
  it("parses a well-shaped measured.json into a MeasuredJson", () => {
    const measured = measurementFixture();
    expect(parseMeasuredJson(JSON.stringify({ fake_law: measured }))).toEqual({ fake_law: measured });
  });

  it("throws a clear malformed-field message rather than letting a bad hand edit reach registryFrom", () => {
    // effect typo'd into a string — the kind of hand edit the module's own docblock worries about.
    const malformed = JSON.stringify({ fake_law: { ...measurementFixture(), effect: "-3" } });
    expect(() => parseMeasuredJson(malformed)).toThrow(/malformed measured\.json: "fake_law"\.effect is not a finite number/);
  });
});

/**
 * THE MODEL-WIRING DRIFT GUARD (this wave, 2026-08-31): every confirmed law's `modelPath` names a
 * real export of a real model file. Importing the symbol directly, rather than resolving the
 * string at runtime, is the point — a rename of `fitRedistributionPriors`, `predictOpportunity`
 * or `TOUCHDOWN_RATES` breaks this file at compile time, before the assertion below ever runs,
 * exactly the "so a rename breaks the test" the field's own docblock (`populations.ts`) promises.
 */
describe("modelPath wiring", () => {
  const WIRED: ReadonlyMap<string, { readonly file: string; readonly symbolName: string; readonly symbol: unknown }> = new Map([
    [
      "wr_target_competition",
      { file: "src/projections/model/redistribution-fit.ts", symbolName: "fitRedistributionPriors", symbol: fitRedistributionPriors },
    ],
    [
      "target_share_persistence",
      { file: "src/projections/model/opportunity.ts", symbolName: "predictOpportunity", symbol: predictOpportunity },
    ],
    ["td_regression", { file: "src/projections/model/efficiency.ts", symbolName: "TOUCHDOWN_RATES", symbol: TOUCHDOWN_RATES }],
  ]);

  it("names a real, imported exported symbol for every non-null modelPath, and nothing else carries one", () => {
    for (const spec of LAW_SPECS) {
      const wired = WIRED.get(spec.id);
      if (wired === undefined) {
        expect(spec.modelPath, `${spec.id} has a modelPath but no entry in this test's WIRED map`).toBeNull();
        continue;
      }
      expect(spec.modelPath).toBe(`${wired.file}#${wired.symbolName}`);
      expect(wired.symbol).toBeDefined();
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
