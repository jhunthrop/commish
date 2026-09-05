import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import type { Player } from "@/domain/player";
import { LeagueRoomDepsProvider } from "@/league-room/hooks/deps";
import { PlayerPeekHost } from "@/league-room/components/player-peek";
import { PLAYERS, playersById } from "../../test-fixtures";
import { seedSheet } from "../state/sheet";
import { DrawerSheetTab } from "./drawer-sheet-tab";

const PLAYER: Player = { id: "p1", name: "Test Player", position: "RB", nflTeam: "SF", headshotUrl: null, adp: null };
const PLAYERS_BY_ID = new Map([[PLAYER.id, PLAYER]]);

function baseProps() {
  return {
    leagueId: "l1",
    sheet: seedSheet(["p1"]),
    playersById: PLAYERS_BY_ID,
    boardRanks: new Map([["p1", 1]]),
    available: new Set(["p1"]),
    onMove: vi.fn(),
    onSeedQueue: vi.fn(),
    onReset: vi.fn(),
    canDraft: false,
    submitting: false,
    onDraft: vi.fn(),
    onPeek: vi.fn(),
  };
}

/** Task 5, Draft HQ's sync contract (spec §4): the SHEET tab's own honest banner for a room
 *  whose sheet has not been saved to the server yet. */
describe("DrawerSheetTab — the server-sync banner", () => {
  it("offers to save the sheet when no server sheet has been found", () => {
    render(<DrawerSheetTab {...baseProps()} hasServerSheet={false} onStartServerSheet={vi.fn()} />);
    expect(screen.getByText(/local to this browser only/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /save it to my sheet/i })).toBeInTheDocument();
  });

  it("calls onStartServerSheet when the manager presses the save button", async () => {
    const onStartServerSheet = vi.fn();
    render(<DrawerSheetTab {...baseProps()} hasServerSheet={false} onStartServerSheet={onStartServerSheet} />);
    await userEvent.click(screen.getByRole("button", { name: /save it to my sheet/i }));
    expect(onStartServerSheet).toHaveBeenCalledOnce();
  });

  it("shows no banner once a server sheet has been found", () => {
    render(<DrawerSheetTab {...baseProps()} hasServerSheet={true} onStartServerSheet={vi.fn()} />);
    expect(screen.queryByText(/local to this browser only/i)).not.toBeInTheDocument();
  });
});

const SHEET = { order: PLAYERS.map((player) => player.id), notes: {} };

/** The player-name adoption sweep's own suite, carried through the Draft HQ merge — the two
 *  branches created this file independently; both suites bind. */
function mountAdoption() {
  return render(
    <LeagueRoomDepsProvider deps={{ fetchJson: () => new Promise(() => {}), openEventSource: () => ({ addEventListener: () => {}, close: () => {} }) }}>
      <PlayerPeekHost />
      <DrawerSheetTab
        leagueId="l1"
        sheet={SHEET}
        playersById={playersById(PLAYERS)}
        boardRanks={new Map()}
        available={new Set(PLAYERS.map((player) => player.id))}
        onMove={vi.fn()}
        onSeedQueue={vi.fn()}
        onReset={vi.fn()}
        canDraft
        submitting={false}
        onDraft={vi.fn()}
        onPeek={vi.fn()}
        hasServerSheet={true}
        onStartServerSheet={vi.fn()}
      />
    </LeagueRoomDepsProvider>,
  );
}

describe("DrawerSheetTab — player-name adoption (task 3)", () => {
  it("makes every sheet row's name a pressable button that opens the season peek", async () => {
    mountAdoption();
    const name = screen.getByRole("button", { name: "Jalen Croft" });
    await act(async () => {
      fireEvent.click(name);
    });
    expect(screen.getByRole("dialog", { name: "Jalen Croft" })).toBeInTheDocument();
  });

  it("is axe-clean with the name, the card button and the reorder verbs all present", async () => {
    const { container } = mountAdoption();
    expect(await axe(container)).toHaveNoViolations();
  });
});
