import { describe, expect, it } from "vitest";
import { STANDARD_ROSTER_SLOTS, type RosterSlot } from "@/domain/roster";
import { needFractions, needsByTeam, pickValueVerdict, positionNeeds } from "./lens";

const filled = (slot: RosterSlot["slot"], slotIndex: number): RosterSlot => ({ slot, slotIndex, playerId: `p-${slot}-${slotIndex}` });

describe("positionNeeds", () => {
  it("names every open dedicated slot, in config order, once per copy", () => {
    expect(positionNeeds(STANDARD_ROSTER_SLOTS, [])).toEqual(["QB", "RB", "RB", "WR", "WR", "TE"]);
  });

  it("filled slots retire their need; flex, bench, K and DEF never appear", () => {
    const roster = [filled("QB", 0), filled("RB", 0), filled("FLEX", 0), filled("BENCH", 0), filled("K", 0)];
    expect(positionNeeds(STANDARD_ROSTER_SLOTS, roster)).toEqual(["RB", "WR", "WR", "TE"]);
  });

  it("a full starting core needs nothing", () => {
    const roster = [filled("QB", 0), filled("RB", 0), filled("RB", 1), filled("WR", 0), filled("WR", 1), filled("TE", 0)];
    expect(positionNeeds(STANDARD_ROSTER_SLOTS, roster)).toEqual([]);
  });
});

describe("needsByTeam", () => {
  it("covers every seat, including teams with no roster entry yet", () => {
    const needs = needsByTeam(STANDARD_ROSTER_SLOTS, { t1: [filled("QB", 0)] }, ["t1", "t2"]);
    expect(needs.get("t1")).toEqual(["RB", "RB", "WR", "WR", "TE"]);
    expect(needs.get("t2")).toEqual(["QB", "RB", "RB", "WR", "WR", "TE"]);
  });
});

describe("needFractions", () => {
  it("states filled over total per dedicated position, in config order, from an empty roster", () => {
    expect(needFractions(STANDARD_ROSTER_SLOTS, [])).toEqual([
      { position: "QB", filled: 0, total: 1, satisfied: false },
      { position: "RB", filled: 0, total: 2, satisfied: false },
      { position: "WR", filled: 0, total: 2, satisfied: false },
      { position: "TE", filled: 0, total: 1, satisfied: false },
    ]);
  });

  it("counts fills toward the fraction and marks a filled position satisfied", () => {
    const roster = [filled("QB", 0), filled("RB", 0), filled("FLEX", 0), filled("K", 0)];
    const fractions = needFractions(STANDARD_ROSTER_SLOTS, roster);
    expect(fractions.find((fraction) => fraction.position === "QB")).toEqual({ position: "QB", filled: 1, total: 1, satisfied: true });
    expect(fractions.find((fraction) => fraction.position === "RB")).toEqual({ position: "RB", filled: 1, total: 2, satisfied: false });
    // FLEX and K never appear — the same scope the NEEDS lens keeps.
    expect(fractions.map((fraction) => fraction.position)).toEqual(["QB", "RB", "WR", "TE"]);
  });

  it("caps filled at the starting total: a third RB never reads 3/2", () => {
    const roster = [filled("RB", 0), filled("RB", 1), filled("RB", 2)];
    expect(needFractions(STANDARD_ROSTER_SLOTS, roster).find((fraction) => fraction.position === "RB")).toEqual({
      position: "RB",
      filled: 2,
      total: 2,
      satisfied: true,
    });
  });
});

describe("pickValueVerdict", () => {
  it("slip sign carries the verdict, and no rank means no verdict", () => {
    expect(pickValueVerdict(3, 10)).toBe("steal");
    expect(pickValueVerdict(10, 3)).toBe("reach");
    expect(pickValueVerdict(7, 7)).toBe("even");
    expect(pickValueVerdict(undefined, 7)).toBeNull();
  });
});
