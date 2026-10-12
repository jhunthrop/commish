import { describe, expect, it } from "vitest";
import type { Player } from "@research-ts/domain/player";
import { QUILT_CONFIG } from "./config";
import { bandAt, buildSheetColumns, layoutColumn, nextOpenTierOffset, reuseSheetColumns, windowFor, type SheetColumnModel, type SheetColumnsInput } from "./sheet-columns";

const player = (id: string, position: Player["position"], name = id): Player => ({ id, name, position, nflTeam: "KC", headshotUrl: null, adp: null });

const PLAYERS = [
  player("rb1", "RB"),
  player("rb2", "RB"),
  player("rb3", "RB"),
  player("rb4", "RB"),
  player("wr1", "WR"),
  player("k1", "K"),
  player("k2", "K"),
  player("def1", "DEF"),
];
const playersById = new Map(PLAYERS.map((p) => [p.id, p]));

function input(over: Partial<SheetColumnsInput> = {}): SheetColumnsInput {
  return {
    order: PLAYERS.map((p) => p.id),
    playersById,
    available: new Set(["rb3", "rb4", "wr1", "k1", "k2", "def1"]),
    myPlayerIds: new Set(["rb2"]),
    queuedPlayerIds: new Set(["rb4"]),
    // rb1 was taken before the room opened (no standing); rb2 is yours and still remembered in tier 1.
    tiers: { rb2: { tier: 1, left: 0, size: 2 }, rb3: { tier: 2, left: 2, size: 2 }, rb4: { tier: 2, left: 2, size: 2 } },
    odds: { pickNumber: 30, runs: 100, survived: { rb3: 12, rb4: 88, wr1: 50 } },
    hideTaken: false,
    ...over,
  };
}

describe("buildSheetColumns", () => {
  it("builds seven columns, ranks within the full column, and counts what is left", () => {
    const columns = buildSheetColumns(input());
    expect(columns.map((c) => c.label)).toEqual(["Overall", "QB", "RB", "WR", "TE", "K", "D/ST"]);
    const rb = columns.find((c) => c.key === "RB")!;
    expect(rb.total).toBe(4);
    expect(rb.left).toBe(2);
    const rows = rb.bands.flatMap((band) => band.rows);
    expect(rows.map((row) => [row.rank, row.taken, row.mine, row.queued])).toEqual([
      [1, true, false, false],
      [2, true, true, false],
      [3, false, false, false],
      [4, false, false, true],
    ]);
    expect(rows[2]!.survived).toBe(12);
    expect(rows[0]!.survived).toBeUndefined();
  });

  it("bands a position by tier, giving a player taken before the room opened the tier below him", () => {
    const rb = buildSheetColumns(input()).find((c) => c.key === "RB")!;
    expect(rb.bands.map((band) => [band.tier, band.left, band.size])).toEqual([
      [1, 0, 2],
      [2, 2, 2],
    ]);
  });

  it("groups a position by tier even where the manager's order interleaves tiers, keeping his order inside a band", () => {
    // rb3 sits above rb2 in the order but in a later tier; the column bands tier 1 then tier 2 and
    // prints each man's own rank in the order, so the disagreement stays visible.
    const columns = buildSheetColumns(input({ order: ["rb1", "rb3", "rb2", "rb4"], available: new Set(["rb1", "rb2", "rb3", "rb4"]), tiers: { rb1: { tier: 1, left: 2, size: 2 }, rb2: { tier: 1, left: 2, size: 2 }, rb3: { tier: 2, left: 2, size: 2 }, rb4: { tier: 2, left: 2, size: 2 } } }));
    const rb = columns.find((c) => c.key === "RB")!;
    expect(rb.bands.map((band) => [band.tier, band.rows.map((row) => `${row.player.id}#${row.rank}`)])).toEqual([
      [1, ["rb1#1", "rb2#3"]],
      [2, ["rb3#2", "rb4#4"]],
    ]);
  });

  it("gives Overall, K and D/ST one unlabelled band each", () => {
    const columns = buildSheetColumns(input());
    for (const key of ["overall", "K", "DEF"] as const) {
      const column = columns.find((c) => c.key === key)!;
      expect(column.bands).toHaveLength(1);
      expect(column.bands[0]!.tier).toBeNull();
    }
  });

  it("hides taken rows without renumbering, and drops a band that empties", () => {
    const rb = buildSheetColumns(input({ hideTaken: true })).find((c) => c.key === "RB")!;
    expect(rb.bands.map((band) => band.tier)).toEqual([2]);
    expect(rb.bands[0]!.rows.map((row) => row.rank)).toEqual([3, 4]);
    expect(rb.total).toBe(4);
  });

  it("caps a column at the configured size", () => {
    const many = Array.from({ length: 60 }, (_, i) => player(`wr${i}`, "WR"));
    const columns = buildSheetColumns(input({ order: many.map((p) => p.id), playersById: new Map(many.map((p) => [p.id, p])), available: new Set(many.map((p) => p.id)), tiers: {} }));
    expect(columns.find((c) => c.key === "WR")!.total).toBe(QUILT_CONFIG.sheet.columnSize);
  });
});

describe("reuseSheetColumns (one row per pick)", () => {
  it("keeps every untouched row, band and column object when one player is taken", () => {
    const before = buildSheetColumns(input());
    const after = buildSheetColumns(input({ available: new Set(["rb4", "wr1", "k1", "k2", "def1"]) }));
    const reused = reuseSheetColumns(before, after);
    const rowsOf = (columns: readonly SheetColumnModel[], key: string) => columns.find((c) => c.key === key)!.bands.flatMap((band) => band.rows);
    // rb3 was taken: his row is new, the three others in RB keep their objects.
    const rbBefore = rowsOf(before, "RB");
    const rbAfter = rowsOf(reused, "RB");
    expect(rbAfter[2]).not.toBe(rbBefore[2]);
    expect(rbAfter[0]).toBe(rbBefore[0]);
    expect(rbAfter[3]).toBe(rbBefore[3]);
    // Columns he is not in keep their whole object; the ones he is in are new.
    expect(reused.find((c) => c.key === "K")).toBe(before.find((c) => c.key === "K"));
    expect(reused.find((c) => c.key === "WR")).toBe(before.find((c) => c.key === "WR"));
    expect(reused.find((c) => c.key === "RB")).not.toBe(before.find((c) => c.key === "RB"));
    expect(reused.find((c) => c.key === "overall")).not.toBe(before.find((c) => c.key === "overall"));
  });

  it("hands back the previous array itself when nothing changed", () => {
    const before = buildSheetColumns(input());
    expect(reuseSheetColumns(before, buildSheetColumns(input()))).toBe(before);
  });
});

describe("the column window", () => {
  const rb = buildSheetColumns(input()).find((c) => c.key === "RB")!;
  const layout = layoutColumn(rb);
  const { bandPx, rowPx } = QUILT_CONFIG.sheet;

  it("lays bands and rows out at their heights", () => {
    expect(layout.items.map((item) => item.kind)).toEqual(["band", "row", "row", "band", "row", "row"]);
    expect(layout.offsets).toEqual([0, bandPx, bandPx + rowPx, bandPx + 2 * rowPx, 2 * bandPx + 2 * rowPx, 2 * bandPx + 3 * rowPx]);
    expect(layout.height).toBe(2 * bandPx + 4 * rowPx);
  });

  it("windows the visible items with overscan and names the band the scroll is inside", () => {
    expect(windowFor(layout, 0, rowPx)).toEqual({ start: 0, end: Math.min(layout.items.length, 2 + QUILT_CONFIG.sheet.overscanRows) });
    expect(bandAt(layout, 0)!.tier).toBe(1);
    expect(bandAt(layout, bandPx + 2 * rowPx)!.tier).toBe(2);
  });

  it("finds the next open tier below the scroll, or none", () => {
    expect(nextOpenTierOffset(layout, 0)).toBe(bandPx + 2 * rowPx);
    expect(nextOpenTierOffset(layout, bandPx + 2 * rowPx)).toBeNull();
  });
});
