import { describe, expect, it } from "vitest";
import { COMPOSITION_CATEGORIES, TIER_COMPOSITION_LABEL, compositionCategoryFor, tierCompositionFor } from "./composition";

describe("tierCompositionFor", () => {
  it("names an aggregate and never a member", () => {
    expect(tierCompositionFor({ newcomers: 8, veterans: 0 })).toEqual({ newcomers: 8, veterans: 0 });
  });

  it("passes both counts through unchanged, whatever their values", () => {
    expect(tierCompositionFor({ newcomers: 0, veterans: 12 })).toEqual({ newcomers: 0, veterans: 12 });
  });
});

describe("compositionCategoryFor", () => {
  it("reads 'all_newcomers' when every seat is a newcomer", () => {
    expect(compositionCategoryFor({ newcomers: 6, veterans: 0 })).toBe("all_newcomers");
    expect(compositionCategoryFor({ newcomers: 1, veterans: 0 })).toBe("all_newcomers");
  });

  it("reads 'mostly_newcomers' only once newcomers are a strict majority among seated managers", () => {
    expect(compositionCategoryFor({ newcomers: 7, veterans: 5 })).toBe("mostly_newcomers");
    expect(compositionCategoryFor({ newcomers: 2, veterans: 1 })).toBe("mostly_newcomers");
  });

  it("reads 'open' on a tie, a veteran majority, and an empty roster alike", () => {
    expect(compositionCategoryFor({ newcomers: 4, veterans: 4 })).toBe("open");
    expect(compositionCategoryFor({ newcomers: 2, veterans: 6 })).toBe("open");
    expect(compositionCategoryFor({ newcomers: 0, veterans: 6 })).toBe("open");
    // An empty roster has earned no claim to "all newcomers" — nobody has actually joined yet.
    expect(compositionCategoryFor({ newcomers: 0, veterans: 0 })).toBe("open");
  });
});

describe("TIER_COMPOSITION_LABEL", () => {
  it("labels every category the honest way a card can say it, with no raw ratio and no em-dash", () => {
    for (const category of COMPOSITION_CATEGORIES) {
      const label = TIER_COMPOSITION_LABEL[category];
      expect(label.length).toBeGreaterThan(0);
      expect(label).not.toMatch(/\d/);
      expect(label).not.toContain("—");
    }
    expect(TIER_COMPOSITION_LABEL.all_newcomers).toBe("All newcomers");
    expect(TIER_COMPOSITION_LABEL.mostly_newcomers).toBe("Mostly newcomers");
    expect(TIER_COMPOSITION_LABEL.open).toBe("Open to everyone");
  });
});
