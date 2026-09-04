import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Player } from "@/domain/player";
import { seedSheet } from "../state/sheet";
import { DrawerSheetTab } from "./drawer-sheet-tab";

const PLAYER: Player = { id: "p1", name: "Test Player", position: "RB", nflTeam: "SF", headshotUrl: null, adp: null };
const PLAYERS_BY_ID = new Map([[PLAYER.id, PLAYER]]);

function baseProps() {
  return {
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
