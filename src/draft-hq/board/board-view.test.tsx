import { describe, expect, it } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { BOARD_LAST_SEASON, type BoardRow } from "./service";
import { boardCsvLines, BoardView } from "./board-view";

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
    lastSeason: null,
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
    rosterStatus: null,
    ...overrides,
  } as BoardRow;
}

/** A row the roster-status gate took off the board: no projection, no rank, a dated status. */
function notOnActiveRoster(overrides: Partial<BoardRow>): BoardRow {
  return projected({
    playerId: "ps1",
    nflPlayerId: "ps1",
    name: "Squad Back",
    position: "RB",
    team: "NO",
    rank: null,
    overallRank: null,
    marketOrderRank: null,
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
    marketAdp: 240.5,
    marketPositionAdp: "RB80",
    rosterStatus: { status: "practice_squad", source: "nflverse_roster_week_1", observedAt: "2026-09-01T00:00:00.000Z", team: "NO", excluded: true },
    ...overrides,
  });
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
  return render(<BoardView rows={rows} laws={[]} auctionShape={SHAPE} exportFilename="board.csv" scoringLabel="PPR" />);
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
    expect(note.textContent).toContain("ranked by ADP");
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

  it("leaves the last-season cells honestly blank for a row with nothing measured, and never zero", () => {
    mount([projected({}), marketOrder({})]);
    selectPosition("K");
    const cells = screen.getByText("A Kicker").closest("tr")!;
    expect(within(cells).getByText(`No ${BOARD_LAST_SEASON} season on record for him`)).toBeInTheDocument();
    expect(within(cells).getByText(`No rate to state without a ${BOARD_LAST_SEASON} season`)).toBeInTheDocument();
    // The ordering must not be compared against itself.
    expect(within(cells).getByText("No comparison against ADP yet")).toBeInTheDocument();
    expect(cells.textContent).not.toMatch(/\b0\.0\b/);
  });

  /**
   * THE COLUMNS THAT CHANGE MEANING ON THIS TAB (the 2026-09-06 round). The engine projects
   * nothing here and that is unchanged. What it can state is what each of these players measurably
   * scored last season under this league's own rules, and the two columns say so in their headers
   * rather than leaving a reader to infer it from the numbers.
   */
  it("names the two columns LAST SEASON and PER GAME on a market-order tab", () => {
    mount([projected({}), marketOrder({})]);
    selectPosition("K");
    expect(screen.getByRole("columnheader", { name: "Last season" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Per game" })).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Projected" })).not.toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Most seasons" })).not.toBeInTheDocument();
  });

  it("shows the season total with its games, the per-game rate, and names the basis for a screen reader", () => {
    mount([projected({}), marketOrder({ lastSeason: { season: 2025, points: 148.5, games: 17, pointsPerGame: 8.7 } })]);
    selectPosition("K");
    const cells = screen.getByText("A Kicker").closest("tr")!;
    expect(within(cells).getByText("148.5 pts")).toBeInTheDocument();
    expect(within(cells).getByText("17 games")).toBeInTheDocument();
    expect(within(cells).getByText("8.7")).toBeInTheDocument();
    expect(within(cells).getByLabelText("148.5 points over 17 games in 2025, last season, under this league's scoring.")).toBeInTheDocument();
    expect(within(cells).getByLabelText("8.7 points a game in 2025, last season, under this league's scoring.")).toBeInTheDocument();
  });

  it("leaves the Overall tab exactly as it was, headers and cells alike", () => {
    mount([projected({}), marketOrder({ lastSeason: { season: 2025, points: 148.5, games: 17, pointsPerGame: 8.7 } })]);
    expect(screen.getByRole("columnheader", { name: "Projected" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Most seasons" })).toBeInTheDocument();
    const cells = screen.getByText("A Kicker").closest("tr")!;
    expect(within(cells).getByText("No projection for this position")).toBeInTheDocument();
    expect(within(cells).getByText("No range for this position")).toBeInTheDocument();
    expect(cells.textContent).not.toContain("148.5");
  });

  it("leads with the market place and shows no overall rank, since it is not on the value board", () => {
    mount([projected({}), marketOrder({ marketOrderRank: 4 })]);
    selectPosition("K");
    const cells = screen.getByText("A Kicker").closest("tr")!;
    expect(within(cells).getByText("4")).toBeInTheDocument();
    expect(cells.textContent).not.toContain("overall");
  });

  it("still shows the ADP, which is the one number the row does carry", () => {
    mount([projected({}), marketOrder({})]);
    selectPosition("K");
    const cells = screen.getByText("A Kicker").closest("tr")!;
    expect(within(cells).getByText("130.1")).toBeInTheDocument();
  });

  /**
   * THE DRAWER USED TO SAY SOMETHING FALSE (founder, 2026-09-06). "No laws fired for this player.
   * His number comes from the base model alone." on a row that has no number and no base model
   * behind it is wrong twice, and reads as a broken screen rather than as a measurement that came
   * back negative.
   */
  it("gives a market-order row the market-order sentence and its measured season, never the base-model line", () => {
    mount([projected({}), marketOrder({ lastSeason: { season: 2025, points: 148.5, games: 17, pointsPerGame: 8.7 } })]);
    selectPosition("K");
    act(() => {
      fireEvent.click(within(screen.getByText("A Kicker").closest("tr")!).getByRole("button", { name: "why" }));
    });
    const drawer = screen.getByRole("dialog");
    expect(within(drawer).getByText(/ranked by ADP/)).toBeInTheDocument();
    expect(within(drawer).getByText(/In 2025 he scored 148.5 points over 17 games, 8.7 a game, under this league's scoring./)).toBeInTheDocument();
    expect(within(drawer).queryByText(/base model alone/)).not.toBeInTheDocument();
  });

  it("says plainly that it holds no season for a market-order row with nothing measured", () => {
    mount([projected({}), marketOrder({})]);
    selectPosition("K");
    act(() => {
      fireEvent.click(within(screen.getByText("A Kicker").closest("tr")!).getByRole("button", { name: "why" }));
    });
    const drawer = screen.getByRole("dialog");
    expect(within(drawer).getByText(`He has no ${BOARD_LAST_SEASON} season on record, so there is nothing here to measure.`)).toBeInTheDocument();
    expect(within(drawer).queryByText(/base model alone/)).not.toBeInTheDocument();
  });

  it("still gives a projected row with no reasons the base-model sentence, unchanged", () => {
    mount([projected({}), marketOrder({})]);
    act(() => {
      fireEvent.click(within(screen.getByText("A Receiver").closest("tr")!).getByRole("button", { name: "why" }));
    });
    expect(within(screen.getByRole("dialog")).getByText(/base model alone/)).toBeInTheDocument();
  });

  it("leaves every projected row exactly as it was", () => {
    mount([projected({}), marketOrder({})]);
    selectPosition("WR");
    const cells = screen.getByText("A Receiver").closest("tr")!;
    expect(within(cells).getByText("280.5")).toBeInTheDocument();
    expect(within(cells).queryByText("No projection for this position")).not.toBeInTheDocument();
  });
});

describe("the roster status on the board (the roster-status gate, 2026-09-08)", () => {
  const IR = { status: "injured_reserve" as const, source: "tank01_player_list" as const, observedAt: "2026-09-05T22:35:00.000Z", team: "BUF", excluded: false };

  it("prints a status pill beside a ranked player's name, with the dated observation for a screen reader", () => {
    mount([projected({ rosterStatus: IR })]);
    const row = screen.getByText("A Receiver").closest("tr")!;
    expect(within(row).getByText("IR")).toBeInTheDocument();
    expect(within(row).getByText("On injured reserve, observed Sep 5 on the player list")).toBeInTheDocument();
  });

  it("keeps the players the gate took off the board under their own band at the end, out of the ranking and out of the CSV", () => {
    mount([notOnActiveRoster({}), projected({}), marketOrder({})]);
    const rows = screen.getAllByRole("row");
    const names = rows.map((row) => row.textContent ?? "");
    const bandAt = names.findIndex((text) => text.includes("Not on an active roster"));
    const squadAt = names.findIndex((text) => text.includes("Squad Back"));
    const receiverAt = names.findIndex((text) => text.includes("A Receiver"));
    const kickerAt = names.findIndex((text) => text.includes("A Kicker"));
    expect(receiverAt).toBeLessThan(kickerAt);
    expect(kickerAt).toBeLessThan(bandAt);
    expect(bandAt).toBeLessThan(squadAt);
    expect(screen.getByTestId("board-not-on-roster-band")).toHaveTextContent("These players carry no projection while they are off an active roster.");
    expect(within(rows[squadAt]!).getByText("Practice squad")).toBeInTheDocument();
    expect(within(rows[squadAt]!).getByText("No projection for this position")).toBeInTheDocument();

    const csv = boardCsvLines([notOnActiveRoster({}), projected({})], SHAPE, "PPR");
    expect(csv).toHaveLength(2);
    expect(csv[1]).toContain("A Receiver");
  });
});
