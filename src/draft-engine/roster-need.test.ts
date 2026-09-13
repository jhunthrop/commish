import { describe, expect, it } from "vitest";
import type { Position } from "@/domain/player";
import { BENCH_SLOT, STANDARD_ROSTER_SLOTS, type RosterSlot, type RosterSlotConfig } from "@/domain/roster";
import { anyStarterOpen, benchBodiesByPosition, isSingleStarterPosition, openStartingSlotsEligible, positionCeiling, type RosterCeilingPolicy } from "./roster-need";

const POLICY: RosterCeilingPolicy = { backupsAtSingleStarterPosition: 1 };
const POSITIONS: readonly Position[] = ["QB", "RB", "WR", "TE", "K", "DEF"];

const SUPERFLEX_SLOTS: readonly RosterSlotConfig[] = [
  ...STANDARD_ROSTER_SLOTS.filter((slot) => slot.slot !== BENCH_SLOT),
  { slot: "SUPERFLEX", count: 1, eligiblePositions: ["QB", "RB", "WR", "TE"] },
  { slot: BENCH_SLOT, count: 6, eligiblePositions: POSITIONS },
];

function withBench(bench: number): readonly RosterSlotConfig[] {
  return STANDARD_ROSTER_SLOTS.map((slot) => (slot.slot === BENCH_SLOT ? { ...slot, count: bench } : slot));
}

function spots(...entries: readonly (readonly [RosterSlot["slot"], number])[]): readonly RosterSlot[] {
  return entries.map(([slot, slotIndex], i) => ({ slot, slotIndex, playerId: `p${i}` }));
}

describe("positionCeiling: starters plus a bench allowance, from the league's own roster shape (founder ruling 2026-09-12)", () => {
  it("standard shape: at most two of a position the league starts one of, one of each late position", () => {
    expect(positionCeiling("QB", STANDARD_ROSTER_SLOTS, POLICY)).toBe(2);
    expect(positionCeiling("TE", STANDARD_ROSTER_SLOTS, POLICY)).toBe(2);
    expect(positionCeiling("K", STANDARD_ROSTER_SLOTS, POLICY)).toBe(1);
    expect(positionCeiling("DEF", STANDARD_ROSTER_SLOTS, POLICY)).toBe(1);
  });

  it("standard shape: the rest of the bench goes to the backs and receivers by starting demand, flex included", () => {
    // Six bench spots, one each to QB and TE, four left over RB 3 and WR 3: two each.
    expect(positionCeiling("RB", STANDARD_ROSTER_SLOTS, POLICY)).toBe(2 + 1 + 2);
    expect(positionCeiling("WR", STANDARD_ROSTER_SLOTS, POLICY)).toBe(2 + 1 + 2);
  });

  it("sixteen-round shape: a seven-man bench gives the backs and receivers a third body and the tight end still one", () => {
    expect(positionCeiling("RB", withBench(7), POLICY)).toBe(6);
    expect(positionCeiling("WR", withBench(7), POLICY)).toBe(6);
    expect(positionCeiling("TE", withBench(7), POLICY)).toBe(2);
    expect(positionCeiling("QB", withBench(7), POLICY)).toBe(2);
  });

  it("superflex shape: the quarterback is still a position the league starts one of, so two at most", () => {
    expect(positionCeiling("QB", SUPERFLEX_SLOTS, POLICY)).toBe(2);
    expect(positionCeiling("TE", SUPERFLEX_SLOTS, POLICY)).toBe(2);
    expect(positionCeiling("RB", SUPERFLEX_SLOTS, POLICY)).toBe(2 + 2 + 2);
    expect(positionCeiling("WR", SUPERFLEX_SLOTS, POLICY)).toBe(2 + 2 + 2);
  });

  it("flex-only shape: shares the remaining bench by shared-slot demand when no flex position has a dedicated starter", () => {
    const flexOnly: readonly RosterSlotConfig[] = [
      { slot: "QB", count: 1, eligiblePositions: ["QB"] },
      { slot: "FLEX", count: 3, eligiblePositions: ["RB", "WR", "TE"] },
      { slot: BENCH_SLOT, count: 6, eligiblePositions: ["QB", "RB", "WR", "TE"] },
    ];
    // Five bench spots after the quarterback's one, over three positions of demand 3 each: 1.67, rounded up.
    expect(positionCeiling("RB", flexOnly, POLICY)).toBe(0 + 3 + 2);
    expect(positionCeiling("TE", flexOnly, POLICY)).toBe(0 + 3 + 2);
    expect(positionCeiling("QB", flexOnly, POLICY)).toBe(2);
  });

  it("is zero for a position the league rosters nowhere", () => {
    const noKicker = STANDARD_ROSTER_SLOTS.filter((slot) => slot.slot !== "K").map((slot) => (slot.slot === BENCH_SLOT ? { ...slot, eligiblePositions: slot.eligiblePositions.filter((p) => p !== "K") } : slot));
    expect(positionCeiling("K", noKicker, POLICY)).toBe(0);
  });

  it("never strands a roster: the ceilings across positions always cover every slot", () => {
    for (const shape of [STANDARD_ROSTER_SLOTS, withBench(7), withBench(8), SUPERFLEX_SLOTS]) {
      const total = shape.reduce((sum, slot) => sum + slot.count, 0);
      const covered = POSITIONS.reduce((sum, position) => sum + positionCeiling(position, shape, POLICY), 0);
      expect(covered).toBeGreaterThanOrEqual(total);
    }
  });
});

describe("the roster reads the engine needs", () => {
  it("counts an open flex as a starting slot for every position it takes, and for none it does not", () => {
    const roster = spots(["QB", 0], ["RB", 0], ["RB", 1], ["WR", 0]);
    expect(openStartingSlotsEligible("RB", roster, STANDARD_ROSTER_SLOTS)).toBe(1);
    expect(openStartingSlotsEligible("WR", roster, STANDARD_ROSTER_SLOTS)).toBe(2);
    expect(openStartingSlotsEligible("TE", roster, STANDARD_ROSTER_SLOTS)).toBe(2);
    expect(openStartingSlotsEligible("QB", roster, STANDARD_ROSTER_SLOTS)).toBe(0);
  });

  it("names the quarterback and the tight end as the single-starter positions, never the late two", () => {
    expect(POSITIONS.filter((position) => isSingleStarterPosition(position, STANDARD_ROSTER_SLOTS))).toEqual(["QB", "TE"]);
    expect(isSingleStarterPosition("QB", SUPERFLEX_SLOTS)).toBe(true);
  });

  it("sees a starter open until every non-late starting slot, the flex included, is filled", () => {
    const starters = spots(["QB", 0], ["RB", 0], ["RB", 1], ["WR", 0], ["WR", 1], ["TE", 0]);
    expect(anyStarterOpen(starters, STANDARD_ROSTER_SLOTS)).toBe(true);
    expect(anyStarterOpen([...starters, ...spots(["FLEX", 0])], STANDARD_ROSTER_SLOTS)).toBe(false);
  });

  it("counts bench bodies by their true position, read off the pool", () => {
    const pool = [{ playerId: "p0", position: "QB" as const }, { playerId: "p1", position: "RB" as const }, { playerId: "p2", position: "RB" as const }];
    const roster = spots(["QB", 0], ["BENCH", 0], ["BENCH", 1]);
    const bench = benchBodiesByPosition(roster, pool);
    expect(bench.get("RB")).toBe(2);
    expect(bench.get("QB")).toBeUndefined();
    // A bench spot the pool cannot place (an empty spot, or an id the pool never carried) counts
    // nowhere rather than throwing: the read stays a count, never a legality claim.
    const stray: readonly RosterSlot[] = [...roster, { slot: "BENCH", slotIndex: 2, playerId: "ghost" }, { slot: "BENCH", slotIndex: 3, playerId: null }];
    expect(benchBodiesByPosition(stray, pool).get("RB")).toBe(2);
  });
});
