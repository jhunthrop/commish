import { describe, expect, it } from "vitest";
import { HALF_PPR_SCORING, PPR_SCORING, STANDARD_SCORING } from "@research/domain/scoring";
import { BENCHMARK_SOURCES } from "@research/projections/preseason/benchmarks";
import { FITTED_BLEND_CONSTANTS } from "./blend-fitted";
import { FITTED_MARKET_CURVE } from "./curve-fitted";
import { FITTED_MARKET_CURVE_HALF } from "./curve-fitted-half";
import { FITTED_MARKET_CURVE_STD } from "./curve-fitted-std";
import { blendConstantsFor, formatAnchorFor, marketTailAtExchangeRate, TAIL_EXCHANGE_BAND } from "./format-anchor";
import type { MarketCurvePriors } from "./curve";

describe("formatAnchorFor", () => {
  it("hands PPR the committed curve, source and rules every earlier board read, by reference", () => {
    const anchor = formatAnchorFor("ppr");
    expect(anchor.curve).toBe(FITTED_MARKET_CURVE);
    expect(anchor.adpSource).toBe(BENCHMARK_SOURCES.adp);
    expect(anchor.rules).toBe(PPR_SCORING);
  });

  it("pairs each other format's own feed with its own curve and preset", () => {
    expect(formatAnchorFor("half")).toMatchObject({ curve: FITTED_MARKET_CURVE_HALF, adpSource: BENCHMARK_SOURCES.adpHalf, rules: HALF_PPR_SCORING });
    expect(formatAnchorFor("std")).toMatchObject({ curve: FITTED_MARKET_CURVE_STD, adpSource: BENCHMARK_SOURCES.adpStd, rules: STANDARD_SCORING });
  });
});

/** A flat curve at one value per position across the whole exchange band. */
function flat(points: Readonly<Record<"QB" | "RB" | "WR" | "TE", number>>): MarketCurvePriors {
  const knots = (value: number) => [
    { adpRank: 1, points: value },
    { adpRank: TAIL_EXCHANGE_BAND.to + 50, points: value },
  ];
  return { QB: knots(points.QB), RB: knots(points.RB), WR: knots(points.WR), TE: knots(points.TE) };
}

describe("marketTailAtExchangeRate", () => {
  const base = { QB: 170, RB: 46, WR: 86, TE: 85 } as const;

  it("restates the PPR tail at the ratio of the two curves over the deep band", () => {
    const ppr = flat({ QB: 200, RB: 100, WR: 100, TE: 100 });
    const format = flat({ QB: 200, RB: 60, WR: 75, TE: 50 });
    const tail = marketTailAtExchangeRate(base, ppr, format);
    expect(tail.QB).toBeCloseTo(170, 10);
    expect(tail.RB).toBeCloseTo(46 * 0.6, 10);
    expect(tail.WR).toBeCloseTo(86 * 0.75, 10);
    expect(tail.TE).toBeCloseTo(85 * 0.5, 10);
  });

  it("reads the band, not the last knot: a singleton zero at the deepest slot does not zero the tail", () => {
    const ppr = flat({ QB: 200, RB: 100, WR: 100, TE: 100 });
    const format: MarketCurvePriors = {
      ...flat({ QB: 200, RB: 100, WR: 100, TE: 100 }),
      WR: [
        { adpRank: 1, points: 100 },
        { adpRank: TAIL_EXCHANGE_BAND.to, points: 100 },
        { adpRank: TAIL_EXCHANGE_BAND.to + 20, points: 0 },
      ],
    };
    expect(marketTailAtExchangeRate(base, ppr, format).WR).toBe(86);
  });

  it("refuses a curve with nothing in the band rather than inventing a zero tail", () => {
    const ppr = flat({ QB: 200, RB: 100, WR: 100, TE: 100 });
    const empty: MarketCurvePriors = { ...flat({ QB: 200, RB: 100, WR: 100, TE: 100 }), QB: [] };
    expect(() => marketTailAtExchangeRate(base, ppr, empty)).toThrow(/QB/);
  });
});

describe("blendConstantsFor", () => {
  it("returns the committed PPR constants themselves, untouched, for the default format", () => {
    expect(blendConstantsFor(FITTED_BLEND_CONSTANTS, "ppr")).toBe(FITTED_BLEND_CONSTANTS);
  });

  it("swaps only the tail for another format, keeping every cap and the implied games", () => {
    const half = blendConstantsFor(FITTED_BLEND_CONSTANTS, "half");
    expect(half.marketTailByPosition).not.toEqual(FITTED_BLEND_CONSTANTS.marketTailByPosition);
    expect({ ...half, marketTailByPosition: FITTED_BLEND_CONSTANTS.marketTailByPosition }).toEqual(FITTED_BLEND_CONSTANTS);
  });

  it("a receiver's standard tail sits below his half-PPR tail, which sits below his PPR tail, as reception weight implies", () => {
    const ppr = FITTED_BLEND_CONSTANTS.marketTailByPosition;
    const half = blendConstantsFor(FITTED_BLEND_CONSTANTS, "half").marketTailByPosition;
    const std = blendConstantsFor(FITTED_BLEND_CONSTANTS, "std").marketTailByPosition;
    for (const position of ["RB", "WR", "TE"] as const) {
      expect(std[position]).toBeLessThan(half[position]);
      expect(half[position]).toBeLessThan(ppr[position]);
      expect(std[position]).toBeGreaterThan(0);
    }
  });
});
