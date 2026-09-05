import { describe, it, expect } from "vitest";
import type { RosterSlot, RosterSlotConfig } from "@/domain/roster";
import { rankWeight, openStartingSlots, needMultiplier } from "./scoring";

const SLOTS: readonly RosterSlotConfig[] = [
  { slot: "QB", count: 1, eligiblePositions: ["QB"] },
  { slot: "RB", count: 2, eligiblePositions: ["RB"] },
  { slot: "FLEX", count: 1, eligiblePositions: ["RB", "WR", "TE"] },
  { slot: "BENCH", count: 2, eligiblePositions: ["QB", "RB", "WR", "TE", "K", "DEF"] },
];

function slot(s: RosterSlot["slot"], slotIndex: number): RosterSlot {
  return { slot: s, slotIndex, playerId: `p_${s}${slotIndex}` };
}

describe("rankWeight", () => {
  it("weighs rank 0 at exactly 1 and decays exponentially per step", () => {
    expect(rankWeight(0, 3)).toBe(1);
    expect(rankWeight(3, 3)).toBeCloseTo(Math.exp(-1), 12);
    expect(rankWeight(6, 3)).toBeCloseTo(Math.exp(-2), 12);
  });

  it("decays faster at a lower temperature", () => {
    expect(rankWeight(1, 1)).toBeLessThan(rankWeight(1, 3));
  });
});

describe("openStartingSlots", () => {
  it("counts only the dedicated slots for the position, FLEX and bench excluded", () => {
    expect(openStartingSlots("RB", [], SLOTS)).toBe(2);
    expect(openStartingSlots("RB", [slot("RB", 0)], SLOTS)).toBe(1);
    expect(openStartingSlots("RB", [slot("RB", 0), slot("RB", 1)], SLOTS)).toBe(0);
    // A third RB sitting in FLEX neither opens nor closes the dedicated count.
    expect(openStartingSlots("RB", [slot("RB", 0), slot("RB", 1), slot("FLEX", 0)], SLOTS)).toBe(0);
  });

  it("is zero for a position the league configures no dedicated slot for", () => {
    expect(openStartingSlots("K", [], SLOTS)).toBe(0);
  });
});

describe("needMultiplier", () => {
  const opts = { openSlotBoost: 0.4, filledDamp: 0.6 };

  it("warms a position by the boost per open dedicated starting slot", () => {
    expect(needMultiplier("RB", [], SLOTS, opts)).toBeCloseTo(1.8, 12);
    expect(needMultiplier("RB", [slot("RB", 0)], SLOTS, opts)).toBeCloseTo(1.4, 12);
  });

  it("cools to the damp once every dedicated starter is filled", () => {
    expect(needMultiplier("RB", [slot("RB", 0), slot("RB", 1)], SLOTS, opts)).toBe(0.6);
    expect(needMultiplier("QB", [slot("QB", 0)], SLOTS, opts)).toBe(0.6);
  });

  it("is exactly neutral everywhere when boost is 0 and damp is 1", () => {
    const neutral = { openSlotBoost: 0, filledDamp: 1 };
    expect(needMultiplier("RB", [], SLOTS, neutral)).toBe(1);
    expect(needMultiplier("QB", [slot("QB", 0)], SLOTS, neutral)).toBe(1);
  });
});

describe("needMultiplier's surplusDamp (the 2026-09-05 QB-stacking fix)", () => {
  const opts = { openSlotBoost: 0.4, filledDamp: 0.6 };

  it("with surplusDamp ABSENT, is byte-identical to the pre-fix flat filledDamp — the replay-determinism law", () => {
    // Same numbers as the "cools to the damp" test above, pinned again here so a future edit to
    // this describe block can never quietly regress the absent-field contract.
    expect(needMultiplier("RB", [slot("RB", 0), slot("RB", 1)], SLOTS, opts)).toBe(0.6);
    expect(needMultiplier("QB", [slot("QB", 0)], SLOTS, opts)).toBe(0.6);
  });

  it("compounds filledDamp by surplusDamp^1 for the first surplus body — the candidate counts itself", () => {
    // QB slots = 1, one QB already rostered: the candidate would be the SECOND, i.e. one over
    // capacity the instant it lands — extraBodies = 1, not 0.
    expect(needMultiplier("QB", [slot("QB", 0)], SLOTS, { ...opts, surplusDamp: 0.25 })).toBeCloseTo(0.6 * 0.25, 12);
  });

  it("compounds by surplusDamp^2 for a second surplus body already rostered", () => {
    // A roster with two RB-typed entries against a configured count of 2 (QB's own capacity,
    // reused here as the position under test): the exponent scales with how far over capacity
    // the position already sits, not a flat one-time penalty.
    const oneSlot = [{ slot: "QB", count: 1, eligiblePositions: ["QB"] }] as const;
    const twoRostered: readonly RosterSlot[] = [
      { slot: "QB", slotIndex: 0, playerId: "p_QB0" },
      { slot: "QB", slotIndex: 1, playerId: "p_QB1" },
    ];
    expect(needMultiplier("QB", twoRostered, oneSlot, { ...opts, surplusDamp: 0.25 })).toBeCloseTo(0.6 * 0.25 ** 2, 12);
  });

  it("never engages while the position still has an open dedicated slot", () => {
    expect(needMultiplier("RB", [], SLOTS, { ...opts, surplusDamp: 0.25 })).toBeCloseTo(1.8, 12);
    expect(needMultiplier("RB", [slot("RB", 0)], SLOTS, { ...opts, surplusDamp: 0.25 })).toBeCloseTo(1.4, 12);
  });

  it("is a no-op at surplusDamp: 1 (compounding by 1 changes nothing)", () => {
    expect(needMultiplier("QB", [slot("QB", 0)], SLOTS, { ...opts, surplusDamp: 1 })).toBe(0.6);
  });
});
