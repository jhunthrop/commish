import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
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

  it("the name is the peek button — the drawer's own law 3 posture", () => {
    const onPeek = renderTab();
    fireEvent.click(screen.getByRole("button", { name: "Jalen Croft" }));
    expect(onPeek).toHaveBeenCalledWith("qb1");
  });

  it("says so plainly for a caller with no team, instead of a dead surface", () => {
    renderTab(null);
    expect(screen.queryAllByTestId("roster-tab-row")).toHaveLength(0);
    expect(screen.getByText("You have no team in this room.")).toBeInTheDocument();
  });
});
