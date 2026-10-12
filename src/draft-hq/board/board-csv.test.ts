import { describe, it, expect } from "vitest";
import type { BoardRow } from "@research/board/service";
import { boardCsvLines } from "./board-view";

// Re-review round 2's regression, pinned: the exported file's auction column is computed from
// the rows at export time, never threaded from the page's `$ board` view toggle — so there is
// structurally no toggle state that can blank a downloaded column. This test feeds rows
// straight to the export builder (the only path the button calls) and asserts real dollars.

const SHAPE = { teamCount: 12, rosterSpots: 15, budget: 200 } as const;

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
    projectedPoints: 20.5,
    floorPoints: 12.1,
    medianPoints: 19,
    ceilingPoints: 26.4,
    valueOverReplacement: 80,
    valueRank: 1,
    positionRankInValue: 1,
    tier: 1,
    playersLeftInTier: 3,
    dropToNextTier: 2.2,
    byeWeek: 10,
    marketAdp: 2.4,
    reasons: [],
    ...overrides,
  } as BoardRow;
}

/** One cell of a line, found by the header's own name rather than by a counted position. */
function cellOf(header: string, line: string, column: string): string {
  const index = header.split(",").indexOf(column);
  if (index === -1) throw new Error(`The export has no "${column}" column.`);
  return line.split(",")[index] ?? "";
}

function auctionCell(header: string, line: string): string {
  return cellOf(header, line, "Auction value");
}

describe("boardCsvLines", () => {
  it("names the scoring every projected number is under, in its own column, on every row (the scoring-formats round)", () => {
    const lines = boardCsvLines([row({ playerId: "p1" }), row({ playerId: "p2", name: "Second Man" })], SHAPE, "Half PPR");
    expect(cellOf(lines[0]!, lines[1]!, "Scoring")).toBe("Half PPR");
    expect(cellOf(lines[0]!, lines[2]!, "Scoring")).toBe("Half PPR");
  });

  it("always carries a real auction value for a priced row, with no view state in sight", () => {
    const rows = [row({ playerId: "p1", valueOverReplacement: 80 }), row({ playerId: "p2", name: "Second Man", rank: 2, valueOverReplacement: 40 })];
    const lines = boardCsvLines(rows, SHAPE, "PPR");
    expect(lines[0]).toContain("Auction value");
    // Both priced rows carry a dollar figure in the auction column — the exact amounts are
    // auctionValues' own tested business; here we pin only that the column is populated. Read by
    // COLUMN and not by "last cell in the line": the last-season columns now sit after it, and a
    // positional assumption is how a passing test stops meaning what it says.
    expect(auctionCell(lines[0]!, lines[1]!)).toMatch(/^\$\d+$/);
    expect(auctionCell(lines[0]!, lines[2]!)).toMatch(/^\$\d+$/);
  });

  it("prices a row with no value in this format at the documented one-dollar floor", () => {
    // `auctionValues`' own contract (value.ts): every player prices at the $1 floor, never $0 —
    // an auction seat costs a dollar even for a player the format never starts.
    const lines = boardCsvLines([row({ valueOverReplacement: null })], SHAPE, "PPR");
    expect(auctionCell(lines[0]!, lines[1]!)).toBe("$1");
  });

  /**
   * THE MEASURED SEASON IS ITS OWN FOUR COLUMNS (the 2026-09-06 kicker and team defense round),
   * never folded into "Projected pts": a season that happened and a season that is forecast are
   * different claims, and a file read away from the board is exactly where that difference is lost.
   */
  it("writes the last-season columns for a market-order row, and blanks for every other row", () => {
    const lines = boardCsvLines(
      [
        row({ playerId: "p1" }),
        row({ playerId: "k1", name: "A Kicker", position: "K", marketOrderRank: 1, lastSeason: { season: 2025, points: 148.5, games: 17, pointsPerGame: 8.7 } }),
      ],
      SHAPE,
      "PPR",
    );
    expect(cellOf(lines[0]!, lines[1]!, "Last season")).toBe("");
    expect(cellOf(lines[0]!, lines[1]!, "Last season pts")).toBe("");
    expect(cellOf(lines[0]!, lines[2]!, "Last season")).toBe("2025");
    expect(cellOf(lines[0]!, lines[2]!, "Last season pts")).toBe("148.5");
    expect(cellOf(lines[0]!, lines[2]!, "Last season games")).toBe("17");
    expect(cellOf(lines[0]!, lines[2]!, "Last season per game")).toBe("8.7");
  });

  it("emits the header exactly once", () => {
    const lines = boardCsvLines([row({})], SHAPE, "PPR");
    expect(lines.filter((line) => line.startsWith("Rank,")).length).toBe(1);
  });

  /**
   * A MARKET-ORDER ROW CARRIES ITS ABSENCE INTO THE FILE (the 2026-09-05 kicker and team defence
   * round). A downloaded CSV is read away from every explanation the board surface carries, so a
   * fabricated `0.0` in it is the version that survives and gets believed.
   */
  it("writes empty cells, never zeros, for a row the engine published no projection for", () => {
    const marketOrder = row({
      playerId: "k1",
      name: "A Kicker",
      position: "K",
      rank: null,
      overallRank: null,
      projectedPoints: null,
      floorPoints: null,
      medianPoints: null,
      ceilingPoints: null,
      valueOverReplacement: null,
      valueRank: null,
      positionRankInValue: null,
      tier: null,
      playersLeftInTier: null,
      dropToNextTier: null,
      marketOrderRank: 1,
      marketAdp: 130.1,
    });
    const [header, line] = boardCsvLines([marketOrder], SHAPE, "PPR");
    // Read by COLUMN NAME, never by counted position: the Scoring column (the scoring-formats
    // round) sits between Bye and Projected pts, and a positional assumption is how a passing
    // test stops meaning what it says.
    expect(cellOf(header!, line!, "Rank")).toBe(""); // no overall rank: it is not on the value board
    expect(cellOf(header!, line!, "Projected pts")).toBe("");
    // THE ON-SCREEN RANKING KEY RIDES THE FILE (fix round 2): a market-order row has no value over
    // replacement, and the cell is blank rather than a fabricated zero.
    expect(cellOf(header!, line!, "Points over replacement")).toBe("");
    expect(cellOf(header!, line!, "Floor")).toBe("");
    expect(cellOf(header!, line!, "Ceiling")).toBe("");
    expect(cellOf(header!, line!, "ADP")).toBe("130.1"); // the one number it does carry
    expect(cellOf(header!, line!, "Vs ADP (picks)")).toBe(""); // the ordering must not be compared with itself
    expect(cellOf(header!, line!, "Scoring")).toBe("PPR"); // the basis rides on every row, projection or not
    expect(line).not.toMatch(/(^|,)0\.0(,|$)/);
  });
  /**
   * THE COLUMN THE SCREEN NOW RANKS BY (fix round 2). Points over replacement became the board
   * row's one number, and a file read away from the screen is exactly where a reader would
   * otherwise be unable to reproduce the order the rows were in. It sits BESIDE the projection and
   * never instead of it: they are different claims and both belong in the export.
   */
  it("carries points over replacement beside the projection, with one decimal", () => {
    const [header, line] = boardCsvLines([row({ valueOverReplacement: 80, projectedPoints: 280.5 })], SHAPE, "PPR");
    expect(header!.split(",")).toContain("Points over replacement");
    expect(cellOf(header!, line!, "Points over replacement")).toBe("80.0");
    expect(cellOf(header!, line!, "Projected pts")).toBe("280.5");
  });
});
