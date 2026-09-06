import { describe, it, expect } from "vitest";
import type { RosterSlot, RosterSlotConfig } from "@/domain/roster";
import { rankWeight, openStartingSlots, needMultiplier, deferredLateRoundPosition } from "./scoring";

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

describe("needMultiplier's surplusDamp (the 2026-09-05 QB-stacking fix, corrected 2026-09-06)", () => {
  const opts = { openSlotBoost: 0.4, filledDamp: 0.6 };
  // One filled dedicated QB slot is enough to reach the surplus branch for every test below;
  // `rosteredAtPosition` (never the roster's own slot labels — see `extraSurplusBodies`'s
  // docblock, `scoring.ts`) is what actually drives the exponent from here on. This is
  // deliberately a PURE-FUNCTION CONTRACT over a caller-supplied count, not a simulation of a
  // real roster shape: the real join (a team's picks against the pool's own positions) is
  // `selectors.ts`'s `rosteredCountsByPosition`, proven end to end with real engine-built
  // rosters in `autopick.test.ts`'s "surplus damp" describe block.
  const oneFilledDedicated = [slot("QB", 0)];

  it("with surplusDamp ABSENT, is byte-identical to the pre-fix flat filledDamp — the replay-determinism law", () => {
    // Same numbers as the "cools to the damp" test above, pinned again here so a future edit to
    // this describe block can never quietly regress the absent-field contract. No `rosteredAtPosition`
    // either: absent stays absent, exactly like every historical snapshot (none carries this field).
    expect(needMultiplier("RB", [slot("RB", 0), slot("RB", 1)], SLOTS, opts)).toBe(0.6);
    expect(needMultiplier("QB", oneFilledDedicated, SLOTS, opts)).toBe(0.6);
  });

  it("compounds filledDamp by surplusDamp^1 for the 2nd body overall (the 1st surplus)", () => {
    expect(needMultiplier("QB", oneFilledDedicated, SLOTS, { ...opts, surplusDamp: 0.25, rosteredAtPosition: 1 }))
      .toBeCloseTo(0.6 * 0.25 ** 1, 12);
  });

  it("compounds by surplusDamp^2 for the 3rd body overall (the 2nd surplus)", () => {
    expect(needMultiplier("QB", oneFilledDedicated, SLOTS, { ...opts, surplusDamp: 0.25, rosteredAtPosition: 2 }))
      .toBeCloseTo(0.6 * 0.25 ** 2, 12);
  });

  it("compounds by surplusDamp^3 for the 4th body overall (the 3rd surplus) — it genuinely keeps escalating", () => {
    expect(needMultiplier("QB", oneFilledDedicated, SLOTS, { ...opts, surplusDamp: 0.25, rosteredAtPosition: 3 }))
      .toBeCloseTo(0.6 * 0.25 ** 3, 12);
  });

  it("each additional already-rostered body compounds by exactly one more factor of surplusDamp", () => {
    const at = (rosteredAtPosition: number) =>
      needMultiplier("QB", oneFilledDedicated, SLOTS, { ...opts, surplusDamp: 0.25, rosteredAtPosition });
    expect(at(2) / at(1)).toBeCloseTo(0.25, 12);
    expect(at(3) / at(2)).toBeCloseTo(0.25, 12);
  });

  it("falls back to the dedicated-slot-label count when rosteredAtPosition is omitted (defensive default; no real caller takes this path)", () => {
    expect(needMultiplier("QB", oneFilledDedicated, SLOTS, { ...opts, surplusDamp: 0.25 })).toBeCloseTo(0.6 * 0.25 ** 1, 12);
  });

  it("never engages while the position still has an open dedicated slot, whatever rosteredAtPosition claims", () => {
    expect(needMultiplier("RB", [], SLOTS, { ...opts, surplusDamp: 0.25, rosteredAtPosition: 5 })).toBeCloseTo(1.8, 12);
    expect(needMultiplier("RB", [slot("RB", 0)], SLOTS, { ...opts, surplusDamp: 0.25, rosteredAtPosition: 5 })).toBeCloseTo(1.4, 12);
  });

  it("is a no-op at surplusDamp: 1 (compounding by 1 changes nothing)", () => {
    expect(needMultiplier("QB", oneFilledDedicated, SLOTS, { ...opts, surplusDamp: 1, rosteredAtPosition: 3 })).toBe(0.6);
  });
});

/**
 * THE LATE-ROUND DEFERRAL (the 2026-09-05 kicker and team defence round). Nobody drafts a kicker in
 * round five, and a room that autopicked one for an absent manager would be visibly wrong to every
 * other seat. These fix the three ways the deferral lifts and the three ways it never engages.
 */
describe("deferredLateRoundPosition", () => {
  const FULL: readonly RosterSlotConfig[] = [
    { slot: "QB", count: 1, eligiblePositions: ["QB"] },
    { slot: "RB", count: 2, eligiblePositions: ["RB"] },
    { slot: "WR", count: 2, eligiblePositions: ["WR"] },
    { slot: "TE", count: 1, eligiblePositions: ["TE"] },
    { slot: "FLEX", count: 1, eligiblePositions: ["RB", "WR", "TE"] },
    { slot: "K", count: 1, eligiblePositions: ["K"] },
    { slot: "DEF", count: 1, eligiblePositions: ["DEF"] },
    { slot: "BENCH", count: 6, eligiblePositions: ["QB", "RB", "WR", "TE", "K", "DEF"] },
  ];

  /** `n` bodies on the bench and nothing else, so every dedicated starting slot reads open. */
  function benchOnly(n: number): readonly RosterSlot[] {
    return Array.from({ length: n }, (_, index) => ({ slot: "BENCH" as const, slotIndex: index, playerId: `p${index}` }));
  }

  /** Every skill starter filled, both late-round slots still open. */
  const SKILL_FILLED: readonly RosterSlot[] = [
    { slot: "QB", slotIndex: 0, playerId: "q" },
    { slot: "RB", slotIndex: 0, playerId: "r1" },
    { slot: "RB", slotIndex: 1, playerId: "r2" },
    { slot: "WR", slotIndex: 0, playerId: "w1" },
    { slot: "WR", slotIndex: 1, playerId: "w2" },
    { slot: "TE", slotIndex: 0, playerId: "t" },
    { slot: "FLEX", slotIndex: 0, playerId: "f" },
  ];

  it("is not deferred at all when the policy carries no rounds-from-the-end", () => {
    expect(deferredLateRoundPosition("K", benchOnly(0), FULL, undefined)).toBe(false);
    expect(deferredLateRoundPosition("DEF", benchOnly(3), FULL, undefined)).toBe(false);
  });

  it("defers both positions early, while another starting slot is still open", () => {
    expect(deferredLateRoundPosition("K", benchOnly(0), FULL, 2)).toBe(true);
    expect(deferredLateRoundPosition("DEF", benchOnly(5), FULL, 2)).toBe(true);
  });

  it("stops deferring once the team is inside the final rounds", () => {
    // 15 slots, 2 rounds from the end: a roster of 13 or more has 2 or fewer picks left.
    expect(deferredLateRoundPosition("K", benchOnly(12), FULL, 2)).toBe(true);
    expect(deferredLateRoundPosition("K", benchOnly(13), FULL, 2)).toBe(false);
    expect(deferredLateRoundPosition("DEF", benchOnly(14), FULL, 2)).toBe(false);
  });

  it("stops deferring the moment every other starting slot is filled, however early", () => {
    expect(deferredLateRoundPosition("K", SKILL_FILLED, FULL, 2)).toBe(false);
    expect(deferredLateRoundPosition("DEF", SKILL_FILLED, FULL, 2)).toBe(false);
  });

  it("counts a partly-filled starting slot as still open", () => {
    const oneReceiverShort = SKILL_FILLED.filter((s) => s.playerId !== "w2");
    expect(deferredLateRoundPosition("K", oneReceiverShort, FULL, 2)).toBe(true);
  });

  it("never defers a position that is not one of the two", () => {
    expect(deferredLateRoundPosition("RB", benchOnly(0), FULL, 2)).toBe(false);
    expect(deferredLateRoundPosition("QB", benchOnly(0), FULL, 2)).toBe(false);
    expect(deferredLateRoundPosition("WR", benchOnly(0), FULL, 2)).toBe(false);
  });

  it("never lets one late-round position defer the other on account of its own open slot", () => {
    // The exception reads "every OTHER starting slot", so K and DEF are excluded from the list
    // each of them checks. Otherwise the two would deadlock each other forever.
    expect(deferredLateRoundPosition("K", SKILL_FILLED, FULL, 2)).toBe(false);
    expect(deferredLateRoundPosition("DEF", SKILL_FILLED, FULL, 2)).toBe(false);
  });

  it("never defers when the league starts no kicker and no defence at all", () => {
    const noKdef = FULL.filter((s) => s.slot !== "K" && s.slot !== "DEF");
    expect(deferredLateRoundPosition("K", benchOnly(0), noKdef, 2)).toBe(false);
    expect(deferredLateRoundPosition("DEF", benchOnly(0), noKdef, 2)).toBe(false);
  });

  it("never defers under a zero-slot config, where nothing is ever legal anyway", () => {
    expect(deferredLateRoundPosition("K", [], [], 2)).toBe(false);
  });
});
