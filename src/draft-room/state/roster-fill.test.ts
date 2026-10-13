import { describe, it, expect } from "vitest";
import type { RosterSlot, RosterSlotConfig } from "@research-ts/domain/roster";
import { rosterFillRows } from "./roster-fill";

const SLOT_CONFIG: readonly RosterSlotConfig[] = [
  { slot: "QB", count: 1, eligiblePositions: ["QB"] },
  { slot: "RB", count: 2, eligiblePositions: ["RB"] },
  { slot: "FLEX", count: 1, eligiblePositions: ["RB", "WR", "TE"] },
  { slot: "BENCH", count: 2, eligiblePositions: ["QB", "RB", "WR", "TE", "K", "DEF"] },
];

describe("rosterFillRows", () => {
  it("returns one row per configured spot, in slotConfig's own order", () => {
    const rows = rosterFillRows(SLOT_CONFIG, []);
    expect(rows.map((row) => `${row.slot}:${row.slotIndex}`)).toEqual([
      "QB:0",
      "RB:0",
      "RB:1",
      "FLEX:0",
      "BENCH:0",
      "BENCH:1",
    ]);
  });

  it("states an unfilled spot as playerId null rather than omitting it", () => {
    const rows = rosterFillRows(SLOT_CONFIG, []);
    expect(rows.every((row) => row.playerId === null)).toBe(true);
  });

  it("fills a spot from the roster's own already-assigned slot, exactly as the engine placed it — including a FLEX slot holding a non-FLEX-named position", () => {
    const roster: readonly RosterSlot[] = [
      { slot: "QB", slotIndex: 0, playerId: "qb1" },
      { slot: "RB", slotIndex: 0, playerId: "rb1" },
      { slot: "FLEX", slotIndex: 0, playerId: "wr1" },
    ];
    const rows = rosterFillRows(SLOT_CONFIG, roster);
    expect(rows.find((row) => row.slot === "QB" && row.slotIndex === 0)?.playerId).toBe("qb1");
    expect(rows.find((row) => row.slot === "RB" && row.slotIndex === 0)?.playerId).toBe("rb1");
    expect(rows.find((row) => row.slot === "RB" && row.slotIndex === 1)?.playerId).toBeNull();
    expect(rows.find((row) => row.slot === "FLEX" && row.slotIndex === 0)?.playerId).toBe("wr1");
  });

  it("never mutates slotConfig or roster", () => {
    const roster: readonly RosterSlot[] = [{ slot: "QB", slotIndex: 0, playerId: "qb1" }];
    const slotConfigCopy = [...SLOT_CONFIG];
    const rosterCopy = [...roster];
    rosterFillRows(SLOT_CONFIG, roster);
    expect(SLOT_CONFIG).toEqual(slotConfigCopy);
    expect(roster).toEqual(rosterCopy);
  });
});
