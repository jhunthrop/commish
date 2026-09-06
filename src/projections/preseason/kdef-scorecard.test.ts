import { describe, expect, it } from "vitest";
import {
  GATE_THRESHOLDS,
  decisionFor,
  gateCalibration,
  gateIsolation,
  gateMarket,
  gateOrdering,
} from "./kdef-scorecard";

const actual = new Map([["a", 10], ["b", 20], ["c", 30], ["d", 40]]);
const eligible = new Set(["a", "b", "c", "d"]);
const perfect = new Map([["a", 1], ["b", 2], ["c", 3], ["d", 4]]);
const reversed = new Map([["a", 4], ["b", 3], ["c", 2], ["d", 1]]);
const nearly = new Map([["a", 1], ["b", 2], ["c", 4], ["d", 3]]);

describe("the preregistered gates", () => {
  it("carries the spec's own thresholds, verbatim", () => {
    expect(GATE_THRESHOLDS.orderingBeatsLastSeasonBy).toBe(0.05);
    expect(GATE_THRESHOLDS.marketShortfallAllowed).toBe(0.02);
    expect(GATE_THRESHOLDS.coverage).toEqual({ min: 0.4, max: 0.6 });
  });

  it("G1 passes only when the model beats last-season order by the stated margin", () => {
    expect(gateOrdering({ model: perfect, baseline: reversed, actual, eligible }).passed).toBe(true);
    expect(gateOrdering({ model: perfect, baseline: perfect, actual, eligible }).passed).toBe(false);
    expect(gateOrdering({ model: reversed, baseline: perfect, actual, eligible }).passed).toBe(false);
  });

  it("G1 reports both correlations and the sample size, so the results document can quote it", () => {
    const detail = gateOrdering({ model: perfect, baseline: reversed, actual, eligible }).detail;
    expect(detail).toMatch(/1\.0000/);
    expect(detail).toMatch(/n=4/);
  });

  it("G2 passes when the model is no worse than the market by more than the stated shortfall", () => {
    expect(gateMarket({ model: perfect, baseline: nearly, actual, eligible }).passed).toBe(true);
    expect(gateMarket({ model: nearly, baseline: perfect, actual, eligible }).passed).toBe(false);
    expect(gateMarket({ model: perfect, baseline: perfect, actual, eligible }).passed).toBe(true);
  });

  it("G2 fails rather than passes when the covered subset cannot answer", () => {
    const result = gateMarket({ model: new Map(), baseline: new Map(), actual, eligible: new Set() });
    expect(result.passed).toBe(false);
    expect(result.detail).toMatch(/cannot answer/i);
  });

  it("scores only the players present on every side, so neither arm is credited for breadth", () => {
    const wider = new Map([...perfect, ["e", 5]]);
    const result = gateOrdering({ model: wider, baseline: reversed, actual, eligible });
    expect(result.detail).toMatch(/n=4/);
  });

  it("G3 passes when between forty and sixty percent of outcomes fall inside the band", () => {
    const bands = [
      { playerId: "a", floor: 0, ceiling: 100 },
      { playerId: "b", floor: 0, ceiling: 100 },
      { playerId: "c", floor: 0, ceiling: 5 },
      { playerId: "d", floor: 0, ceiling: 5 },
    ];
    expect(gateCalibration(bands, actual).passed).toBe(true);
    expect(gateCalibration(bands.map((band) => ({ ...band, ceiling: 1000 })), actual).passed).toBe(false);
    expect(gateCalibration(bands.map((band) => ({ ...band, ceiling: 1 })), actual).passed).toBe(false);
  });

  it("G3 counts a value exactly on the boundary as covered", () => {
    expect(gateCalibration([{ playerId: "a", floor: 10, ceiling: 10 }], new Map([["a", 10]])).detail).toMatch(/1 of 1/);
  });

  it("G3 fails rather than passes on an empty sample", () => {
    const result = gateCalibration([], actual);
    expect(result.passed).toBe(false);
    expect(result.detail).toMatch(/cannot answer/i);
  });

  it("G4 passes only on a byte-identical set of skill rows", () => {
    expect(gateIsolation(["QB Allen 400.12"], ["QB Allen 400.12"]).passed).toBe(true);
    expect(gateIsolation(["QB Allen 400.12"], ["QB Allen 400.13"]).passed).toBe(false);
    expect(gateIsolation(["QB Allen 400.12"], ["QB Allen 400.12", "RB Barkley 300.00"]).passed).toBe(false);
  });

  it("G4 names the first row that differs", () => {
    const result = gateIsolation(["a", "b", "c"], ["a", "X", "c"]);
    expect(result.detail).toMatch(/row 2/);
    expect(result.detail).toMatch(/X/);
  });

  it("G4 fails rather than passes on two empty renderings, which prove nothing", () => {
    const result = gateIsolation([], []);
    expect(result.passed).toBe(false);
    expect(result.detail).toMatch(/cannot answer/i);
  });

  it("ships projected rows only when every gate passed", () => {
    const pass = { name: "g", passed: true, detail: "" };
    const fail = { name: "g", passed: false, detail: "" };
    expect(decisionFor([pass, pass, pass, pass])).toBe("projected");
    expect(decisionFor([pass, pass, fail, pass])).toBe("market_order");
    expect(decisionFor([])).toBe("market_order");
  });
});
