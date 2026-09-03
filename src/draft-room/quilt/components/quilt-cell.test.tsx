import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { PLAYERS, SNAKE_VIEW, TEAMS } from "../../test-fixtures";
import type { QuiltCell } from "../state/board";
import { QuiltBoard } from "./quilt-board";
import { QuiltCellView, shortName } from "./quilt-cell";

const playersById = new Map(PLAYERS.map((player) => [player.id, player]));
const qb1 = playersById.get("qb1")!;

const LANDED: QuiltCell = {
  teamId: "t1",
  pick: { pickNumber: 1, round: 1, teamId: "t1", playerId: "qb1", slot: "QB", slotIndex: 0, price: null, timestamp: "2026-09-01T00:00:00.000Z", auto: false },
  onClock: false,
  yourPickLabel: null,
};

function renderCell(withFace: boolean) {
  return render(
    <QuiltCellView
      cell={LANDED}
      player={qb1}
      teamCount={2}
      lens="picks"
      verdict={null}
      byeWeek={null}
      clockLabel={null}
      onPeek={() => {}}
      peeked={false}
      withFace={withFace}
    />,
  );
}

describe("QuiltCellView faces", () => {
  it("an active-round cell renders the player's face beside the condensed name", () => {
    renderCell(true);
    const cell = screen.getByTestId("quilt-pick-cell");
    expect(cell).toHaveTextContent(shortName(qb1.name));
    expect(cell.querySelector("[data-testid='player-face-team']")).not.toBeNull();
  });

  it("without the face flag the cell stays text-only — compacted geometry never carries one", () => {
    renderCell(false);
    expect(screen.getByTestId("quilt-pick-cell").querySelector("[data-testid='player-face-team']")).toBeNull();
  });
});

describe("QuiltBoard faces", () => {
  const view = { ...SNAKE_VIEW, picks: [LANDED.pick!], pickNumber: 2, onClockTeamId: "t2" };
  const props = {
    teams: TEAMS,
    playersById,
    myTeamId: "t2" as string | null,
    lens: "picks" as const,
    byeWeeks: new Map<string, number>(),
    boardRanks: new Map<string, number>(),
    clockLabel: null,
    onPeek: () => {},
    peekedPlayerId: null,
  };

  it("the active round's landed cells carry faces; the micro-only board never does", () => {
    const { unmount } = render(<QuiltBoard view={view} {...props} />);
    expect(screen.getByTestId("quilt-pick-cell").querySelector("[data-testid='player-face-team']")).not.toBeNull();
    unmount();
    render(<QuiltBoard view={view} {...props} microOnly />);
    expect(screen.queryByTestId("quilt-pick-cell")).toBeNull();
    expect(document.querySelector("[data-testid='player-face-team']")).toBeNull();
  });
});
