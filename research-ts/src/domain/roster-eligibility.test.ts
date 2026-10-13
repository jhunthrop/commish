import { describe, it, expect } from "vitest";
import {
  eligibleSlotsForPosition,
  validateRosterAdd,
  validateLineup,
  restrictedPositions,
} from "./roster-eligibility";
import type { RosterSlot, RosterSlotConfig, RosterSlotType } from "./roster";

const STANDARD_SLOTS: readonly RosterSlotConfig[] = [
  { slot: "QB", count: 1, eligiblePositions: ["QB"] },
  { slot: "RB", count: 2, eligiblePositions: ["RB"] },
  { slot: "WR", count: 2, eligiblePositions: ["WR"] },
  { slot: "TE", count: 1, eligiblePositions: ["TE"] },
  { slot: "FLEX", count: 1, eligiblePositions: ["RB", "WR", "TE"] },
  { slot: "K", count: 1, eligiblePositions: ["K"] },
  { slot: "DEF", count: 1, eligiblePositions: ["DEF"] },
  { slot: "BENCH", count: 6, eligiblePositions: ["QB", "RB", "WR", "TE", "K", "DEF"] },
];

describe("eligibleSlotsForPosition", () => {
  it("returns every slot type that accepts a given position, including FLEX and BENCH", () => {
    const slots = eligibleSlotsForPosition("RB", STANDARD_SLOTS);
    expect(slots).toEqual(["RB", "FLEX", "BENCH"]);
  });

  it("returns only QB and BENCH for a quarterback (no FLEX eligibility)", () => {
    const slots = eligibleSlotsForPosition("QB", STANDARD_SLOTS);
    expect(slots).toEqual(["QB", "BENCH"]);
  });

  it("returns an empty list for a position with no matching slot config", () => {
    const slots = eligibleSlotsForPosition(
      "K",
      STANDARD_SLOTS.filter((s) => s.slot !== "K" && s.slot !== "BENCH"),
    );
    expect(slots).toEqual([]);
  });
});

describe("validateRosterAdd", () => {
  it("accepts adding a player to a slot the roster has room for", () => {
    const result = validateRosterAdd({
      slotConfig: STANDARD_SLOTS,
      currentRoster: [],
      position: "RB",
      targetSlot: "RB",
    });
    expect(result).toEqual({ valid: true });
  });

  it("rejects adding a player to a slot type that is already full", () => {
    const currentRoster = [
      { slot: "RB" as const, slotIndex: 0, playerId: "p1" },
      { slot: "RB" as const, slotIndex: 1, playerId: "p2" },
    ];
    const result = validateRosterAdd({
      slotConfig: STANDARD_SLOTS,
      currentRoster,
      position: "RB",
      targetSlot: "RB",
    });
    expect(result).toEqual({
      valid: false,
      reason: "The RB slot is full (2/2 filled).",
    });
  });

  it("rejects a position that is not eligible for the target slot", () => {
    const result = validateRosterAdd({
      slotConfig: STANDARD_SLOTS,
      currentRoster: [],
      position: "QB",
      targetSlot: "RB",
    });
    expect(result).toEqual({
      valid: false,
      reason: "QB is not eligible for the RB slot.",
    });
  });

  it("accepts an RB into the FLEX slot", () => {
    const result = validateRosterAdd({
      slotConfig: STANDARD_SLOTS,
      currentRoster: [],
      position: "RB",
      targetSlot: "FLEX",
    });
    expect(result).toEqual({ valid: true });
  });
});

describe("validateLineup", () => {
  it("accepts a fully and correctly filled lineup", () => {
    const roster = [
      { slot: "QB" as const, slotIndex: 0, playerId: "qb1" },
      { slot: "RB" as const, slotIndex: 0, playerId: "rb1" },
      { slot: "RB" as const, slotIndex: 1, playerId: "rb2" },
      { slot: "WR" as const, slotIndex: 0, playerId: "wr1" },
      { slot: "WR" as const, slotIndex: 1, playerId: "wr2" },
      { slot: "TE" as const, slotIndex: 0, playerId: "te1" },
      { slot: "FLEX" as const, slotIndex: 0, playerId: "rb3" },
      { slot: "K" as const, slotIndex: 0, playerId: "k1" },
      { slot: "DEF" as const, slotIndex: 0, playerId: "def1" },
    ];
    const playerPositions: Readonly<Record<string, string>> = {
      qb1: "QB",
      rb1: "RB",
      rb2: "RB",
      wr1: "WR",
      wr2: "WR",
      te1: "TE",
      rb3: "RB",
      k1: "K",
      def1: "DEF",
    };
    const result = validateLineup({
      slotConfig: STANDARD_SLOTS.filter((s) => s.slot !== "BENCH"),
      roster,
      playerPositions,
    });
    expect(result).toEqual({ valid: true });
  });

  it("rejects a lineup with a player placed in a slot their position isn't eligible for", () => {
    const roster = [{ slot: "QB" as const, slotIndex: 0, playerId: "rb1" }];
    const playerPositions: Readonly<Record<string, string>> = { rb1: "RB" };
    const result = validateLineup({
      slotConfig: [{ slot: "QB", count: 1, eligiblePositions: ["QB"] }],
      roster,
      playerPositions,
    });
    expect(result).toEqual({
      valid: false,
      reason: "RB is not eligible for the QB slot.",
    });
  });

  it("rejects a lineup with an empty required starting slot", () => {
    const result = validateLineup({
      slotConfig: [{ slot: "QB", count: 1, eligiblePositions: ["QB"] }],
      roster: [{ slot: "QB" as const, slotIndex: 0, playerId: null }],
      playerPositions: {},
    });
    expect(result).toEqual({
      valid: false,
      reason: "The QB slot is empty.",
    });
  });
});

describe("restrictedPositions", () => {
  const filled = (spots: readonly (readonly [RosterSlotType, number])[]): readonly RosterSlot[] =>
    spots.map(([slot, slotIndex], i) => ({ slot, slotIndex, playerId: `p${i}` }));
  const everyStarter: readonly (readonly [RosterSlotType, number])[] = [["QB", 0], ["RB", 0], ["RB", 1], ["WR", 0], ["WR", 1], ["TE", 0], ["FLEX", 0]];
  const fullBench: readonly (readonly [RosterSlotType, number])[] = [["BENCH", 0], ["BENCH", 1], ["BENCH", 2], ["BENCH", 3], ["BENCH", 4], ["BENCH", 5]];

  it("is null while a bench spot is open, because any position still fits", () => {
    expect(restrictedPositions(STANDARD_SLOTS, filled([...everyStarter, ["K", 0], ["DEF", 0], ...fullBench.slice(1)]))).toBeNull();
  });

  it("names the open starting slots' positions, in slot order, once the bench is full", () => {
    expect(restrictedPositions(STANDARD_SLOTS, filled([...everyStarter, ...fullBench]))).toEqual(["K", "DEF"]);
    expect(restrictedPositions(STANDARD_SLOTS, filled([...everyStarter.filter(([slot]) => slot !== "TE"), ["K", 0], ...fullBench]))).toEqual(["TE", "DEF"]);
  });

  it("lists a flex spot's positions once each, never a repeat", () => {
    const noFlex = everyStarter.filter(([slot]) => slot !== "FLEX");
    expect(restrictedPositions(STANDARD_SLOTS, filled([...noFlex, ["K", 0], ["DEF", 0], ...fullBench]))).toEqual(["RB", "WR", "TE"]);
  });

  it("is null while every position the league rosters still fits, bench or no bench", () => {
    const benchless: readonly RosterSlotConfig[] = STANDARD_SLOTS.filter((config) => config.slot !== "BENCH");
    expect(restrictedPositions(benchless, [])).toBeNull();
    expect(restrictedPositions(benchless, filled([["QB", 0]]))).toEqual(["RB", "WR", "TE", "K", "DEF"]);
  });

  it("is empty for a full roster: nothing is owed and nothing fits", () => {
    expect(restrictedPositions(STANDARD_SLOTS, filled([...everyStarter, ["K", 0], ["DEF", 0], ...fullBench]))).toEqual([]);
  });
});
