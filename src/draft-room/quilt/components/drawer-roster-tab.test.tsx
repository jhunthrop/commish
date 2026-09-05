import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { axe } from "vitest-axe";
import type { DraftStateView } from "@/draft-engine";
import { PLAYERS, SNAKE_VIEW } from "../../test-fixtures";
import { DrawerRosterTab } from "./drawer-roster-tab";

const playersById = new Map(PLAYERS.map((player) => [player.id, player]));

/** t1 drafted qb1 at 1.01; QB filled, both RB spots open (the fixture's 3-slot config). */
const VIEW: DraftStateView = {
  ...SNAKE_VIEW,
  picks: [
    {
      pickNumber: 1,
      round: 1,
      teamId: "t1",
      playerId: "qb1",
      slot: "QB",
      slotIndex: 0,
      price: null,
      timestamp: "2026-09-01T00:00:00.000Z",
      auto: false,
    },
  ],
  rosters: { t1: [{ slot: "QB", slotIndex: 0, playerId: "qb1" }], t2: [] },
};

function renderTab(myTeamId: string | null = "t1") {
  const onPeek = vi.fn<(playerId: string) => void>();
  render(<DrawerRosterTab view={VIEW} myTeamId={myTeamId} playersById={playersById} onPeek={onPeek} />);
  return onPeek;
}

describe("DrawerRosterTab", () => {
  it("renders one row per configured spot: the landed pick with its facts, the open spots dashed", () => {
    renderTab();
    const rows = screen.getAllByTestId("roster-tab-row");
    expect(rows).toHaveLength(3);
    // The filled QB spot: slot chip AND position badge both say QB, plus name and pick place.
    const filledRow = rows[0]!;
    expect(within(filledRow).getAllByText("QB").length).toBeGreaterThanOrEqual(2);
    expect(within(filledRow).getByText("Jalen Croft")).toBeInTheDocument();
    expect(within(filledRow).getByText("1.01")).toBeInTheDocument();
    // The open RB spots carry the slot chip and the dashed promise, nothing else.
    for (const openRow of rows.slice(1)) {
      expect(within(openRow).getByText("RB")).toBeInTheDocument();
      expect(openRow.className).toContain("border-dashed");
    }
  });

  // Player-name adoption sweep (task 3): the name itself now goes through `PlayerName` (the
  // product's one pressable-name primitive, opening the season peek) rather than this room's
  // own `onPeek` — a sibling "Card" button carries that draft-context card instead, so the two
  // controls sit beside each other rather than one name doing double duty.
  it("makes the name pressable through PlayerName, and keeps the room's own draft card one tap away on a sibling button", () => {
    const onPeek = renderTab();
    expect(screen.getByRole("button", { name: "Jalen Croft" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Jalen Croft's draft card" }));
    expect(onPeek).toHaveBeenCalledWith("qb1");
  });

  it("says so plainly for a caller with no team, instead of a dead surface", () => {
    renderTab(null);
    expect(screen.queryAllByTestId("roster-tab-row")).toHaveLength(0);
    expect(screen.getByText("You have no team in this room.")).toBeInTheDocument();
  });

  it("is axe-clean with the name, the card button and the position badge all present — no nested-interactive controls", async () => {
    const { container } = render(<DrawerRosterTab view={VIEW} myTeamId="t1" playersById={playersById} onPeek={vi.fn()} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
