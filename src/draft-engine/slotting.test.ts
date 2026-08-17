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
});
