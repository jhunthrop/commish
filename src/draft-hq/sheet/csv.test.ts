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
    expect(parseSheetCsv(csv, UNIVERSE)).toEqual({ rows: [], unresolvedNames: [], duplicateNames: [] });
  });

  it("handles a quoted field containing a comma", () => {
    const csv = 'name,note\nTop Guy,"loves him, really"';
    const { rows } = parseSheetCsv(csv, UNIVERSE);
    expect(rows[0]?.note).toBe("loves him, really");
  });

  describe("fix round 1, HIGH 2 — duplicate playerId dedupe", () => {
    it("keeps the first occurrence of a repeated player and reports the rest, never writing both", () => {
      const csv = "name,tag\nTop Guy,target\nSecond Guy,\nTop Guy,avoid";
      const { rows, duplicateNames } = parseSheetCsv(csv, UNIVERSE);
      expect(rows.map((row) => row.playerId)).toEqual(["p1", "p2"]);
      expect(rows[0]).toEqual({ playerId: "p1", tierLabel: null, note: null, tag: "target" });
      expect(duplicateNames).toEqual(["Top Guy"]);
    });

    it("dedupes by resolved playerId, not by the exact spelling of the name", () => {
      const csv = "name\nTop Guy\nTOP GUY";
      const { rows, duplicateNames } = parseSheetCsv(csv, UNIVERSE);
      expect(rows.map((row) => row.playerId)).toEqual(["p1"]);
      expect(duplicateNames).toEqual(["TOP GUY"]);
    });

    it("never produces two rows for the same player even when nothing else is wrong with the file", () => {
      const csv = "name\nTop Guy\nSecond Guy\nTop Guy\nSecond Guy";
      const { rows } = parseSheetCsv(csv, UNIVERSE);
      const playerIds = rows.map((row) => row.playerId);
      expect(new Set(playerIds).size).toBe(playerIds.length);
    });
  });

  describe("fix round 1, MEDIUM 2 — CSV formula injection", () => {
    it("neutralizes a formula-triggering note on export with a guard apostrophe inside the quoted field", () => {
      const csv = sheetToCsv([entry({ note: "=HYPERLINK(\"https://evil.example\")" })]);
      expect(csv.split("\n")[1]).toBe('Top Guy,1,,"\'=HYPERLINK(""https://evil.example"")",');
    });

    it("neutralizes +, -, @, tab and carriage-return leads too", () => {
      for (const dangerous of ["+1", "-1", "@mention", "\tstart", "\rstart"]) {
        const csv = sheetToCsv([entry({ tierLabel: dangerous })]);
        const field = csv.split("\n")[1]!.split(",")[2]!;
        expect(field.startsWith("'")).toBe(true);
      }
    });

    it("leaves an ordinary note untouched", () => {
      const csv = sheetToCsv([entry({ note: "love this pick" })]);
      expect(csv.split("\n")[1]).toBe("Top Guy,1,,love this pick,");
    });

    it("strips the guard back off on import — the round trip is lossless", () => {
      const dangerousNote = '=HYPERLINK("https://evil.example")';
      const csv = sheetToCsv([entry({ note: dangerousNote })]);
      const { rows } = parseSheetCsv(csv, UNIVERSE);
      expect(rows[0]?.note).toBe(dangerousNote);
    });

    it("round-trips a tier label that starts with a dangerous character losslessly", () => {
      const csv = sheetToCsv([entry({ tierLabel: "-1 value tier" })]);
      const { rows } = parseSheetCsv(csv, UNIVERSE);
      expect(rows[0]?.tierLabel).toBe("-1 value tier");
    });
  });
});
