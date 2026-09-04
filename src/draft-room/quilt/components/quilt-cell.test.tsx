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

function renderCell(withFace: boolean, rowHeight = 96, cell: QuiltCell = LANDED) {
  return render(
    <QuiltCellView
      cell={cell}
      player={cell.pick === null ? null : qb1}
      teamCount={2}
      lens="picks"
      verdict={null}
      byeWeek={null}
      clockLabel={null}
      onPeek={() => {}}
      peeked={false}
      withFace={withFace}
      rowHeight={rowHeight}
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

describe("QuiltCellView height degradation (the one-height-per-row law)", () => {
  const YOURS: QuiltCell = { teamId: "t2", pick: null, onClock: false, yourPickLabel: "2.01" };

  it("a squeezed window cell drops the face (under 34) and then the fact line (under 30), name last", () => {
    const { unmount } = renderCell(true, 32);
    const withCaption = screen.getByTestId("quilt-pick-cell");
    expect(withCaption.querySelector("[data-testid='player-face-team']")).toBeNull();
    expect(withCaption).toHaveTextContent(`${qb1.position} · ${qb1.nflTeam}`);
    unmount();
    renderCell(true, 28);
    const cell = screen.getByTestId("quilt-pick-cell");
    expect(cell).toHaveTextContent(shortName(qb1.name));
    expect(cell).not.toHaveTextContent(`${qb1.position} · ${qb1.nflTeam}`);
  });

  it("a dashed YOURS cell keeps both lines only with room, and its border alone when squeezed", () => {
    const { unmount } = renderCell(false, 96, YOURS);
    expect(screen.getByTestId("quilt-your-cell")).toHaveTextContent("2.01");
    expect(screen.getByTestId("quilt-your-cell")).toHaveTextContent("YOURS");
    unmount();
    renderCell(false, 12, YOURS);
    const squeezed = screen.getByTestId("quilt-your-cell");
    expect(squeezed.textContent).toBe("");
    expect(squeezed.className).toContain("border-dashed");
    expect(squeezed.className).toContain("h-full");
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
