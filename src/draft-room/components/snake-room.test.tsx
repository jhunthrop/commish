import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { axe } from "vitest-axe";
import { ToastProvider } from "@/components/ui";
import { renderSurface } from "@/components/ui/test-utils";
import type { DraftRoom as DraftRoomState } from "../hooks/use-draft-room";
import { LEAGUE_NAME, PLAYERS, SNAKE_VIEW, TEAMS, playersById } from "../test-fixtures";
import { SnakeRoom } from "./snake-room";

const room: DraftRoomState = {
  status: "ready",
  error: null,
  view: SNAKE_VIEW,
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
  submit: async () => ({ ok: true }),
  refresh: async () => {},
  setQueue: async () => ({ ok: true }),
};

function renderRoom(over: Partial<DraftRoomState> = {}) {
  return render(
    <ToastProvider>
      <SnakeRoom room={{ ...room, ...over }} playersById={playersById(PLAYERS)} onAct={() => {}} />
    </ToastProvider>,
  );
}

describe("SnakeRoom", () => {
  it("lays out the four regions — rail, left pool, board stage, dock — both themes, axe-clean", async () => {
    await renderSurface(
      <ToastProvider>
        <SnakeRoom room={room} playersById={playersById(PLAYERS)} onAct={() => {}} />
      </ToastProvider>,
      async ({ container }) => {
        expect(screen.getByTestId("room-rail")).toHaveTextContent("You're on the clock");
        expect(screen.getByRole("list", { name: /available players/i })).toBeInTheDocument();
        expect(screen.getByRole("table", { name: /draft board/i })).toBeInTheDocument();
        expect(screen.getByTestId("room-dock")).toHaveAttribute("data-mode", "acting");
        expect(await axe(container)).toHaveNoViolations();
      },
    );
  });

  it("makes the dock's primary action the whole pick: one click on the top of your queue", () => {
    const submit = vi.fn(async () => ({ ok: true as const }));
    const onAct = vi.fn();
    render(
      <ToastProvider>
        <SnakeRoom room={{ ...room, submit }} playersById={playersById(PLAYERS)} onAct={onAct} />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Draft Marcus Reed" }));
    expect(onAct).toHaveBeenCalledWith({ type: "MAKE_PICK", playerId: "rb1" });
  });

  it("lets the team on the clock draft from the pool as well, for the pivot", () => {
    const onAct = vi.fn();
    render(
      <ToastProvider>
        <SnakeRoom room={room} playersById={playersById(PLAYERS)} onAct={onAct} />
      </ToastProvider>,
    );
    fireEvent.click(screen.getAllByRole("button", { name: "Draft" })[0]!);
    expect(onAct).toHaveBeenCalledWith({ type: "MAKE_PICK", playerId: "qb1" });
  });

  it("stands the room down when it is somebody else's turn, and says how long the wait is", () => {
    renderRoom({ view: { ...SNAKE_VIEW, onClockTeamId: "t2", upcoming: ["t2", "t1"] } });
    expect(screen.getByTestId("room-rail")).toHaveAttribute("data-mode", "watching");
    expect(screen.getByTestId("room-dock")).toHaveAttribute("data-mode", "watching");
    expect(screen.getByTestId("dock-your-turn")).toHaveTextContent("You're up in 1 pick (~8h 0m).");
  });

  it("walks the whole picking flow from the keyboard — star, reorder, dock action, pool pivot", () => {
    const onAct = vi.fn();
    render(
      <ToastProvider>
        <SnakeRoom room={{ ...room, queue: ["rb1", "qb1"] }} playersById={playersById(PLAYERS)} onAct={onAct} />
      </ToastProvider>,
    );
    // Every step of the flow is a real, named, focusable <button> — no div with a click
    // handler, and nothing reachable only by pointer.
    const flow = [
      screen.getByRole("button", { name: "Queue Andre Salas" }),
      screen.getByRole("button", { name: "Move Jalen Croft up" }),
      screen.getByRole("button", { name: "Draft Marcus Reed" }),
      screen.getAllByRole("button", { name: "Draft" })[0]!,
    ];
    for (const control of flow) {
      control.focus();
      expect(document.activeElement).toBe(control);
      expect(control.tabIndex).toBe(0);
    }
    // The last thing focused is the pool's own act button: the two-click pivot.
    fireEvent.click(document.activeElement!);
    expect(onAct).toHaveBeenCalledWith({ type: "MAKE_PICK", playerId: "qb1" });
  });

  it("shows the moderator's nudge, addressed to my own team for this turn", () => {
    renderRoom({ nudge: { message: "You're on the clock.", sequence: SNAKE_VIEW.sequence } });
    expect(screen.getByRole("status")).toHaveTextContent("You're on the clock.");
  });

  it("queues a player from the pool through room.setQueue", async () => {
    const setQueue = vi.fn(async () => ({ ok: true as const }));
    renderRoom({ queue: [], setQueue });
    fireEvent.click(screen.getByRole("button", { name: "Queue Jalen Croft" }));
    await waitFor(() => expect(setQueue).toHaveBeenCalledWith(["qb1"]));
  });

  it("reorders the queue from the dock's own chips, wired to room.setQueue", async () => {
    const setQueue = vi.fn(async () => ({ ok: true as const }));
    renderRoom({ queue: ["rb1", "qb1"], setQueue });
    fireEvent.click(screen.getByRole("button", { name: "Move Jalen Croft up" }));
    await waitFor(() => expect(setQueue).toHaveBeenCalledWith(["qb1", "rb1"]));
  });

  it("toasts the reducer's reason when a queue change is rejected", async () => {
    const setQueue = vi.fn(async () => ({ ok: false as const, reason: "A queue can hold at most 50 players." }));
    renderRoom({ setQueue });
    // Both the dock's chips and the pool render a "Remove … from your queue" button for a
    // queued player — either one exercises the same `onQueueChange`/toast wiring.
    fireEvent.click(screen.getAllByRole("button", { name: "Remove Marcus Reed from your queue" })[0]!);
    expect(await screen.findByRole("alert")).toHaveTextContent("A queue can hold at most 50 players.");
  });
});
