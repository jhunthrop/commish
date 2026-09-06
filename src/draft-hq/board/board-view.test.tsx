import { describe, expect, it } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { BoardRow } from "./service";
import { BoardView } from "./board-view";

const SHAPE = { teamCount: 12, rosterSpots: 15, budget: 200 } as const;

function projected(overrides: Partial<BoardRow>): BoardRow {
  return {
    playerId: "p1",
    nflPlayerId: "n1",
    name: "A Receiver",
    position: "WR",
    team: "BUF",
    headshotUrl: null,
    rank: 1,
    overallRank: 1,
    marketOrderRank: null,
    projectedPoints: 280.5,
    floorPoints: 210.1,
    medianPoints: 280,
    ceilingPoints: 340.4,
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

/** A row for a position the engine published nothing for: the market's own order and nothing else. */
function marketOrder(overrides: Partial<BoardRow>): BoardRow {
  return projected({
    playerId: "k1",
    nflPlayerId: "k1",
    name: "A Kicker",
    position: "K",
    team: "DAL",
    rank: null,
    overallRank: null,
    marketOrderRank: 1,
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
    marketAdp: 130.1,
    marketPositionAdp: "K1",
    ...overrides,
  });
}

function mount(rows: readonly BoardRow[]) {
  return render(<BoardView rows={rows} laws={[]} auctionShape={SHAPE} exportFilename="board.csv" />);
}

function selectPosition(label: string): void {
  act(() => {
    fireEvent.click(within(screen.getByRole("group", { name: "Position" })).getByRole("button", { name: label }));
  });
}

/**
 * THE MARKET-ORDER TAB (the 2026-09-05 kicker and team defence round). Both positions failed their
 * preregistered gates on 2025, so the board carries real players in the market's own order with no
 * projection behind them. Without the note and the honest blanks that reads as a broken table.
 */
describe("BoardView, a position with no projection", () => {
  it("says why the position has no projection, once, above the table", () => {
    mount([projected({}), marketOrder({})]);
    expect(screen.queryByTestId("board-market-order-note")).not.toBeInTheDocument();

    selectPosition("K");
    const note = screen.getByTestId("board-market-order-note");
    expect(note.textContent).toContain("Kickers");
    expect(note.textContent).toContain("usually drafted");
    expect(note.textContent).not.toMatch(/[—–;]/);
  });

  it("shows no note on a position that does carry a projection", () => {
    mount([projected({}), marketOrder({})]);
    selectPosition("WR");
    expect(screen.queryByTestId("board-market-order-note")).not.toBeInTheDocument();
  });

  it("renders the row rather than an empty-table message, which would be untrue", () => {
    mount([projected({}), marketOrder({})]);
    selectPosition("K");
    expect(screen.queryByText("No players match this filter.")).not.toBeInTheDocument();
    expect(screen.getByText("A Kicker")).toBeInTheDocument();
  });

  it("leaves the projected, range and vs-market cells honestly blank, and never zero", () => {
    mount([projected({}), marketOrder({})]);
    selectPosition("K");
    const cells = screen.getByText("A Kicker").closest("tr")!;
    expect(within(cells).getByText("No projection for this position")).toBeInTheDocument();
    expect(within(cells).getByText("No range for this position")).toBeInTheDocument();
    // The ordering must not be compared against itself.
    expect(within(cells).getByText("No comparison against the market yet")).toBeInTheDocument();
    expect(cells.textContent).not.toMatch(/\b0\.0\b/);
  });

  it("leads with the market place and shows no overall rank, since it is not on the value board", () => {
    mount([projected({}), marketOrder({ marketOrderRank: 4 })]);
    selectPosition("K");
    const cells = screen.getByText("A Kicker").closest("tr")!;
    expect(within(cells).getByText("4")).toBeInTheDocument();
    expect(cells.textContent).not.toContain("overall");
  });

  it("still shows the market ADP, which is the one number the row does carry", () => {
    mount([projected({}), marketOrder({})]);
    selectPosition("K");
    const cells = screen.getByText("A Kicker").closest("tr")!;
    expect(within(cells).getByText("130.1")).toBeInTheDocument();
  });

  it("leaves every projected row exactly as it was", () => {
    mount([projected({}), marketOrder({})]);
    selectPosition("WR");
    const cells = screen.getByText("A Receiver").closest("tr")!;
    expect(within(cells).getByText("280.5")).toBeInTheDocument();
    expect(within(cells).queryByText("No projection for this position")).not.toBeInTheDocument();
  });
});
