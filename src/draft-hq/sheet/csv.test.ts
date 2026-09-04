import { describe, expect, it } from "vitest";
import type { BoardOption } from "./view";
import type { SheetEntryView } from "./view";
import { parseSheetCsv, sheetToCsv } from "./csv";

const UNIVERSE: readonly BoardOption[] = [
  { playerId: "p1", name: "Top Guy", position: "RB", team: "SF", rank: 1 },
  { playerId: "p2", name: "Second Guy", position: "WR", team: "DAL", rank: 2 },
];

function entry(overrides: Partial<SheetEntryView> = {}): SheetEntryView {
  return {
    id: "e1",
    playerId: "p1",
    rank: 1,
    tierLabel: null,
    note: null,
    tag: null,
    name: "Top Guy",
    position: "RB",
    team: "SF",
    byeWeek: 9,
    boardRank: 1,
    ...overrides,
  };
}

describe("sheetToCsv", () => {
  it("writes the header and one row per entry", () => {
    const csv = sheetToCsv([entry(), entry({ playerId: "p2", name: "Second Guy", rank: 2, tag: "target", note: "a, note" })]);
    const lines = csv.split("\n");
    expect(lines[0]).toBe("name,rank,tier,note,tag");
    expect(lines[1]).toBe("Top Guy,1,,,");
    expect(lines[2]).toBe('Second Guy,2,,"a, note",target');
  });
});

describe("parseSheetCsv", () => {
  it("round-trips a sheet it just exported", () => {
    const csv = sheetToCsv([entry(), entry({ playerId: "p2", name: "Second Guy", rank: 2, tag: "target" })]);
    const { rows, unresolvedNames } = parseSheetCsv(csv, UNIVERSE);
    expect(unresolvedNames).toEqual([]);
    expect(rows.map((row) => row.playerId)).toEqual(["p1", "p2"]);
    expect(rows[1]?.tag).toBe("target");
  });

  it("reports a name it cannot match, rather than dropping it silently", () => {
    const csv = "name,rank\nTop Guy,1\nSomebody Unknown,2";
    const { rows, unresolvedNames } = parseSheetCsv(csv, UNIVERSE);
    expect(rows.map((row) => row.playerId)).toEqual(["p1"]);
    expect(unresolvedNames).toEqual(["Somebody Unknown"]);
  });

  it("matches names case-insensitively", () => {
    const csv = "name\nTOP GUY";
    const { rows } = parseSheetCsv(csv, UNIVERSE);
    expect(rows.map((row) => row.playerId)).toEqual(["p1"]);
  });

  it("orders by the rank column when every row has one, even out of file order", () => {
    const csv = "name,rank\nSecond Guy,2\nTop Guy,1";
    const { rows } = parseSheetCsv(csv, UNIVERSE);
    expect(rows.map((row) => row.playerId)).toEqual(["p1", "p2"]);
  });

  it("falls back to file order when rank is missing on any row", () => {
    const csv = "name,rank\nSecond Guy,\nTop Guy,1";
    const { rows } = parseSheetCsv(csv, UNIVERSE);
    expect(rows.map((row) => row.playerId)).toEqual(["p2", "p1"]);
  });

  it("tolerates columns in any order and a missing tier/note/tag", () => {
    const csv = "tag,name\ntarget,Top Guy";
    const { rows } = parseSheetCsv(csv, UNIVERSE);
    expect(rows).toEqual([{ playerId: "p1", tierLabel: null, note: null, tag: "target" }]);
  });

  it("returns nothing for a file with no name column", () => {
    const csv = "rank,tag\n1,target";
    expect(parseSheetCsv(csv, UNIVERSE)).toEqual({ rows: [], unresolvedNames: [] });
  });

  it("handles a quoted field containing a comma", () => {
    const csv = 'name,note\nTop Guy,"loves him, really"';
    const { rows } = parseSheetCsv(csv, UNIVERSE);
    expect(rows[0]?.note).toBe("loves him, really");
  });
});
