import { describe, it, expect } from "vitest";
import { STANDARD_ROSTER_SLOTS, type RosterSlotConfig } from "@research/domain/roster";
import { describeRosterShape, ROSTER_SHAPES, SUPERFLEX_ROSTER_SLOTS } from "./roster-shape";

describe("SUPERFLEX_ROSTER_SLOTS", () => {
  it("adds exactly one slot to the standard shape: SUPERFLEX, between FLEX and K", () => {
    expect(SUPERFLEX_ROSTER_SLOTS).toHaveLength(STANDARD_ROSTER_SLOTS.length + 1);
    const flexIndex = SUPERFLEX_ROSTER_SLOTS.findIndex((s) => s.slot === "FLEX");
    const superflexIndex = SUPERFLEX_ROSTER_SLOTS.findIndex((s) => s.slot === "SUPERFLEX");
    const kIndex = SUPERFLEX_ROSTER_SLOTS.findIndex((s) => s.slot === "K");
    expect(superflexIndex).toBe(flexIndex + 1);
    expect(kIndex).toBe(superflexIndex + 1);
  });

  it("accepts a quarterback along with every FLEX-eligible position", () => {
    const superflex = SUPERFLEX_ROSTER_SLOTS.find((s) => s.slot === "SUPERFLEX")!;
    expect(superflex.eligiblePositions).toEqual(["QB", "RB", "WR", "TE"]);
    expect(superflex.count).toBe(1);
  });

  it("changes only the one row: every other slot matches the standard shape exactly", () => {
    const withoutSuperflex = SUPERFLEX_ROSTER_SLOTS.filter((s) => s.slot !== "SUPERFLEX");
    expect(withoutSuperflex).toEqual(STANDARD_ROSTER_SLOTS);
  });
});

describe("ROSTER_SHAPES", () => {
  it("names exactly the two shipped shapes", () => {
    expect(Object.keys(ROSTER_SHAPES)).toEqual(["standard", "superflex"]);
    expect(ROSTER_SHAPES.standard).toBe(STANDARD_ROSTER_SLOTS);
    expect(ROSTER_SHAPES.superflex).toBe(SUPERFLEX_ROSTER_SLOTS);
  });
});

describe("describeRosterShape", () => {
  it("names the superflex shape from the SUPERFLEX slot alone", () => {
    expect(describeRosterShape(SUPERFLEX_ROSTER_SLOTS)).toBe("Superflex");
  });

  it("names the standard shape when the rows match it exactly", () => {
    expect(describeRosterShape(STANDARD_ROSTER_SLOTS)).toBe("Standard");
  });

  it("describes a hand-edited shape honestly rather than mislabeling it", () => {
    // A commissioner who edits even one slot (here: a wider bench) has a shape neither shipped
    // preset names, the same "Custom" honesty `describeScoring` gives a hand-edited scoring rule.
    const widerBench: readonly RosterSlotConfig[] = STANDARD_ROSTER_SLOTS.map((s) =>
      s.slot === "BENCH" ? { ...s, count: 7 } : s,
    );
    expect(describeRosterShape(widerBench)).toBe("Custom");
  });
});
