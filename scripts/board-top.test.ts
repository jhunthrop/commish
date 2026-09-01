import { describe, expect, it } from "vitest";
import { formatBoardTopRow, formatBoardTopTable, type BoardTopRow } from "./board-top";

function row(overrides: Partial<BoardTopRow> = {}): BoardTopRow {
  return {
    rank: 1,
    name: "Sample Player",
    position: "WR",
    team: "BUF",
    projectedPoints: 233.47,
    adpRank: 12.6,
    lawIds: [],
    ...overrides,
  };
}

describe("formatBoardTopRow", () => {
  it("prints rank, name, position, team, points and ADP rank", () => {
    const line = formatBoardTopRow(row());
    expect(line).toContain("Sample Player");
    expect(line).toContain("WR");
    expect(line).toContain("BUF");
    expect(line).toContain("233.5");
    expect(line).toContain("12.6");
  });

  it("prints n/a for a player with no market ADP row, never a fabricated rank", () => {
    const line = formatBoardTopRow(row({ adpRank: null }));
    expect(line).toContain("n/a");
  });

  it("prints every firing law id, comma-separated", () => {
    const line = formatBoardTopRow(row({ lawIds: ["target_share_persistence", "rb_age_curve"] }));
    expect(line).toContain("target_share_persistence, rb_age_curve");
  });

  it("prints nothing extra where no law chip fired", () => {
    const line = formatBoardTopRow(row({ lawIds: [] }));
    expect(line.trim().endsWith("adp 12.6") || !line.includes("law")).toBe(true);
  });

  it("right-pads the rank to a stable column width across single and multi-digit ranks", () => {
    const one = formatBoardTopRow(row({ rank: 1 }));
    const fifty = formatBoardTopRow(row({ rank: 50 }));
    expect(one.indexOf("Sample Player")).toBe(fifty.indexOf("Sample Player"));
  });

  it("never emits an em dash", () => {
    const line = formatBoardTopRow(row({ adpRank: null, lawIds: ["td_regression"] }));
    expect(line).not.toContain("—");
  });
});

describe("formatBoardTopTable", () => {
  it("prints a header row followed by one line per entry, in the order given", () => {
    const rows = [row({ rank: 1, name: "First Player" }), row({ rank: 2, name: "Second Player" })];
    const table = formatBoardTopTable(rows);
    const lines = table.split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain("First Player");
    expect(lines[2]).toContain("Second Player");
  });

  it("prints only the header for an empty board, never throwing", () => {
    const table = formatBoardTopTable([]);
    expect(table.split("\n")).toHaveLength(1);
  });

  it("never emits an em dash anywhere in the table", () => {
    const table = formatBoardTopTable([
      row({ adpRank: null }),
      row({ rank: 2, lawIds: ["wr_target_competition", "target_share_persistence"] }),
    ]);
    expect(table).not.toContain("—");
  });
});
