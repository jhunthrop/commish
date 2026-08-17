import { describe, it, expect } from "vitest";
import { contrastRatio, relativeLuminance } from "./contrast";

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
