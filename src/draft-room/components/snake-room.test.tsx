import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { axe } from "vitest-axe";
import { ToastProvider } from "@/components/ui";
import { renderSurface } from "@/components/ui/test-utils";
import { ChatRoomDepsProvider } from "@/chat-room/hooks/deps";
import { fixtureChatDeps } from "@/chat-room/test-fixtures";
import { DraftRoomDepsProvider } from "../hooks/deps";
import type { DraftRoom as DraftRoomState } from "../hooks/use-draft-room";
import { QUILT_CONFIG } from "../quilt/state/config";
import { LEAGUE_NAME, PLAYERS, SNAKE_VIEW, TEAMS, fixtureDeps, playersById } from "../test-fixtures";
import { SnakeRoom } from "./snake-room";

// Only the composition for the current width mounts. The test viewport answers the desktop
// query; the phone cases below ask for the other answer.
vi.mock("@/design/use-media-query", () => ({ useMediaQuery: vi.fn(() => true) }));
import { useMediaQuery } from "@/design/use-media-query";

afterEach(() => {
  vi.mocked(useMediaQuery).mockReturnValue(true);
  window.localStorage.clear();
});

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

const PICK_1 = { pickNumber: 1, round: 1, teamId: "t2", playerId: "qb1", slot: "QB" as const, slotIndex: 0, price: null, timestamp: "2026-09-01T00:00:00.000Z", auto: false };

function element(over: Partial<DraftRoomState> = {}) {
  return (
    <DraftRoomDepsProvider deps={fixtureDeps().deps}>
      <ChatRoomDepsProvider deps={fixtureChatDeps().deps}>
        <ToastProvider>
          <SnakeRoom room={{ ...room, ...over }} playersById={playersById(PLAYERS)} />
        </ToastProvider>
      </ChatRoomDepsProvider>
    </DraftRoomDepsProvider>
  );
}

function renderRoom(over: Partial<DraftRoomState> = {}) {
  return render(element(over));
}

const desktop = () => within(screen.getByTestId("quilt-room"));

/** Every solid Court blue pill on stage: P3 allows one per viewport. */
const solidPills = (container: HTMLElement) => [...container.querySelectorAll("button")].filter((button) => button.className.split(" ").includes("bg-accent"));

describe("SnakeRoom (Sideline)", () => {
  it("rests as the wall with the rail and a dock that carries no verb, both themes, axe-clean", async () => {
    await renderSurface(element({ myTeamId: "t2", view: { ...room.view!, onClockTeamId: "t1", upcoming: ["t1", "t2"] } }), async ({ container }) => {
      const surface = desktop();
      expect(surface.getByTestId("top-strip")).toHaveAttribute("data-turn", "theirs");
      expect(surface.getByTestId("turn-chip")).toHaveTextContent("Dana Whitfield");
      expect(surface.getByTestId("board-region")).toHaveAttribute("data-view", "wall");
      expect(surface.getByTestId("quilt-board")).toBeInTheDocument();
      expect(surface.getByTestId("stream-rail")).toBeInTheDocument();
      expect(surface.getByRole("list", { name: "Available players, best first" })).toBeInTheDocument();
      // Off your turn the dock carries no solid verb at all (P3).
      expect(surface.queryByTestId("dock-verb")).toBeNull();
      expect(solidPills(container)).toHaveLength(0);
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  it("on your turn the dock's Draft is the room's one solid pill, naming the call beside it", () => {
    const { container } = renderRoom();
    expect(desktop().getByTestId("top-strip")).toHaveAttribute("data-turn", "yours");
    // No advisor answer in this fixture, so the call falls back to the queue and says so.
    expect(desktop().getByTestId("dock-call")).toHaveTextContent("Marcus Reed");
    expect(desktop().getByTestId("dock-call")).toHaveTextContent("top of your queue");
    expect(desktop().getByTestId("dock-verb")).toHaveTextContent("Draft Marcus Reed");
    expect(solidPills(container)).toHaveLength(1);
  });

  describe("pick safety", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it("holds a Draft in the undo window and submits only on expiry", () => {
      const submit = vi.fn(async () => ({ ok: true as const }));
      renderRoom({ submit });
      fireEvent.click(desktop().getByTestId("dock-verb"));
      expect(submit).not.toHaveBeenCalled();
      expect(desktop().getByTestId("undo-pill")).toBeInTheDocument();
      vi.advanceTimersByTime(QUILT_CONFIG.undoWindowMs);
      expect(submit).toHaveBeenCalledWith({ type: "MAKE_PICK", playerId: "rb1" });
    });

    it("Undo inside the window means nothing was ever sent", () => {
      const submit = vi.fn(async () => ({ ok: true as const }));
      renderRoom({ submit });
      fireEvent.click(desktop().getByTestId("dock-verb"));
      fireEvent.click(desktop().getByRole("button", { name: "Undo" }));
      vi.advanceTimersByTime(QUILT_CONFIG.undoWindowMs * 2);
      expect(submit).not.toHaveBeenCalled();
      expect(desktop().queryByTestId("undo-pill")).toBeNull();
    });

    it("a rejected expiry submit gets the window's own words, not the generic act toast", async () => {
      const submit = vi.fn(async () => ({ ok: false as const, reason: "It's not your turn to pick." }));
      renderRoom({ submit });
      fireEvent.click(desktop().getByTestId("dock-verb"));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(QUILT_CONFIG.undoWindowMs);
      });
      const alert = screen.getByRole("alert");
      expect(alert).toHaveTextContent("Marcus Reed did not land.");
      expect(alert).toHaveTextContent("It's not your turn to pick.");
      expect(alert).toHaveTextContent("You are still on the clock.");
    });

    it("a second Draft from a pool row swaps the pill and says what it replaced", () => {
      const submit = vi.fn(async () => ({ ok: true as const }));
      renderRoom({ submit });
      fireEvent.click(desktop().getByTestId("dock-verb"));
      expect(desktop().getByTestId("undo-pill")).toHaveTextContent("locking in…");
      fireEvent.click(desktop().getByRole("button", { name: "Draft Jalen Croft" }));
      const pill = desktop().getByTestId("undo-pill");
      expect(pill).toHaveTextContent("swapped from Marcus Reed");
      vi.advanceTimersByTime(QUILT_CONFIG.undoWindowMs);
      expect(submit).toHaveBeenCalledTimes(1);
      expect(submit).toHaveBeenCalledWith({ type: "MAKE_PICK", playerId: "qb1" });
    });
  });

  it("opens the peek from a wall cell, closes it on Esc, and jumps to the pool's search on slash", () => {
    renderRoom({ view: { ...room.view!, picks: [PICK_1], pickNumber: 2, availablePlayerIds: ["rb1", "rb2", "wr1"] } });
    const surface = desktop();
    fireEvent.click(surface.getByRole("button", { name: "Jalen Croft, pick 1.01" }));
    const peek = surface.getByTestId("peek-sheet");
    expect(peek).toHaveTextContent("Jalen Croft");
    expect(peek).toHaveTextContent("Bye 10");
    expect(surface.getByTestId("peek-edges")).toHaveTextContent("No measured edge on him");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(surface.queryByTestId("peek-sheet")).toBeNull();
    fireEvent.keyDown(window, { key: "/" });
    expect(surface.getByRole("searchbox", { name: "Search players" })).toHaveFocus();
  });

  it("Esc mid-note saves the words and keeps the peek; the next Esc closes it", () => {
    renderRoom({ view: { ...room.view!, picks: [PICK_1], pickNumber: 2, availablePlayerIds: ["rb1", "rb2", "wr1"] } });
    const surface = desktop();
    fireEvent.click(surface.getByRole("button", { name: "Jalen Croft, pick 1.01" }));
    fireEvent.click(within(surface.getByTestId("peek-sheet")).getByRole("button", { name: "Add a note" }));
    const noteField = surface.getByRole("textbox", { name: "Your note on Jalen Croft" });
    fireEvent.change(noteField, { target: { value: "late-round stack" } });
    fireEvent.keyDown(noteField, { key: "Escape" });
    const peek = surface.getByTestId("peek-sheet");
    expect(peek).toBeInTheDocument();
    expect(within(peek).getByText("late-round stack")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(surface.queryByTestId("peek-sheet")).toBeNull();
  });

  it("a manager head on the wall opens that roster as a sheet; the same head closes it", () => {
    renderRoom({ view: { ...room.view!, picks: [PICK_1], pickNumber: 2, rosters: { t1: [], t2: [{ slot: "QB", slotIndex: 0, playerId: "qb1" }] } } });
    fireEvent.click(desktop().getByRole("button", { name: "Iron Owls, Rey Okafor. Open the roster." }));
    const sheet = screen.getByTestId("roster-sheet");
    expect(sheet).toHaveTextContent("Rey Okafor");
    expect(sheet).toHaveTextContent("Jalen Croft");
    expect(sheet).toHaveTextContent("1.01");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByTestId("roster-sheet")).toBeNull();
  });

  it("switches the board region to Your sheet: seven columns in your order, struck rows, hide taken", () => {
    renderRoom({ view: { ...room.view!, picks: [PICK_1], pickNumber: 2, availablePlayerIds: ["rb1", "rb2", "wr1"], rosters: { t1: [], t2: [{ slot: "QB", slotIndex: 0, playerId: "qb1" }] } } });
    const surface = desktop();
    fireEvent.click(surface.getByRole("tab", { name: "Your sheet" }));
    expect(surface.getByTestId("board-region")).toHaveAttribute("data-view", "sheet");
    expect(surface.getByTestId("sheet-basis")).toHaveTextContent("Our board, untouched");
    const columns = surface.getAllByTestId("sheet-column");
    expect(columns.map((column) => column.getAttribute("data-column"))).toEqual(["overall", "QB", "RB", "WR", "TE", "K", "DEF"]);
    const overall = within(columns[0]!);
    const rows = overall.getAllByTestId("sheet-row");
    expect(rows[0]).toHaveAttribute("data-taken", "true");
    expect(rows[0]).toHaveTextContent("Jalen Croft");
    expect(rows[0]).toHaveTextContent("taken");
    expect(rows[1]).toHaveTextContent("Marcus Reed");
    expect(overall.getByText("3 left of 4")).toBeInTheDocument();
    fireEvent.click(surface.getByTestId("hide-taken"));
    expect(within(surface.getAllByTestId("sheet-column")[0]!).queryAllByTestId("sheet-row").map((row) => row.getAttribute("data-taken"))).not.toContain("true");
    // A move says so in the basis line and offers the way back.
    fireEvent.click(surface.getByRole("button", { name: "Move Devon Marsh up your sheet" }));
    expect(surface.getByTestId("sheet-basis")).toHaveTextContent("2 of yours moved");
    fireEvent.click(surface.getByRole("button", { name: "Match our board" }));
    expect(surface.getByTestId("sheet-basis")).toHaveTextContent("Our board, untouched");
  });

  it("on your turn a sheet row drafts through the same undo window", () => {
    vi.useFakeTimers();
    const submit = vi.fn(async () => ({ ok: true as const }));
    renderRoom({ submit });
    const surface = desktop();
    fireEvent.click(surface.getByRole("tab", { name: "Your sheet" }));
    fireEvent.click(surface.getAllByRole("button", { name: "Draft Jalen Croft" })[0]!);
    expect(surface.getByTestId("undo-pill")).toHaveTextContent("Jalen Croft");
    vi.advanceTimersByTime(QUILT_CONFIG.undoWindowMs);
    expect(submit).toHaveBeenCalledWith({ type: "MAKE_PICK", playerId: "qb1" });
    vi.useRealTimers();
  });

  it("the stream opens from the rail, collapses back, hides to a pill on the strip, and remembers", async () => {
    renderRoom();
    const surface = desktop();
    fireEvent.click(surface.getByRole("button", { name: "Open the room" }));
    await waitFor(() => expect(surface.getByTestId("room-stream")).toHaveAttribute("data-width", "open"));
    expect(surface.getByLabelText("Message")).toBeInTheDocument();
    fireEvent.click(surface.getByRole("button", { name: "Collapse the room" }));
    expect(surface.getByTestId("stream-rail")).toBeInTheDocument();
    fireEvent.click(surface.getByRole("button", { name: "Hide the room" }));
    expect(surface.queryByTestId("stream-rail")).toBeNull();
    expect(surface.getByTestId("stream-hidden-pill")).toBeInTheDocument();
    expect(window.localStorage.getItem(QUILT_CONFIG.streamWidthStorageKey)).toBe("hidden");
    fireEvent.click(surface.getByTestId("stream-hidden-pill"));
    await waitFor(() => expect(surface.getByTestId("room-stream")).toBeInTheDocument());
  });

  it("queues from a pool row through room.setQueue", async () => {
    const setQueue = vi.fn(async () => ({ ok: true as const }));
    renderRoom({ queue: [], setQueue, view: { ...room.view!, onClockTeamId: "t2", upcoming: ["t2", "t1"] } });
    const pool = within(desktop().getByRole("list", { name: "Available players, best first" }));
    fireEvent.click(pool.getByRole("button", { name: "Queue Jalen Croft" }));
    await waitFor(() => expect(setQueue).toHaveBeenCalledWith(["qb1"]));
  });

  it("inverts on the phone: the stream is the page, the call block is pinned, picking is two-step", () => {
    vi.mocked(useMediaQuery).mockReturnValue(false);
    const submit = vi.fn(async () => ({ ok: true as const }));
    renderRoom({ submit });
    expect(screen.queryByTestId("quilt-room")).toBeNull();
    const phone = within(screen.getByTestId("phone-room"));
    expect(phone.getByTestId("room-stream")).toHaveAttribute("data-width", "page");
    expect(phone.getByTestId("phone-call")).toBeInTheDocument();
    fireEvent.click(phone.getByTestId("dock-verb"));
    expect(submit).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: /Confirm your pick/ })).toBeInTheDocument();
  });

  it("keeps a pending confirmation across a resize that swaps compositions", () => {
    vi.mocked(useMediaQuery).mockReturnValue(false);
    const submit = vi.fn(async () => ({ ok: true as const }));
    const { rerender } = render(element({ submit }));
    fireEvent.click(within(screen.getByTestId("phone-room")).getByTestId("dock-verb"));
    expect(screen.getByRole("dialog", { name: /Confirm your pick/ })).toBeInTheDocument();

    vi.mocked(useMediaQuery).mockReturnValue(true);
    rerender(element({ submit }));
    expect(screen.getByTestId("quilt-room")).toBeInTheDocument();
    expect(screen.queryByTestId("phone-room")).toBeNull();

    vi.mocked(useMediaQuery).mockReturnValue(false);
    rerender(element({ submit }));
    expect(screen.getByRole("dialog", { name: /Confirm your pick/ })).toBeInTheDocument();
    expect(submit).not.toHaveBeenCalled();
  });
});
