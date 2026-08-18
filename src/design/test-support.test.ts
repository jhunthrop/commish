import { describe, it, expect } from "vitest";
import { contrastRatio, relativeLuminance, hueDegrees, hueDistance } from "./test-support";

describe("relativeLuminance", () => {
  it("is 0 for black and 1 for white", () => {
    expect(relativeLuminance("#000000")).toBeCloseTo(0, 5);
    expect(relativeLuminance("#ffffff")).toBeCloseTo(1, 5);
  });
  it("accepts 3-digit hex", () => {
    expect(relativeLuminance("#fff")).toBeCloseTo(1, 5);
  });
});

describe("contrastRatio", () => {
  it("is 21:1 for black on white and symmetric", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 1);
    expect(contrastRatio("#ffffff", "#000000")).toBeCloseTo(21, 1);
  });
  it("is 1:1 for identical colors", () => {
    expect(contrastRatio("#123456", "#123456")).toBeCloseTo(1, 5);
  });
  it("throws a clear error for a non-hex input", () => {
    expect(() => contrastRatio("red", "#fff")).toThrow(/hex color/);
  });
});

describe("hueDegrees", () => {
  it("computes standard RGB→HSL hue for primaries", () => {
    expect(hueDegrees("#FF0000")).toBeCloseTo(0, 5);
    expect(hueDegrees("#00FF00")).toBeCloseTo(120, 5);
    expect(hueDegrees("#0000FF")).toBeCloseTo(240, 5);
  });
  it("is 0 for a gray (no saturation)", () => {
    expect(hueDegrees("#808080")).toBeCloseTo(0, 5);
  });
});

describe("hueDistance", () => {
  it("is the shortest arc between two hues, wrapping at 0/360", () => {
    expect(hueDistance(350, 10)).toBeCloseTo(20, 5);
    expect(hueDistance(10, 350)).toBeCloseTo(20, 5);
  });
  it("is 0 for identical hues", () => {
    expect(hueDistance(120, 120)).toBe(0);
  });
  it("is at most 180", () => {
    expect(hueDistance(0, 180)).toBeCloseTo(180, 5);
  });
});
