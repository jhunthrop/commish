import { describe, it, expect } from "vitest";
import { quartilesFromSeasonBand } from "./band-quartiles";

describe("quartilesFromSeasonBand", () => {
  it("derives the everyday band from the stored normal-tail distribution", () => {
    // sigma = (284 - 91) / (2 * 1.2816) = 75.29; p25/p75 = 187.4 -/+ 0.6745 * sigma
    const { p25, p75 } = quartilesFromSeasonBand(187.4, 91, 284);
    expect(p25).toBeCloseTo(136.6, 0);
    expect(p75).toBeCloseTo(238.2, 0);
    // The everyday band nests strictly inside the tail band, around the median.
    expect(p25).toBeGreaterThan(91);
    expect(p75).toBeLessThan(284);
    expect(p25).toBeLessThan(187.4);
    expect(p75).toBeGreaterThan(187.4);
  });

  it("collapses to the median for a degenerate band", () => {
    expect(quartilesFromSeasonBand(100, 100, 100)).toEqual({ p25: 100, p75: 100 });
  });

  it("throws on a band that disagrees with its own median", () => {
    expect(() => quartilesFromSeasonBand(50, 91, 284)).toThrow(/bracket its median/);
    expect(() => quartilesFromSeasonBand(300, 91, 284)).toThrow(/bracket its median/);
  });
});
