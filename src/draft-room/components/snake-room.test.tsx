import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { axe } from "vitest-axe";
import { ToastProvider } from "@/components/ui";
import { renderSurface } from "@/components/ui/test-utils";
import type { DraftRoom as DraftRoomState } from "../hooks/use-draft-room";
import { QUILT_CONFIG } from "../quilt/state/config";
import { LEAGUE_NAME, PLAYERS, SNAKE_VIEW, TEAMS, playersById } from "../test-fixtures";
import { SnakeRoom } from "./snake-room";

/** A deadline far enough out that the pick-safety window is never squeezed away. */
const roomyDeadline = (): string => new Date(Date.now() + 60_000).toISOString();

const room: DraftRoomState = {
  status: "ready",
  error: null,
  view: { ...SNAKE_VIEW, deadlineAt: roomyDeadline() },
  players: PLAYERS,
  teams: TEAMS,
  leagueName: LEAGUE_NAME,
  myTeamId: "t1",
  isCommissioner: false,
  connection: "live",
  pendingPlayerId: null,
  submitting: false,
  lastPick: null,
  queue: ["rb1"],
  nudge: null,
  mock: null,
  waiting: null,
  byeWeeks: new Map([["KC", 10]]),
  submit: async () => ({ ok: true }),
  refresh: async () => {},
  setQueue: async () => ({ ok: true }),
};

function renderRoom(over: Partial<DraftRoomState> = {}, onAct: (action: unknown) => void = () => {}) {
  return render(
    <ToastProvider>
      <SnakeRoom room={{ ...room, ...over }} playersById={playersById(PLAYERS)} onAct={onAct} />
    </ToastProvider>,
  );
}

/** The desktop tree — the mobile inversion renders beside it and CSS hides one of the two. */
const desktop = () => within(screen.getByTestId("quilt-room"));

describe("SnakeRoom (the quilt)", () => {
  afterEach(() => {
    window.localStorage.clear();
  });

  it("rests as the quilt: board on stage, slim strip, collapsed drawer — both themes, axe-clean", async () => {
    await renderSurface(
      <ToastProvider>
        <SnakeRoom
          room={{ ...room, myTeamId: "t2", view: { ...room.view!, onClockTeamId: "t1", upcoming: ["t1", "t2"] } }}
          playersById={playersById(PLAYERS)}
          onAct={() => {}}
        />
      </ToastProvider>,
      async ({ container }) => {
        const surface = desktop();
        expect(surface.getByTestId("clock-strip")).toHaveAttribute("data-strip-state", "resting");
        expect(surface.getByTestId("your-next")).toHaveTextContent("YOU PICK 1.02 · NEXT");
        expect(surface.getByTestId("quilt-board")).toBeInTheDocument();
        expect(surface.getByTestId("pool-drawer")).toHaveAttribute("data-drawer-height", "collapsed");
        expect(surface.getByText("Best available")).toBeInTheDocument();
        expect(await axe(container)).toHaveNoViolations();
      },
    );
  });

  it("swells amber on your turn with the queue's top picks inline", () => {
    renderRoom();
    const strip = desktop().getByTestId("clock-strip");
    expect(strip).toHaveAttribute("data-strip-state", "your-turn");
    // rb1 is queued and available, so it leads the strip.
    expect(within(strip).getByText("M. Reed")).toBeInTheDocument();
    expect(within(strip).getAllByRole("button", { name: "Draft" }).length).toBeGreaterThan(0);
  });

  describe("pick safety", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it("holds a DRAFT in the undo window and submits only on expiry", () => {
      const onAct = vi.fn();
      renderRoom({}, onAct);
      const strip = desktop().getByTestId("clock-strip");
      fireEvent.click(within(strip).getAllByRole("button", { name: "Draft" })[0]!);
      expect(onAct).not.toHaveBeenCalled();
      expect(desktop().getByTestId("undo-pill")).toBeInTheDocument();
      vi.advanceTimersByTime(QUILT_CONFIG.undoWindowMs);
      expect(onAct).toHaveBeenCalledWith({ type: "MAKE_PICK", playerId: "rb1" });
    });

    it("UNDO inside the window means nothing was ever sent", () => {
      const onAct = vi.fn();
      renderRoom({}, onAct);
      const strip = desktop().getByTestId("clock-strip");
      fireEvent.click(within(strip).getAllByRole("button", { name: "Draft" })[0]!);
      fireEvent.click(desktop().getByRole("button", { name: "Undo" }));
      vi.advanceTimersByTime(QUILT_CONFIG.undoWindowMs * 2);
      expect(onAct).not.toHaveBeenCalled();
      expect(desktop().queryByTestId("undo-pill")).toBeNull();
    });
  });

  it("walks the drawer from the keyboard: space to half, slash to search-full, esc collapses", () => {
    renderRoom();
    const surface = desktop();
    fireEvent.keyDown(window, { key: " " });
    expect(surface.getByTestId("pool-drawer")).toHaveAttribute("data-drawer-height", "half");
    fireEvent.keyDown(window, { key: "/" });
    expect(surface.getByTestId("pool-drawer")).toHaveAttribute("data-drawer-height", "full");
    expect(surface.getByRole("searchbox", { name: "Search players" })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(surface.getByTestId("pool-drawer")).toHaveAttribute("data-drawer-height", "collapsed");
  });

  it("opens the peek sheet from a quilt cell and dismisses it on close", () => {
    const picks = [{ pickNumber: 1, round: 1, teamId: "t2", playerId: "qb1", slot: "QB" as const, slotIndex: 0, price: null, timestamp: "2026-09-01T00:00:00.000Z", auto: false }];
    renderRoom({ view: { ...room.view!, picks, pickNumber: 2, availablePlayerIds: ["rb1", "rb2", "wr1"] } });
    const surface = desktop();
    fireEvent.click(surface.getByRole("button", { name: "Jalen Croft, pick 1.01" }));
    const peek = surface.getByTestId("peek-sheet");
    expect(peek).toHaveTextContent("Jalen Croft");
    expect(peek).toHaveTextContent("Bye 10");
    // The GENERIC edge line only — never a law's name (founder secrecy ruling).
    expect(surface.getByTestId("peek-edges")).toHaveTextContent("No measured edge on him");
    fireEvent.click(within(peek).getByRole("button", { name: "Close player card" }));
    expect(surface.queryByTestId("peek-sheet")).toBeNull();
  });

  it("recolors in place under the NEEDS lens: the needs row appears, the rounds stay", () => {
    renderRoom();
    const surface = desktop();
    expect(surface.queryByTestId("quilt-needs-row")).toBeNull();
    fireEvent.click(within(surface.getByTestId("clock-strip")).getByRole("button", { name: "NEEDS" }));
    expect(surface.getByTestId("quilt-needs-row")).toBeInTheDocument();
    expect(surface.getByTestId("quilt-round-1")).toBeInTheDocument();
    expect(surface.getByTestId("quilt-round-3")).toBeInTheDocument();
  });

  it("carries MY SHEET in the drawer, seeded from the board, with the you-vs-board gap", () => {
    renderRoom();
    const surface = desktop();
    fireEvent.keyDown(window, { key: " " });
    fireEvent.click(within(surface.getByTestId("pool-drawer")).getByRole("tab", { name: "MY SHEET" }));
    const rows = within(surface.getByTestId("pool-drawer")).getAllByTestId("sheet-vs-board");
    expect(rows[0]).toHaveTextContent("you 1 · board 1");
  });

  it("queues from the drawer through room.setQueue", async () => {
    const setQueue = vi.fn(async () => ({ ok: true as const }));
    renderRoom({ queue: [], setQueue });
    const surface = desktop();
    fireEvent.keyDown(window, { key: " " });
    fireEvent.click(within(surface.getByTestId("pool-drawer")).getByRole("button", { name: "Add Jalen Croft to your queue" }));
    await waitFor(() => expect(setQueue).toHaveBeenCalledWith(["qb1"]));
  });

  it("keeps the loud fills on acts and on nothing else (law 5)", () => {
    const { container } = renderRoom();
    expect(container.querySelector(".bg-text-primary")).toBeNull();
    const loud = [...container.querySelectorAll("button.bg-accent")];
    for (const pill of loud) {
      expect(pill.textContent ?? "").toMatch(/Draft|Confirm|PICKS|NEEDS|VALUE|BYES/);
    }
  });

  it("inverts on the phone tree: bottom tabs, pool first, two-step picking", () => {
    const onAct = vi.fn();
    renderRoom({}, onAct);
    const phone = screen.getByRole("navigation", { name: "Draft room tabs" }).parentElement!;
    expect(within(phone).getByTestId("mobile-your-turn")).toBeInTheDocument();
    // A phone DRAFT opens the confirm sheet rather than picking.
    fireEvent.click(within(phone).getAllByRole("button", { name: "Draft" })[0]!);
    expect(onAct).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: /Confirm your pick/ })).toBeInTheDocument();
  });
});
