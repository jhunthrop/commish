import { describe, it, expect } from "vitest";
import type { RosterSlot, RosterSlotConfig } from "@/domain/roster";
import { STANDARD_ROSTER_SLOTS } from "@/domain/roster";
import { assignSlot } from "./slotting";

const filled = (slot: RosterSlot["slot"], slotIndex: number, playerId: string): RosterSlot => ({ slot, slotIndex, playerId });

describe("assignSlot", () => {
  it("puts a player in the first eligible slot in config order", () => {
    expect(assignSlot({ position: "RB", roster: [], slotConfig: STANDARD_ROSTER_SLOTS })).toEqual({ ok: true, slot: "RB", slotIndex: 0 });
  });

  it("fills the second copy of a multi-count slot", () => {
    const roster = [filled("RB", 0, "p1")];
    expect(assignSlot({ position: "RB", roster, slotConfig: STANDARD_ROSTER_SLOTS })).toEqual({ ok: true, slot: "RB", slotIndex: 1 });
  });

  it("overflows to FLEX once the dedicated slots are full", () => {
    const roster = [filled("RB", 0, "p1"), filled("RB", 1, "p2")];
    expect(assignSlot({ position: "RB", roster, slotConfig: STANDARD_ROSTER_SLOTS })).toEqual({ ok: true, slot: "FLEX", slotIndex: 0 });
  });

  it("overflows to BENCH once FLEX is full too", () => {
    const roster = [filled("RB", 0, "p1"), filled("RB", 1, "p2"), filled("FLEX", 0, "p3")];
    expect(assignSlot({ position: "RB", roster, slotConfig: STANDARD_ROSTER_SLOTS })).toEqual({ ok: true, slot: "BENCH", slotIndex: 0 });
  });

  it("rejects with a plain-language reason when every eligible slot is full", () => {
    const roster = [filled("QB", 0, "p1"), ...Array.from({ length: 6 }, (_, i) => filled("BENCH", i, `b${i}`))];
    const result = assignSlot({ position: "QB", roster, slotConfig: STANDARD_ROSTER_SLOTS });
    expect(result).toEqual({ ok: false, reason: "Your roster has no open slot for a QB." });
  });

  it("rejects when the league has no slot that accepts the position at all", () => {
    const noKicker: readonly RosterSlotConfig[] = STANDARD_ROSTER_SLOTS.filter((s) => s.slot !== "K" && s.slot !== "BENCH");
    const result = assignSlot({ position: "K", roster: [], slotConfig: noKicker });
    expect(result).toEqual({ ok: false, reason: "No roster slot in this league accepts a K." });
  });

  /**
   * THE GAP-INDEX REGRESSION (found by `reverseTradeInTx`'s own lock-order proof, Task 7). A
   * roster that has traded away the LOWER-indexed occupant of a multi-count slot and kept the
   * HIGHER-indexed one is not the same shape a fresh draft ever produces (a draft only ever
   * fills indices in order, low to high), but it IS exactly the shape `plannedTransfer`'s own
   * "clear by playerId, not by index" step leaves behind. The old
   * `roster.filter((s) => s.slot === slot).length` computation answered `1` here — the COUNT of
   * remaining `RB` entries — which collides with the entry already sitting at index `1`, and
   * `defaultLineup`'s own `"${slot}:${slotIndex}"`-keyed `Map` (`@/league/lineup`) then keeps only
   * the LAST of the two, silently dropping a player the roster never actually lost. The fix reads
   * the LOWEST FREE index instead of the occupied count.
   */
  it("fills the lower, now-open index rather than colliding with a higher-indexed survivor", () => {
    const roster = [filled("RB", 1, "p_survivor")]; // index 0 traded away, index 1 remains
    expect(assignSlot({ position: "RB", roster, slotConfig: STANDARD_ROSTER_SLOTS })).toEqual({ ok: true, slot: "RB", slotIndex: 0 });
  });

  it("still finds the next TRUE gap when more than one index is already free", () => {
    // RB and FLEX both full, so this overflows to BENCH; BENCH's only occupant sits at index 2,
    // leaving indices 0 and 1 both open — the lowest of the two, not the occupant count (1).
    const roster = [filled("RB", 0, "p1"), filled("RB", 1, "p2"), filled("FLEX", 0, "p3"), filled("BENCH", 2, "p_survivor")];
    expect(assignSlot({ position: "RB", roster, slotConfig: STANDARD_ROSTER_SLOTS })).toEqual({ ok: true, slot: "BENCH", slotIndex: 0 });
  });
});
