import { describe, expect, it } from "vitest";
import {
  MIN_WEEKS_FOR_DISPERSION,
  outlookAround,
  realizedDispersion,
  standardDeviationOf,
} from "./outlook";

describe("outlookAround and standardDeviationOf", () => {
  it("round-trip: a spread in is the same spread out", () => {
    const outlook = outlookAround(14, 6);
    expect(standardDeviationOf(outlook)).toBeCloseTo(6, 9);
    expect(outlook.floor).toBeLessThan(outlook.median);
    expect(outlook.median).toBeLessThan(outlook.ceiling);
  });

  it("reads a skewed pair off the whole span, not off one half", () => {
    const skewed = { floor: 4, median: 8, ceiling: 30 };
    expect(standardDeviationOf(skewed)).toBeCloseTo(26 / (2 * 1.2815515655446004), 9);
  });

  it("refuses a distribution whose floor is above its ceiling", () => {
    expect(() => standardDeviationOf({ floor: 20, median: 10, ceiling: 5 })).toThrow(/20/);
  });

  it("refuses a spread that is not a number", () => {
    expect(() => outlookAround(10, Number.NaN)).toThrow(/spread/);
  });
});

describe("realizedDispersion", () => {
  it("measures the spread of weeks already played", () => {
    expect(realizedDispersion([10, 10, 10, 10])).toBe(0);
    expect(realizedDispersion([2, 30, 4, 28])).toBeGreaterThan(10);
  });

  it("says unknown rather than steady when it has barely seen him", () => {
    const tooFew = [22, 4, 19];
    expect(tooFew.length).toBeLessThan(MIN_WEEKS_FOR_DISPERSION);
    expect(realizedDispersion(tooFew)).toBeNull();
  });

  it("refuses a non-finite week rather than propagating it", () => {
    expect(() => realizedDispersion([10, 12, Number.POSITIVE_INFINITY, 8])).toThrow(/non-finite/);
  });
});
