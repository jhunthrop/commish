import { describe, it, expect } from "vitest";
import type { BoardRow } from "./service";
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

describe("boardCsvLines", () => {
  it("always carries a real auction value for a priced row, with no view state in sight", () => {
    const rows = [row({ playerId: "p1", valueOverReplacement: 80 }), row({ playerId: "p2", name: "Second Man", rank: 2, valueOverReplacement: 40 })];
    const lines = boardCsvLines(rows, SHAPE);
    expect(lines[0]).toContain("Auction value");
    // Both priced rows end in a dollar figure — the exact amounts are auctionValues' own
    // tested business; here we pin only that the column is populated.
    expect(lines[1]).toMatch(/\$\d+$/);
    expect(lines[2]).toMatch(/\$\d+$/);
  });

  it("prices a row with no value in this format at the documented one-dollar floor", () => {
    // `auctionValues`' own contract (value.ts): every player prices at the $1 floor, never $0 —
    // an auction seat costs a dollar even for a player the format never starts.
    const lines = boardCsvLines([row({ valueOverReplacement: null })], SHAPE);
    expect(lines[1]).toMatch(/\$1$/);
  });

  it("emits the header exactly once", () => {
    const lines = boardCsvLines([row({})], SHAPE);
    expect(lines.filter((line) => line.startsWith("Rank,")).length).toBe(1);
  });
});
