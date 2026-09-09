import { describe, expect, it } from "vitest";
import type { BlendConstants } from "./blend";
import { blendConstantsWithPropsAnchor, parsePropsAnchorWeight, PROPS_ANCHOR_WEIGHT_ARTIFACT } from "./props-anchor-artifact";

const BASE: BlendConstants = {
  lawCapPoints: 2,
  availabilityCapPoints: 20,
  totalCapPoints: 40,
  impliedGamesByPosition: { QB: 14, RB: 12.4, WR: 13.4, TE: 12.9 },
  marketTailByPosition: { QB: 172.5, RB: 46, WR: 85.8, TE: 85.6 },
};

describe("the props-anchor weight artifact", () => {
  it("is pinned under its own name", () => {
    expect(PROPS_ANCHOR_WEIGHT_ARTIFACT.name).toBe("market/props-anchor-weight");
    expect(PROPS_ANCHOR_WEIGHT_ARTIFACT.version).toBeGreaterThanOrEqual(1);
  });

  it("accepts a weight in the unit interval, or null for a gate that was not beaten", () => {
    expect(parsePropsAnchorWeight({ weight: 0.18 })).toEqual({ weight: 0.18 });
    expect(parsePropsAnchorWeight({ weight: 0 })).toEqual({ weight: 0 });
    expect(parsePropsAnchorWeight({ weight: 1 })).toEqual({ weight: 1 });
    expect(parsePropsAnchorWeight({ weight: null })).toEqual({ weight: null });
  });

  it("names what it refuses", () => {
    expect(() => parsePropsAnchorWeight({})).toThrow(/weight/);
    expect(() => parsePropsAnchorWeight({ weight: "0.18" })).toThrow(/weight/);
    expect(() => parsePropsAnchorWeight({ weight: 1.5 })).toThrow(/weight/);
    expect(() => parsePropsAnchorWeight({ weight: Number.NaN })).toThrow(/weight/);
    expect(() => parsePropsAnchorWeight(null)).toThrow(/object/);
  });

  it("merges a beaten gate onto the blend constants for the blended arm, and hands back the base itself when the gate was not beaten", () => {
    expect(blendConstantsWithPropsAnchor(BASE, { weight: null })).toBe(BASE);
    expect(blendConstantsWithPropsAnchor(BASE, { weight: 0.18 })).toEqual({ ...BASE, propsAnchorWeight: 0.18 });
  });
});
