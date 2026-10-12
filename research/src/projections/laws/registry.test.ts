import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  chipEligibleLaws,
  DISCOVERED_JSON_PATH,
  discoveredLawsFrom,
  discoveredPipelineCounts,
  MIN_OUT_OF_TRAIN_FOLD_PAIRS,
  MIN_REPLICATION_PAIRS,
  parseDiscoveredJson,
  parseMeasuredJson,
  registry,
  registryFrom,
  stratumKeyFor,
  verdictForDiscoveredLaw,
  verdictForFullWindow,
  type DiscoveredEntry,
  type DiscoveredJson,
  type FoldEffect,
  type MeasuredEntry,
  type MeasuredJson,
} from "./registry";
import { LAW_SPECS, type LawSpec } from "./populations";
import { generateCandidates } from "./discovery/generate";
import type { Law, PlayerSeasonPoint } from "./types";
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
  { season: 2021, pairs: 10, effect: -1 },
  { season: 2022, pairs: 10, effect: -1 },
  { season: 2023, pairs: 10, effect: -1 },
];

function measurementFixture(over: Partial<MeasuredEntry> = {}): MeasuredEntry {
  const base: MeasuredEntry = {
    effect: -3,
    trainEffect: -2.5,
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
      trainEffect: measured.trainEffect,
      verdict: "confirmed",
      modelPath: null,
      hasFoldEvidence: true,
      origin: "tribal",
      primaryQuantityId: null,
      primaryQuantityNoun: null,
      primaryQuantityUnit: null,
    });
  });

  it("derives hasFoldEvidence as false when every fold matched zero pairs, even though the verdict itself is unaffected by this alone", () => {
    const zeroFoldsWithPairs = measurementFixture({
      foldEffects: [
        { season: 2021, pairs: 0, effect: null },
        { season: 2022, pairs: 0, effect: null },
        { season: 2023, pairs: 0, effect: null },
      ],
      verdict: "weak", // full window would confirm, but zero folds with pairs caps it at weak
    });
    const [law] = registryFrom([specFixture()], { fake_law: zeroFoldsWithPairs });
    expect(law!.hasFoldEvidence).toBe(false);
  });

  it("derives hasFoldEvidence as true when at least one fold matched a pair, even one that disagreed", () => {
    const oneFoldDisagrees = measurementFixture({
      foldEffects: [
        { season: 2021, pairs: 10, effect: -1 },
        { season: 2022, pairs: 10, effect: 1 },
        { season: 2023, pairs: 10, effect: -1 },
      ],
      verdict: "weak", // full window would confirm, but a disagreeing fold caps it at weak
    });
    const [law] = registryFrom([specFixture()], { fake_law: oneFoldDisagrees });
    expect(law!.hasFoldEvidence).toBe(true);
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
      { season: 2021, pairs: 10, effect: -1 },
      { season: 2022, pairs: 10, effect: 1 }, // disagrees with expectedSign -1
      { season: 2023, pairs: 10, effect: -1 },
    ];
    const oneFoldSkippedRestAgree: readonly FoldEffect[] = [
      { season: 2021, pairs: 0, effect: null }, // zero pairs that predictor season — skipped, not counted against the law
      { season: 2022, pairs: 10, effect: -1 },
      { season: 2023, pairs: 10, effect: -1 },
    ];
    const zeroFoldsWithPairs: readonly FoldEffect[] = [
      { season: 2021, pairs: 0, effect: null },
      { season: 2022, pairs: 0, effect: null },
      { season: 2023, pairs: 0, effect: null },
    ];
    const cases: readonly MeasuredEntry[] = [
      { effect: -3, trainEffect: -2.5, ci: [-4, -2], sample: 40, seasons: "s", foldEffects: AGREEING_FOLDS, verdict: "confirmed" }, // full CI excludes zero, sign matches, every fold agrees
      { effect: -3, trainEffect: -2.5, ci: [-1, 1], sample: 40, seasons: "s", foldEffects: AGREEING_FOLDS, verdict: "weak" }, // sign matches, full CI spans zero
      { effect: 3, trainEffect: 2.5, ci: [2, 4], sample: 40, seasons: "s", foldEffects: [{ season: 2021, pairs: 10, effect: 1 }], verdict: "debunked" }, // full sign wrong
      { effect: -3, trainEffect: -2.5, ci: [-4, -2], sample: 40, seasons: "s", foldEffects: oneFoldDisagrees, verdict: "weak" }, // full confirms, one fold disagrees — capped
      { effect: -3, trainEffect: -2.5, ci: [-4, -2], sample: 40, seasons: "s", foldEffects: oneFoldSkippedRestAgree, verdict: "confirmed" }, // full confirms, a zero-pair fold is skipped, the rest agree
      { effect: -3, trainEffect: -2.5, ci: [-4, -2], sample: 40, seasons: "s", foldEffects: zeroFoldsWithPairs, verdict: "weak" }, // full confirms, zero folds carry any pairs — capped, never confirmed
      { effect: -3, trainEffect: -2.5, ci: [-4, -2], sample: MIN_REPLICATION_PAIRS - 1, seasons: "s", foldEffects: AGREEING_FOLDS, verdict: "weak" }, // full confirms, every fold agrees, but sample is below the floor — capped
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
  // sample: 40 clears MIN_REPLICATION_PAIRS (the origin-blind floor, IMPORTANT 4 RULING) — these
  // fixtures are about the CI/sign/fold-agreement rule; the floor gets its own describe block below.
  const FULL_WINDOW_CONFIRMS = { effect: -3, ci: [-4, -2] as const, sample: 40, seasons: "s" };
  const FULL_WINDOW_SPANS_ZERO = { effect: -3, ci: [-1, 1] as const, sample: 40, seasons: "s" };
  const FULL_WINDOW_WRONG_SIGN = { effect: 3, ci: [2, 4] as const, sample: 40, seasons: "s" };

  it("confirms when the full window's CI excludes zero, the sign matches, AND every fold agrees in sign", () => {
    const allFoldsAgree: readonly FoldEffect[] = [
      { season: 2021, pairs: 10, effect: -1 },
      { season: 2022, pairs: 10, effect: -2 },
      { season: 2023, pairs: 10, effect: -0.5 },
    ];
    expect(verdictForFullWindow(FULL_WINDOW_CONFIRMS, EXPECTED, allFoldsAgree)).toBe("confirmed");
  });

  it("caps a full-window confirm at weak when one fold disagrees in sign", () => {
    const oneFoldDisagrees: readonly FoldEffect[] = [
      { season: 2021, pairs: 10, effect: -1 },
      { season: 2022, pairs: 10, effect: 1 },
      { season: 2023, pairs: 10, effect: -1 },
    ];
    expect(verdictForFullWindow(FULL_WINDOW_CONFIRMS, EXPECTED, oneFoldDisagrees)).toBe("weak");
  });

  it("skips a fold that matched zero pairs (effect: null) rather than counting it against the law, and still confirms when every other fold agrees", () => {
    const oneFoldSkipped: readonly FoldEffect[] = [
      { season: 2021, pairs: 0, effect: null },
      { season: 2022, pairs: 10, effect: -1 },
      { season: 2023, pairs: 10, effect: -1 },
    ];
    expect(verdictForFullWindow(FULL_WINDOW_CONFIRMS, EXPECTED, oneFoldSkipped)).toBe("confirmed");
  });

  it("caps a full-window confirm at weak when zero folds carry any pairs at all — never confirmed on no replication evidence", () => {
    const zeroFoldsWithPairs: readonly FoldEffect[] = [
      { season: 2021, pairs: 0, effect: null },
      { season: 2022, pairs: 0, effect: null },
      { season: 2023, pairs: 0, effect: null },
    ];
    expect(verdictForFullWindow(FULL_WINDOW_CONFIRMS, EXPECTED, zeroFoldsWithPairs)).toBe("weak");
  });

  it("stays weak when the full-window sign matches but its own CI spans zero, regardless of the folds", () => {
    const allFoldsAgree: readonly FoldEffect[] = [{ season: 2021, pairs: 10, effect: -1 }];
    const zeroFoldsWithPairs: readonly FoldEffect[] = [{ season: 2021, pairs: 0, effect: null }];
    expect(verdictForFullWindow(FULL_WINDOW_SPANS_ZERO, EXPECTED, allFoldsAgree)).toBe("weak");
    expect(verdictForFullWindow(FULL_WINDOW_SPANS_ZERO, EXPECTED, zeroFoldsWithPairs)).toBe("weak");
  });

  it("stays debunked when the full-window sign disagrees with expectedSign, regardless of the folds", () => {
    const allFoldsAgree: readonly FoldEffect[] = [{ season: 2021, pairs: 10, effect: -1 }];
    const zeroFoldsWithPairs: readonly FoldEffect[] = [{ season: 2021, pairs: 0, effect: null }];
    expect(verdictForFullWindow(FULL_WINDOW_WRONG_SIGN, EXPECTED, allFoldsAgree)).toBe("debunked");
    expect(verdictForFullWindow(FULL_WINDOW_WRONG_SIGN, EXPECTED, zeroFoldsWithPairs)).toBe("debunked");
  });

  /** IMPORTANT 4 RULING (fix round): origin-blind — this floor used to apply to discovered
   *  candidates only, via `verdictForDiscoveredLaw`'s own extra step; it is now inside
   *  `verdictForFullWindow` itself, so a TRIBAL law is graded by the identical rule. */
  describe("the MIN_REPLICATION_PAIRS floor, origin-blind", () => {
    const allFoldsAgree: readonly FoldEffect[] = [
      { season: 2021, pairs: 10, effect: -1 },
      { season: 2022, pairs: 10, effect: -2 },
      { season: 2023, pairs: 10, effect: -0.5 },
    ];

    it("caps a full-window confirm at weak when the sample is below MIN_REPLICATION_PAIRS, even with every fold agreeing", () => {
      const thinSample = { ...FULL_WINDOW_CONFIRMS, sample: MIN_REPLICATION_PAIRS - 1 };
      expect(verdictForFullWindow(thinSample, EXPECTED, allFoldsAgree)).toBe("weak");
    });

    it("confirms right at the MIN_REPLICATION_PAIRS boundary (inclusive)", () => {
      const atBoundary = { ...FULL_WINDOW_CONFIRMS, sample: MIN_REPLICATION_PAIRS };
      expect(verdictForFullWindow(atBoundary, EXPECTED, allFoldsAgree)).toBe("confirmed");
    });

    it("never upgrades a weak or debunked result regardless of sample size", () => {
      const spansZero = { ...FULL_WINDOW_SPANS_ZERO, sample: 10_000 };
      const wrongSign = { ...FULL_WINDOW_WRONG_SIGN, sample: 10_000 };
      expect(verdictForFullWindow(spansZero, EXPECTED, allFoldsAgree)).toBe("weak");
      expect(verdictForFullWindow(wrongSign, EXPECTED, allFoldsAgree)).toBe("debunked");
    });
  });
});

describe("registry", () => {
  it("reads the committed measured.json against the real LAW_SPECS with no drift, tagged tribal", () => {
    const laws = registry();
    const tribal = laws.filter((law) => law.origin === "tribal");
    expect(tribal.map((law) => law.id).sort()).toEqual(LAW_SPECS.map((spec) => spec.id).sort());
  });

  it("merges in the committed discovered.json's own BH survivors, tagged discovered, with no drift", () => {
    const laws = registry();
    const discoveredJson = parseDiscoveredJson(readFileSync(DISCOVERED_JSON_PATH, "utf-8"));
    const discovered = laws.filter((law) => law.origin === "discovered");
    expect(discovered.map((law) => law.id).sort()).toEqual(Object.keys(discoveredJson.laws).sort());
    for (const law of discovered) expect(law.modelPath).toBeNull();
  });

  it("never produces a duplicate id across the tribal and discovered halves", () => {
    const ids = registry().map((law) => law.id);
    expect(new Set(ids).size).toBe(ids.length);
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
      { file: "research/src/projections/model/redistribution-fit.ts", symbolName: "fitRedistributionPriors", symbol: fitRedistributionPriors },
    ],
    [
      "target_share_persistence",
      { file: "research/src/projections/model/opportunity.ts", symbolName: "predictOpportunity", symbol: predictOpportunity },
    ],
    ["td_regression", { file: "research/src/projections/model/efficiency.ts", symbolName: "TOUCHDOWN_RATES", symbol: TOUCHDOWN_RATES }],
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

/**
 * `verdictForDiscoveredLaw`, `parseDiscoveredJson`, `discoveredLawsFrom` — the DISCOVERED half of the
 * registry (Task 7, 2026-08-31), driven with hand-built fixtures the same way the tribal describe
 * blocks above drive `registryFrom`/`parseMeasuredJson`/`verdictForFullWindow`.
 */

// 2021 sits INSIDE the discovery train window (IMPORTANT 1/2 RULINGS) — 2022 and 2023 are the two
// genuinely out-of-train folds, both carrying >= MIN_OUT_OF_TRAIN_FOLD_PAIRS (5) here by default.
const FOLDS_AGREE_NEGATIVE: readonly FoldEffect[] = [
  { season: 2021, pairs: 10, effect: -1 },
  { season: 2022, pairs: 10, effect: -1.5 },
  { season: 2023, pairs: 10, effect: -0.5 },
];

function discoveredEntryFixture(over: Partial<DiscoveredEntry> = {}): DiscoveredEntry {
  const base: DiscoveredEntry = {
    effect: -3,
    trainEffect: -2.5,
    ci: [-4, -2],
    sample: 40,
    seasons: "2013-2023",
    foldEffects: FOLDS_AGREE_NEGATIVE,
    verdict: "confirmed",
    origin: "discovered",
    position: "RB",
    template: "threshold",
    claim: "A running back whose combined carries and receptions that season is in the top 20% of running backs loses points per game the following season.",
    expectedSign: -1,
    primaryQuantityId: "touches",
    primaryQuantityNoun: "carries and receptions",
    primaryQuantityUnit: "whole",
  };
  return { ...base, ...over };
}

describe("verdictForDiscoveredLaw", () => {
  const FULL_WINDOW_CONFIRMS = { effect: -3, ci: [-4, -2] as const, sample: 40, seasons: "s" };

  it("confirms when verdictForFullWindow would AND at least one out-of-train fold (2022/2023) carries >= MIN_OUT_OF_TRAIN_FOLD_PAIRS", () => {
    expect(verdictForDiscoveredLaw(FULL_WINDOW_CONFIRMS, -1, FOLDS_AGREE_NEGATIVE)).toBe("confirmed");
  });

  it("caps a full-window confirm at weak when the sample is below MIN_REPLICATION_PAIRS, even with every fold agreeing (delegates to verdictForFullWindow's own floor)", () => {
    const thinSample = { ...FULL_WINDOW_CONFIRMS, sample: MIN_REPLICATION_PAIRS - 1 };
    expect(verdictForDiscoveredLaw(thinSample, -1, FOLDS_AGREE_NEGATIVE)).toBe("weak");
  });

  it("confirms right at the MIN_REPLICATION_PAIRS boundary (inclusive)", () => {
    const atBoundary = { ...FULL_WINDOW_CONFIRMS, sample: MIN_REPLICATION_PAIRS };
    expect(verdictForDiscoveredLaw(atBoundary, -1, FOLDS_AGREE_NEGATIVE)).toBe("confirmed");
  });

  it("never upgrades a weak or debunked verdictForFullWindow result regardless of sample size", () => {
    const spansZero = { effect: -3, ci: [-1, 1] as const, sample: 1000, seasons: "s" };
    const wrongSign = { effect: 3, ci: [2, 4] as const, sample: 1000, seasons: "s" };
    expect(verdictForDiscoveredLaw(spansZero, -1, FOLDS_AGREE_NEGATIVE)).toBe("weak");
    expect(verdictForDiscoveredLaw(wrongSign, -1, FOLDS_AGREE_NEGATIVE)).toBe("debunked");
  });

  it("still caps at weak when a fold disagrees, regardless of sample size", () => {
    const oneFoldDisagrees: readonly FoldEffect[] = [
      { season: 2021, pairs: 10, effect: -1 },
      { season: 2022, pairs: 10, effect: 1 },
      { season: 2023, pairs: 10, effect: -1 },
    ];
    expect(verdictForDiscoveredLaw(FULL_WINDOW_CONFIRMS, -1, oneFoldDisagrees)).toBe("weak");
  });

  /** IMPORTANT 1 + IMPORTANT 2 RULINGS (fix round): 2021 sits INSIDE the discovery train window, so
   *  a discovered law confirmed on fold agreement alone — even every fold agreeing, even a huge
   *  sample — still needs a genuinely OUT-OF-TRAIN fold (2022 or 2023) to itself carry enough pairs
   *  to trust. `verdictForFullWindow`'s own "every fold with pairs agrees" rule cannot see this
   *  distinction; only `verdictForDiscoveredLaw` does. */
  describe("the out-of-train replication gate (2021 is in-train; only 2022/2023 count)", () => {
    it("caps at weak when the ONLY fold with pairs is 2021 (in-train) — no out-of-train evidence at all", () => {
      const only2021: readonly FoldEffect[] = [
        { season: 2021, pairs: 10, effect: -1 },
        { season: 2022, pairs: 0, effect: null },
        { season: 2023, pairs: 0, effect: null },
      ];
      // verdictForFullWindow itself would already cap this at weak (zero folds with pairs beyond
      // 2021 disagreeing is moot — but to isolate the OUT-OF-TRAIN gate specifically, note this
      // case is ALSO caught by verdictForFullWindow's "every fold with pairs agrees" rule passing
      // (2021 is the only fold with pairs, and it agrees) — the interesting assertion is that
      // verdictForDiscoveredLaw does NOT confirm here even though verdictForFullWindow alone would.
      expect(verdictForFullWindow(FULL_WINDOW_CONFIRMS, -1, only2021)).toBe("confirmed");
      expect(verdictForDiscoveredLaw(FULL_WINDOW_CONFIRMS, -1, only2021)).toBe("weak");
    });

    it("caps at weak when an out-of-train fold has pairs but BELOW MIN_OUT_OF_TRAIN_FOLD_PAIRS", () => {
      const thinOutOfTrain: readonly FoldEffect[] = [
        { season: 2021, pairs: 10, effect: -1 },
        { season: 2022, pairs: MIN_OUT_OF_TRAIN_FOLD_PAIRS - 1, effect: -1 },
        { season: 2023, pairs: 0, effect: null },
      ];
      expect(verdictForDiscoveredLaw(FULL_WINDOW_CONFIRMS, -1, thinOutOfTrain)).toBe("weak");
    });

    it("confirms right at the MIN_OUT_OF_TRAIN_FOLD_PAIRS boundary (inclusive) on a single out-of-train fold", () => {
      const atBoundary: readonly FoldEffect[] = [
        { season: 2021, pairs: 10, effect: -1 },
        { season: 2022, pairs: MIN_OUT_OF_TRAIN_FOLD_PAIRS, effect: -1 },
        { season: 2023, pairs: 0, effect: null },
      ];
      expect(verdictForDiscoveredLaw(FULL_WINDOW_CONFIRMS, -1, atBoundary)).toBe("confirmed");
    });

    it("confirms when 2023 alone (not 2022) clears the out-of-train floor", () => {
      const only2023: readonly FoldEffect[] = [
        { season: 2021, pairs: 10, effect: -1 },
        { season: 2022, pairs: 0, effect: null },
        { season: 2023, pairs: MIN_OUT_OF_TRAIN_FOLD_PAIRS, effect: -1 },
      ];
      expect(verdictForDiscoveredLaw(FULL_WINDOW_CONFIRMS, -1, only2023)).toBe("confirmed");
    });
  });
});

describe("parseDiscoveredJson", () => {
  it("parses a well-shaped discovered.json into a DiscoveredJson", () => {
    const entry = discoveredEntryFixture();
    const raw = JSON.stringify({ counts: { candidates: 1737, untestable: 900, bhSurvivors: 1, replicated: 1 }, laws: { fake_candidate: entry } });
    expect(parseDiscoveredJson(raw)).toEqual({
      counts: { candidates: 1737, untestable: 900, bhSurvivors: 1, replicated: 1 },
      laws: { fake_candidate: entry },
    });
  });

  it("throws when counts is missing a field", () => {
    const raw = JSON.stringify({ counts: { candidates: 1737, untestable: 900, bhSurvivors: 1 }, laws: {} });
    expect(() => parseDiscoveredJson(raw)).toThrow(/counts\.replicated is not a finite number/);
  });

  it("throws on the same malformed measured-entry fields parseMeasuredJson catches", () => {
    const malformed = JSON.stringify({
      counts: { candidates: 1, untestable: 0, bhSurvivors: 1, replicated: 1 },
      laws: { fake_candidate: { ...discoveredEntryFixture(), effect: "-3" } },
    });
    expect(() => parseDiscoveredJson(malformed)).toThrow(/"fake_candidate"\.effect is not a finite number/);
  });

  it("throws when origin is not \"discovered\"", () => {
    const malformed = JSON.stringify({
      counts: { candidates: 1, untestable: 0, bhSurvivors: 1, replicated: 1 },
      laws: { fake_candidate: { ...discoveredEntryFixture(), origin: "tribal" } },
    });
    expect(() => parseDiscoveredJson(malformed)).toThrow(/"fake_candidate"\.origin is not "discovered"/);
  });

  it("throws when expectedSign is not -1 or 1", () => {
    const malformed = JSON.stringify({
      counts: { candidates: 1, untestable: 0, bhSurvivors: 1, replicated: 1 },
      laws: { fake_candidate: { ...discoveredEntryFixture(), expectedSign: 0 } },
    });
    expect(() => parseDiscoveredJson(malformed)).toThrow(/"fake_candidate"\.expectedSign is not -1 or 1/);
  });

  it("throws when template is not one of threshold | delta | and", () => {
    const malformed = JSON.stringify({
      counts: { candidates: 1, untestable: 0, bhSurvivors: 1, replicated: 1 },
      laws: { fake_candidate: { ...discoveredEntryFixture(), template: "bogus" } },
    });
    expect(() => parseDiscoveredJson(malformed)).toThrow(/"fake_candidate"\.template is not one of/);
  });

  /** The three PRESENTATION fields (Task 8 fix round, IMPORTANT 2 RULING) — written by
   *  `discovery/measure.ts` at discovery time, read here for shape only (the cross-check against
   *  the live template lives in `board-reasons.ts`'s own consistency guard, not in parsing). */
  describe("the presentation fields (primaryQuantityId/Noun/Unit)", () => {
    it("throws when primaryQuantityId is missing or empty", () => {
      const malformed = JSON.stringify({
        counts: { candidates: 1, untestable: 0, bhSurvivors: 1, replicated: 1 },
        laws: { fake_candidate: { ...discoveredEntryFixture(), primaryQuantityId: "" } },
      });
      expect(() => parseDiscoveredJson(malformed)).toThrow(/"fake_candidate"\.primaryQuantityId is not a non-empty string/);
    });

    it("throws when primaryQuantityNoun is missing or empty", () => {
      const malformed = JSON.stringify({
        counts: { candidates: 1, untestable: 0, bhSurvivors: 1, replicated: 1 },
        laws: { fake_candidate: { ...discoveredEntryFixture(), primaryQuantityNoun: "" } },
      });
      expect(() => parseDiscoveredJson(malformed)).toThrow(/"fake_candidate"\.primaryQuantityNoun is not a non-empty string/);
    });

    it("throws when primaryQuantityUnit is not one of the four valid tags", () => {
      const malformed = JSON.stringify({
        counts: { candidates: 1, untestable: 0, bhSurvivors: 1, replicated: 1 },
        laws: { fake_candidate: { ...discoveredEntryFixture(), primaryQuantityUnit: "bogus" } },
      });
      expect(() => parseDiscoveredJson(malformed)).toThrow(/"fake_candidate"\.primaryQuantityUnit is not one of/);
    });

    it("accepts every valid primaryQuantityUnit tag", () => {
      for (const unit of ["whole", "one_decimal", "two_decimal", "percent"] as const) {
        const raw = JSON.stringify({
          counts: { candidates: 1, untestable: 0, bhSurvivors: 1, replicated: 1 },
          laws: { fake_candidate: { ...discoveredEntryFixture(), primaryQuantityUnit: unit } },
        });
        expect(() => parseDiscoveredJson(raw)).not.toThrow();
      }
    });
  });

  it("throws when a foldEffects entry's pairs is negative", () => {
    const entry = discoveredEntryFixture({ foldEffects: [{ season: 2021, pairs: -1, effect: -1 }] });
    const malformed = JSON.stringify({ counts: { candidates: 1, untestable: 0, bhSurvivors: 1, replicated: 1 }, laws: { fake_candidate: entry } });
    expect(() => parseDiscoveredJson(malformed)).toThrow(/non-finite or negative pairs count/);
  });

  it("throws when a foldEffects entry's pairs === 0 disagrees with its own effect being non-null", () => {
    const entry = discoveredEntryFixture({ foldEffects: [{ season: 2021, pairs: 0, effect: -1 }] });
    const malformed = JSON.stringify({ counts: { candidates: 1, untestable: 0, bhSurvivors: 1, replicated: 1 }, laws: { fake_candidate: entry } });
    expect(() => parseDiscoveredJson(malformed)).toThrow(/pairs === 0 and effect === null disagree/);
  });

  /**
   * NEW-6 RULING's own failure path (fix round 3 — round 2 added the cross-check but every existing
   * fixture happened to already satisfy it, so the throw itself was never exercised). Both checks
   * fire on the SAME shape of drift: `counts` claims a number that disagrees with what `laws` (the
   * actual committed entries) holds.
   */
  it("throws when counts.bhSurvivors disagrees with the actual number of laws entries", () => {
    const entry = discoveredEntryFixture(); // verdict: "confirmed" by default
    const malformed = JSON.stringify({
      counts: { candidates: 1737, untestable: 900, bhSurvivors: 2, replicated: 1 }, // claims 2, laws has 1
      laws: { fake_candidate: entry },
    });
    expect(() => parseDiscoveredJson(malformed)).toThrow(/counts\.bhSurvivors is 2 but laws has 1 entries/);
  });

  it("throws when counts.replicated disagrees with the actual number of confirmed laws entries", () => {
    const entry = discoveredEntryFixture(); // verdict: "confirmed" by default
    const malformed = JSON.stringify({
      counts: { candidates: 1737, untestable: 900, bhSurvivors: 1, replicated: 0 }, // claims 0 confirmed, laws has 1
      laws: { fake_candidate: entry },
    });
    expect(() => parseDiscoveredJson(malformed)).toThrow(/counts\.replicated is 0 but laws has 1 confirmed entries/);
  });
});

// `discoveredLawsFrom`'s orphan guard (IMPORTANT 5 RULING) defaults to the REAL `generateCandidates()`
// ids, so every fixture below that isn't specifically testing the orphan guard passes its own small
// `candidateIds` set explicitly — the same "specs as a parameter" discipline `registryFrom`'s own
// tests use for `LAW_SPECS`, so a fixture id like "fake_candidate" never needs to be a real one.
const FAKE_CANDIDATE_IDS: ReadonlySet<string> = new Set(["fake_candidate"]);

describe("discoveredLawsFrom", () => {
  it("merges a discovered entry into a Law, origin: \"discovered\", modelPath always null", () => {
    const entry = discoveredEntryFixture();
    const discoveredJson: DiscoveredJson = { counts: { candidates: 1, untestable: 0, bhSurvivors: 1, replicated: 1 }, laws: { fake_candidate: entry } };
    const [law] = discoveredLawsFrom(discoveredJson, FAKE_CANDIDATE_IDS);
    expect(law).toEqual({
      id: "fake_candidate",
      position: "RB",
      claim: entry.claim,
      measured: { effect: -3, ci: [-4, -2], sample: 40, seasons: "2013-2023" },
      trainEffect: entry.trainEffect,
      verdict: "confirmed",
      modelPath: null,
      hasFoldEvidence: true,
      origin: "discovered",
      primaryQuantityId: "touches",
      primaryQuantityNoun: "carries and receptions",
      primaryQuantityUnit: "whole",
    });
  });

  it("throws when the stored verdict disagrees with verdictForDiscoveredLaw's own computation", () => {
    const entry = discoveredEntryFixture({ sample: MIN_REPLICATION_PAIRS - 1, verdict: "confirmed" }); // should be "weak" — thin sample
    const discoveredJson: DiscoveredJson = { counts: { candidates: 1, untestable: 0, bhSurvivors: 1, replicated: 0 }, laws: { fake_candidate: entry } };
    expect(() => discoveredLawsFrom(discoveredJson, FAKE_CANDIDATE_IDS)).toThrow(/verdict for "fake_candidate" is "confirmed".*computes "weak"/);
  });

  it("returns an empty array for zero survivors — a legitimate, publishable result", () => {
    const discoveredJson: DiscoveredJson = { counts: { candidates: 1737, untestable: 1737, bhSurvivors: 0, replicated: 0 }, laws: {} };
    expect(discoveredLawsFrom(discoveredJson, FAKE_CANDIDATE_IDS)).toEqual([]);
  });

  it("derives hasFoldEvidence false when every fold matched zero pairs", () => {
    const entry = discoveredEntryFixture({
      foldEffects: [
        { season: 2021, pairs: 0, effect: null },
        { season: 2022, pairs: 0, effect: null },
        { season: 2023, pairs: 0, effect: null },
      ],
      verdict: "weak",
    });
    const discoveredJson: DiscoveredJson = { counts: { candidates: 1, untestable: 0, bhSurvivors: 1, replicated: 0 }, laws: { fake_candidate: entry } };
    const [law] = discoveredLawsFrom(discoveredJson, FAKE_CANDIDATE_IDS);
    expect(law!.hasFoldEvidence).toBe(false);
  });

  /** IMPORTANT 5 RULING (fix round): the registryFrom-equivalent orphan guard for discovered.json.
   */
  describe("the orphan guard (IMPORTANT 5 RULING)", () => {
    it("throws when discovered.json has an entry with no matching candidate in the given candidateIds set", () => {
      const entry = discoveredEntryFixture();
      const discoveredJson: DiscoveredJson = { counts: { candidates: 1, untestable: 0, bhSurvivors: 1, replicated: 1 }, laws: { orphaned_id: entry } };
      expect(() => discoveredLawsFrom(discoveredJson, new Set(["some_other_id"]))).toThrow(
        /orphaned_id.*no matching candidate in generateCandidates\(\)/,
      );
    });

    it("accepts an entry whose id IS in the given candidateIds set", () => {
      const entry = discoveredEntryFixture();
      const discoveredJson: DiscoveredJson = { counts: { candidates: 1, untestable: 0, bhSurvivors: 1, replicated: 1 }, laws: { fake_candidate: entry } };
      expect(() => discoveredLawsFrom(discoveredJson, FAKE_CANDIDATE_IDS)).not.toThrow();
    });

    it("defaults candidateIds to the REAL generateCandidates() ids when not given, and accepts a real one", () => {
      const [firstRealId] = generateCandidates().map((candidate) => candidate.id);
      const entry = discoveredEntryFixture();
      const discoveredJson: DiscoveredJson = {
        counts: { candidates: 1, untestable: 0, bhSurvivors: 1, replicated: 1 },
        laws: { [firstRealId!]: entry },
      };
      expect(() => discoveredLawsFrom(discoveredJson)).not.toThrow();
    });

    it("defaults candidateIds to the REAL generateCandidates() ids when not given, and rejects a fake one", () => {
      const entry = discoveredEntryFixture();
      const discoveredJson: DiscoveredJson = { counts: { candidates: 1, untestable: 0, bhSurvivors: 1, replicated: 1 }, laws: { not_a_real_candidate_id: entry } };
      expect(() => discoveredLawsFrom(discoveredJson)).toThrow(/not_a_real_candidate_id.*no matching candidate/);
    });
  });
});

describe("chipEligibleLaws", () => {
  function lawFixture(over: Partial<Law> = {}): Law {
    return {
      id: "fixture_law",
      position: "RB",
      claim: "Fixture claim.",
      measured: { effect: -1, ci: [-2, -0.5], sample: 100, seasons: "s" },
      trainEffect: -1,
      verdict: "confirmed",
      modelPath: null,
      hasFoldEvidence: true,
      origin: "tribal",
      primaryQuantityId: null,
      primaryQuantityNoun: null,
      primaryQuantityUnit: null,
      ...over,
    };
  }

  it("keeps every tribal law regardless of verdict", () => {
    const laws: readonly Law[] = [lawFixture({ id: "a", verdict: "confirmed" }), lawFixture({ id: "b", verdict: "weak" })];
    expect(chipEligibleLaws(laws).map((law) => law.id)).toEqual(["a", "b"]);
  });

  it("keeps a CONFIRMED discovered law alongside every tribal one (Task 8's own widened predicate)", () => {
    const laws: readonly Law[] = [
      lawFixture({ id: "tribal_one", origin: "tribal" }),
      lawFixture({ id: "discovered_confirmed", origin: "discovered", verdict: "confirmed" }),
      lawFixture({ id: "discovered_weak", origin: "discovered", verdict: "weak" }),
      lawFixture({ id: "discovered_debunked", origin: "discovered", verdict: "debunked" }),
    ];
    expect(chipEligibleLaws(laws).map((law) => law.id)).toEqual(["tribal_one", "discovered_confirmed"]);
  });
});

describe("discoveredPipelineCounts", () => {
  it("reads the committed discovered.json's own top-level counts", () => {
    const raw = readFileSync(DISCOVERED_JSON_PATH, "utf-8");
    const expected = parseDiscoveredJson(raw).counts;
    expect(discoveredPipelineCounts()).toEqual(expected);
  });
});
