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

/** One row of the board, found by the name on it. `board-row` is the row's own test contract — the
 *  Sideline round turned the table into a list of `PlayerRow`s, so there is no `<tr>` to climb to
 *  and DOM adjacency would be a worse hook than it already was. */
function rowFor(name: string): HTMLElement {
  return screen.getByText(name).closest('[data-testid="board-row"]') as HTMLElement;
}

/**
 * THE MARKET-ORDER TAB (the 2026-09-05 kicker and team defence round). Both positions failed their
 * preregistered gates on 2025, so the board carries real players in the market's own order with no
 * projection behind them. Without the note and the honest blanks that reads as a broken board.
 */
describe("BoardView, a position with no projection", () => {
  it("says why the position has no projection, once, above the board", () => {
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

  it("renders the row rather than an empty-board message, which would be untrue", () => {
    mount([projected({}), marketOrder({})]);
    selectPosition("K");
    expect(screen.queryByText("No players match this filter.")).not.toBeInTheDocument();
    expect(screen.getByText("A Kicker")).toBeInTheDocument();
  });

  it("leaves the one number honestly absent for a row with nothing measured, and never zero", () => {
    mount([projected({}), marketOrder({})]);
    selectPosition("K");
    const row = rowFor("A Kicker");
    // A dash, never a zero, and the caption says WHY there is no number (P2, P11).
    expect(within(row).getByTestId("big-number").querySelector('[data-absent="true"]')).not.toBeNull();
    expect(within(row).getByText(`No ${BOARD_LAST_SEASON} season`)).toBeInTheDocument();
    // The ordering must not be compared against itself, so no vs-ADP verdict is drawn at all.
    expect(row.textContent).not.toContain("drafters");
    expect(row.textContent).not.toContain("even with ADP");
    expect(row.textContent).not.toMatch(/\b0\.0\b/);
  });

  /**
   * THE ONE NUMBER CHANGES MEANING ON THIS TAB (the 2026-09-06 round, restated on Sideline's row).
   * The engine projects nothing here and that is unchanged. What it CAN state is what each of these
   * players measurably scored last season under this league's own rules, and the figure's own basis
   * caption says so — a measured season and a projected one are different claims and never share a
   * caption.
   */
  it("names last season as the basis of the figure, never a projection, on a market-order tab", () => {
    mount([projected({}), marketOrder({ lastSeason: { season: 2025, points: 148.5, games: 17, pointsPerGame: 8.7 } })]);
    selectPosition("K");
    const row = rowFor("A Kicker");
    expect(within(row).getByText("Scored, 2025")).toBeInTheDocument();
    expect(within(row).queryByText(/^Projected/)).not.toBeInTheDocument();
  });

  it("shows the season total as the one number, with its games in the basis and its rate on the facts line", () => {
    mount([projected({}), marketOrder({ lastSeason: { season: 2025, points: 148.5, games: 17, pointsPerGame: 8.7 } })]);
    selectPosition("K");
    const row = rowFor("A Kicker");
    expect(within(row).getByText("148.5")).toBeInTheDocument();
    expect(within(row).getByText("Scored, 2025")).toBeInTheDocument();
    // The caption is one line at this width, so the denominator a season total needs beside it
    // rides the facts line rather than being dropped.
    expect(row.textContent).toContain("17 games, 8.7 a game last season");
  });

  it("leaves the Overall tab honest: no projection for him there, and last season is not borrowed to fill it", () => {
    mount([projected({}), marketOrder({ lastSeason: { season: 2025, points: 148.5, games: 17, pointsPerGame: 8.7 } })]);
    const row = rowFor("A Kicker");
    expect(within(row).getByText("No projection")).toBeInTheDocument();
    expect(row.textContent).not.toContain("148.5");
  });

  it("leads with the market place and shows no overall rank, since it is not on the value board", () => {
    mount([projected({}), marketOrder({ marketOrderRank: 4 })]);
    selectPosition("K");
    const row = rowFor("A Kicker");
    expect(within(row).getByText("4")).toBeInTheDocument();
    expect(row.textContent).not.toContain("overall");
  });

  it("still shows the ADP, which is the one number the row does carry", () => {
    mount([projected({}), marketOrder({})]);
    selectPosition("K");
    expect(rowFor("A Kicker").textContent).toContain("ADP 130.1");
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
      fireEvent.click(within(rowFor("A Kicker")).getByRole("button", { name: "why" }));
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
      fireEvent.click(within(rowFor("A Kicker")).getByRole("button", { name: "why" }));
    });
    const drawer = screen.getByRole("dialog");
    expect(within(drawer).getByText(`He has no ${BOARD_LAST_SEASON} season on record, so there is nothing here to measure.`)).toBeInTheDocument();
    expect(within(drawer).queryByText(/base model alone/)).not.toBeInTheDocument();
  });

  it("still gives a projected row with no reasons the base-model sentence, unchanged", () => {
    mount([projected({}), marketOrder({})]);
    act(() => {
      fireEvent.click(within(rowFor("A Receiver")).getByRole("button", { name: "why" }));
    });
    expect(within(screen.getByRole("dialog")).getByText(/base model alone/)).toBeInTheDocument();
  });

  /**
   * HIS RANGE MOVED INTO THE DRAWER (Sideline research round): P2 gives a row one number larger than
   * body text, so the "most seasons" band is one press away rather than a second figure beside the
   * first. It is not lost, and it still leads with the p25-p75 band and states the tails behind it.
   */
  it("states the most-seasons band and its tails in the drawer for a projected row", () => {
    mount([projected({})]);
    act(() => {
      fireEvent.click(within(rowFor("A Receiver")).getByRole("button", { name: "why" }));
    });
    const drawer = screen.getByRole("dialog");
    expect(within(drawer).getByText(/Most seasons land between \d+ and \d+ points\./)).toBeInTheDocument();
    expect(within(drawer).getByText(/injury seasons and smash seasons included, runs 210 to 340\./)).toBeInTheDocument();
  });

  it("leaves every projected row with its projection and its stated basis", () => {
    mount([projected({}), marketOrder({})]);
    selectPosition("WR");
    const row = rowFor("A Receiver");
    expect(within(row).getByText("280.5")).toBeInTheDocument();
    expect(within(row).getByText("Projected, PPR")).toBeInTheDocument();
    expect(within(row).queryByText("No projection")).not.toBeInTheDocument();
  });

  /** TIERS ARE ONE-BASED (the founder-approved draft-room sheet mock: "Tier 1", "Tier 2"). The
   *  engine's ladder is an array index; nobody counts tiers from zero out loud. */
  it("opens a tier band at one, not at zero and not at a letter", () => {
    mount([projected({})]);
    selectPosition("WR");
    const plate = screen.getByText("3 WR left before a 2.2 point drop").closest("[data-grade]") as HTMLElement;
    // The pigment ladder is still the design token (grade S for the summit); the LETTER printed on
    // it is the fact, and the fact a manager counts is the tier's own one-based number.
    expect(plate.dataset.grade).toBe("S");
    expect(within(plate).getByText("1")).toBeInTheDocument();
    expect(within(plate).queryByText("S")).not.toBeInTheDocument();
  });
});

describe("the roster status on the board (the roster-status gate, 2026-09-08)", () => {
  const IR = { status: "injured_reserve" as const, source: "tank01_player_list" as const, observedAt: "2026-09-05T22:35:00.000Z", team: "BUF", excluded: false };

  it("prints a status pill beside a ranked player's name, with the dated observation for a screen reader", () => {
    mount([projected({ rosterStatus: IR })]);
    const row = rowFor("A Receiver");
    expect(within(row).getByText("IR")).toBeInTheDocument();
    expect(within(row).getByText("On injured reserve, observed Sep 5 on the player list")).toBeInTheDocument();
  });

  it("keeps the players the gate took off the board under their own band at the end, out of the ranking and out of the CSV", () => {
    mount([notOnActiveRoster({}), projected({}), marketOrder({})]);
    const names = screen.getAllByTestId("board-row").map((row) => row.textContent ?? "");
    const squadAt = names.findIndex((text) => text.includes("Squad Back"));
    const receiverAt = names.findIndex((text) => text.includes("A Receiver"));
    const kickerAt = names.findIndex((text) => text.includes("A Kicker"));
    expect(receiverAt).toBeLessThan(kickerAt);
    expect(kickerAt).toBeLessThan(squadAt);
    // The band is its own object with its own ground, and it opens immediately above the first row
    // it covers rather than being a row in the list.
    const band = screen.getByTestId("board-not-on-roster-band");
    expect(band).toHaveTextContent("These players carry no projection while they are off an active roster.");
    expect(band.compareDocumentPosition(screen.getAllByTestId("board-row")[squadAt]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const squadRow = screen.getAllByTestId("board-row")[squadAt]!;
    expect(within(squadRow).getByText("Practice squad")).toBeInTheDocument();
    expect(within(squadRow).getByText("Off a roster")).toBeInTheDocument();

    const csv = boardCsvLines([notOnActiveRoster({}), projected({})], SHAPE, "PPR");
    expect(csv).toHaveLength(2);
    expect(csv[1]).toContain("A Receiver");
  });
});
