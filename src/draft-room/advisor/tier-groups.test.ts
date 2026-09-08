import { describe, expect, it } from "vitest";
import { groupByTier, tierHeaderText } from "./tier-groups";

const TIERS = { a: { tier: 2, left: 5, size: 6 }, b: { tier: 1, left: 2, size: 4 }, c: { tier: 2, left: 5, size: 6 } };

describe("groupByTier", () => {
  it("groups rows under their tier in tier order, keeps board order inside a tier, and trails the unranked with no header", () => {
    const groups = groupByTier(["a", "b", "c", "z"], (id) => id, TIERS);
    expect(groups.map((group) => group.header)).toEqual(["Tier 1, 2 of 4 left", "Tier 2, 5 of 6 left", null]);
    expect(groups.map((group) => group.rows)).toEqual([["b"], ["a", "c"], ["z"]]);
  });

  it("has no trailing group when every row is ranked, and no groups at all for no rows", () => {
    expect(groupByTier(["a", "c"], (id) => id, TIERS)).toEqual([{ header: "Tier 2, 5 of 6 left", rows: ["a", "c"] }]);
    expect(groupByTier([], (id) => id, TIERS)).toEqual([]);
  });

  it("words the header from the standing's own numbers", () => {
    expect(tierHeaderText({ tier: 3, left: 1, size: 5 })).toBe("Tier 3, 1 of 5 left");
  });
});
