import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BLEND_TRAIN_CUTOFF_SEASON, scoreBlendConstants, type BlendConstants, type BlendTrainRow } from "@research-ts/projections/market/blend";
import { HELD_OUT_SEASONS } from "@research-ts/projections/model/fitted";
import { BENCHMARK_BOARD_FLOOR } from "@research-ts/projections/preseason/benchmarks";
import { ROOKIE_CURVE_TRAIN_CUTOFF_SEASON } from "@research-ts/projections/preseason/rookie-curve";
import { blendTrainSeasons } from "./blend-fit";
import { rookieCurveTrainSeasons } from "./rookie-curve-fit";

/**
 * THE STRUCTURAL PIN (fit-round Task 3, deliverable F) — the fit's objective CANNOT SEE the seasons
 * it will later be judged on, asserted rather than argued.
 *
 * THREE LAYERS, because any one of them alone can be true while the fit still leaks:
 *
 *   1. THE SETS ARE DISJOINT BY CONSTRUCTION. The train list is derived from two committed constants
 *      and the held-out list from a third; this test computes both and intersects them, so a future
 *      edit that moved `BLEND_TRAIN_CUTOFF_SEASON` past 2022 would fail here rather than in a
 *      scorecard nobody re-derives.
 *   2. THE GATE IS ARMED AT RUNTIME. `scoreBlendConstants` refuses a row from a held-out season,
 *      checked for every held-out season rather than for one example of one.
 *   3. THE SCRIPT'S DATA READS ARE BOUNDED BY THE TRAIN LIST. A source-level scan: after comments and
 *      string literals are stripped, `scripts/blend-fit.ts` contains NO season-shaped numeric literal
 *      at all, and every loop over seasons runs over `blendTrainSeasons()`. A leak in a fit script is
 *      almost always a hardcoded season somebody added to "just check" something, and that is exactly
 *      what this catches.
 */

const SOURCE_PATHS = ["scripts/blend-fit.ts", "scripts/rookie-curve-fit.ts"] as const;

/** Comments and string/template literals removed, so a season named in prose (this file's own
 *  header talks about 2023 and 2024 constantly) is never mistaken for a season the code reads. */
function executableSource(path: string): string {
  return readFileSync(path, "utf-8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ")
    .replace(/`(?:[^`\\]|\\.)*`/g, '""')
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\]|\\.)*'/g, '""');
}

describe("the train window and the scorecard's held-out window are disjoint BY CONSTRUCTION", () => {
  it("shares no season between the blend fit's train list and the held-out list", () => {
    const heldOut = new Set(HELD_OUT_SEASONS);
    expect(blendTrainSeasons().filter((season) => heldOut.has(season))).toEqual([]);
  });

  it("shares no season between the rookie curve's train list and the held-out list", () => {
    const heldOut = new Set(HELD_OUT_SEASONS);
    expect(rookieCurveTrainSeasons().filter((season) => heldOut.has(season))).toEqual([]);
  });

  it("puts EVERY held-out season strictly after EVERY train season, not merely outside the list", () => {
    const latestTrain = Math.max(...blendTrainSeasons(), ...rookieCurveTrainSeasons());
    for (const season of HELD_OUT_SEASONS) expect(season).toBeGreaterThan(latestTrain);
  });

  it("derives the train list from the committed floor and cutoff, so moving either moves this pin", () => {
    expect(blendTrainSeasons()[0]).toBe(BENCHMARK_BOARD_FLOOR);
    expect(blendTrainSeasons()[blendTrainSeasons().length - 1]).toBe(BLEND_TRAIN_CUTOFF_SEASON);
    expect(rookieCurveTrainSeasons()[rookieCurveTrainSeasons().length - 1]).toBe(ROOKIE_CURVE_TRAIN_CUTOFF_SEASON);
  });
});

describe("the objective REFUSES a held-out row at runtime", () => {
  const constants: BlendConstants = {
    lawCapPoints: 0,
    availabilityCapPoints: 0,
    totalCapPoints: 0,
    impliedGamesByPosition: { QB: 15, RB: 15, WR: 15, TE: 15 },
    marketTailByPosition: { QB: 0, RB: 0, WR: 0, TE: 0 },
  };

  function rowFor(season: number): BlendTrainRow {
    return {
      season,
      market: { playerId: "p", position: "RB", adpRank: 1, marketPoints: 100 },
      candidate: {
        playerId: "p",
        position: "RB",
        team: "KC",
        perGame: {} as BlendTrainRow["candidate"]["perGame"],
        games: { expected: 15, rate: 1, distribution: { floor: 0, median: 0, ceiling: 0 }, probabilities: [] },
        reasons: [],
      },
      actualPoints: 100,
    };
  }

  it("throws for every held-out season, not just for one example of one", () => {
    for (const season of HELD_OUT_SEASONS) {
      expect(() => scoreBlendConstants([rowFor(season)], constants, { heldOutSeasons: [], laws: [] }), `season ${season}`).toThrow(
        /past BLEND_TRAIN_CUTOFF_SEASON|held out/,
      );
    }
  });
});

describe("the fit scripts' data reads are bounded by the train list", () => {
  it("iterates seasons ONLY over the exported train-season list", () => {
    const source = executableSource("scripts/blend-fit.ts");
    const loops = [...source.matchAll(/for \(const (\w+) of ([^)]+)\)/g)].filter(([, name]) => name === "season");
    expect(loops.length).toBeGreaterThan(0);
    for (const [, , iterated] of loops) expect(iterated).toContain("seasons");
    expect(source).toContain("const seasons = blendTrainSeasons()");
  });

  it("contains NO season-shaped numeric literal in executable code — no hardcoded year can sneak a read in", () => {
    for (const path of SOURCE_PATHS) {
      const literals = executableSource(path).match(/(?<![\w.])(19|20)\d{2}(?![\w.])/g) ?? [];
      expect(literals, `${path} carries season literals in executable code: ${literals.join(", ")}`).toEqual([]);
    }
  });

  it("the rookie curve fit loads observations for its own train list and nothing else", () => {
    const source = executableSource("scripts/rookie-curve-fit.ts");
    expect(source).toContain("const seasons = rookieCurveTrainSeasons()");
    expect(source).toContain("deps.loadObservations(db, seasons)");
  });
});

describe("the scorecard judges on the held-out seasons, and says so in one place", () => {
  it("defaults market-edge-scorecard.ts's target seasons to exactly the held-out list", () => {
    const source = readFileSync("scripts/market-edge-scorecard.ts", "utf-8");
    const match = /TARGET_SEASONS = SEASONS\.length > 0 \? SEASONS : \[([^\]]+)\]/.exec(source);
    expect(match, "market-edge-scorecard.ts no longer declares TARGET_SEASONS the way this pin reads it").not.toBeNull();
    const declared = match![1]!.split(",").map((value) => Number(value.trim()));
    expect(declared).toEqual([...HELD_OUT_SEASONS]);
  });
});
