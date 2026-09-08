import { describe, expect, it } from "vitest";
import type { BoardRow } from "@/draft-hq/board/service";
import { EXPORT_HEADER, exportLines, parseExportArguments } from "./rankings-export";

function row(overrides: Partial<BoardRow>): BoardRow {
  return {
    playerId: "p1",
    nflPlayerId: "n1",
    name: "Test Player",
    position: "WR",
    team: "BUF",
    headshotUrl: null,
    rank: 1,
    overallRank: 1,
    marketOrderRank: null,
    lastSeason: null,
    projectedPoints: 220.5,
    floorPoints: 150,
    medianPoints: 218,
    ceilingPoints: 280,
    valueOverReplacement: 80,
    valueRank: 1,
    positionRankInValue: 1,
    tier: 0,
    playersLeftInTier: 3,
    dropToNextTier: 2.2,
    byeWeek: 10,
    marketAdp: 2.4,
    marketPositionAdp: "WR1",
    reasons: [],
    ...overrides,
  } as BoardRow;
}

function cellOf(header: string, line: string, column: string): string {
  const index = header.split(",").indexOf(column);
  if (index === -1) throw new Error(`The export has no "${column}" column.`);
  return line.split(",")[index] ?? "";
}

describe("parseExportArguments", () => {
  it("defaults to PPR and a file name that carries the format", () => {
    expect(parseExportArguments([])).toEqual({ format: "ppr", outfile: "commish-rankings-ppr.csv" });
  });

  it("reads --format and a positional out file", () => {
    expect(parseExportArguments(["--format=half", "my-board.csv"])).toEqual({ format: "half", outfile: "my-board.csv" });
    expect(parseExportArguments(["--format=std"])).toEqual({ format: "std", outfile: "commish-rankings-std.csv" });
  });

  it("refuses a format that is not one of the three", () => {
    expect(() => parseExportArguments(["--format=te_premium"])).toThrow(/not a board format/);
  });
});

describe("exportLines", () => {
  it("names the scoring on every row, in the Scoring column, matching the format exported", () => {
    const rows = [row({ playerId: "p1" }), row({ playerId: "p2", name: "Second Man", valueRank: 2, overallRank: 2 })];
    const lines = exportLines(rows, "half");
    expect(lines[0]).toBe(EXPORT_HEADER.join(","));
    expect(cellOf(lines[0]!, lines[1]!, "Scoring")).toBe("Half PPR");
    expect(cellOf(lines[0]!, lines[2]!, "Scoring")).toBe("Half PPR");
    expect(cellOf(lines[0]!, lines[1]!, "Proj Pts")).toBe("220.5");
    expect(exportLines(rows, "std").map((line) => cellOf(lines[0]!, line, "Scoring")).slice(1)).toEqual(["Standard", "Standard"]);
  });

  it("keeps projected rows in value order ahead of the ADP-ordered rows, numbering the file's own rank", () => {
    const rows = [
      row({ playerId: "k1", name: "A Kicker", position: "K", valueRank: null, marketOrderRank: 1, projectedPoints: null, tier: null }),
      row({ playerId: "p2", name: "Second Man", valueRank: 2 }),
      row({ playerId: "p1", valueRank: 1 }),
    ];
    const lines = exportLines(rows, "ppr");
    expect(lines.slice(1).map((line) => cellOf(lines[0]!, line, "Player"))).toEqual(["Test Player", "Second Man", "A Kicker"]);
    expect(lines.slice(1).map((line) => cellOf(lines[0]!, line, "Rank"))).toEqual(["1", "2", "3"]);
    expect(cellOf(lines[0]!, lines[3]!, "Proj Pts")).toBe("");
  });
});
