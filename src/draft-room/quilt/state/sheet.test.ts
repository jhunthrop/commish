import { describe, expect, it } from "vitest";
import { decodeSheet, encodeSheet, moveInSheet, reconcileSheet, seedSheet, setSheetNote, sheetQueueSeed, sheetRanks } from "./sheet";

const BOARD = ["a", "b", "c", "d"] as const;

describe("cheat sheet model", () => {
  it("seeds as the board itself", () => {
    expect(seedSheet(BOARD)).toEqual({ order: ["a", "b", "c", "d"], notes: {} });
  });

  it("moves a player without mutating the original", () => {
    const sheet = seedSheet(BOARD);
    const moved = moveInSheet(sheet, "c", -2);
    expect(moved.order).toEqual(["c", "a", "b", "d"]);
    expect(sheet.order).toEqual(["a", "b", "c", "d"]);
    // Clamped at the edges, and a no-op returns the same reference.
    expect(moveInSheet(moved, "c", -1)).toBe(moved);
    expect(moveInSheet(sheet, "d", 5).order).toEqual(["a", "b", "c", "d"]);
    expect(moveInSheet(sheet, "ghost", 1)).toBe(sheet);
  });

  it("keeps notes trimmed and drops emptied ones", () => {
    const noted = setSheetNote(seedSheet(BOARD), "b", "  take at 1.08  ");
    expect(noted.notes).toEqual({ b: "take at 1.08" });
    expect(setSheetNote(noted, "b", "   ").notes).toEqual({});
  });

  it("reconciles a stored sheet against today's board", () => {
    const stored = { order: ["d", "a", "ghost"], notes: { a: "keep", ghost: "drop" } };
    const merged = reconcileSheet(stored, BOARD);
    // Ghost drops with its note; unseen b and c enter at their board positions.
    expect(merged.order).toEqual(["d", "b", "c", "a"]);
    expect(merged.notes).toEqual({ a: "keep" });
  });

  it("seeds the queue from the top undrafted sheet players", () => {
    const sheet = { order: ["d", "a", "b", "c"], notes: {} };
    expect(sheetQueueSeed(sheet, new Set(["a", "c"]), 2)).toEqual(["a", "c"]);
  });

  it("ranks 1-based by sheet order", () => {
    expect(sheetRanks(seedSheet(BOARD)).get("c")).toBe(3);
  });

  it("round-trips through the codec and rejects every malformed shape", () => {
    const sheet = setSheetNote(seedSheet(BOARD), "a", "note");
    expect(decodeSheet(encodeSheet(sheet))).toEqual(sheet);
    for (const bad of [null, "not json", "42", '{"order":"nope","notes":{}}', '{"order":[1],"notes":{}}', '{"order":[],"notes":{"a":1}}', '{"order":[]}']) {
      expect(decodeSheet(bad)).toBeNull();
    }
  });
});
