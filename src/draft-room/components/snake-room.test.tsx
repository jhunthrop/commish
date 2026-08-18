import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { axe } from "vitest-axe";
import { ToastProvider } from "@/components/ui";
import { inBothThemes } from "@/components/ui/test-utils";
import type { DraftRoom as DraftRoomState } from "../hooks/use-draft-room";
import { PLAYERS, SNAKE_VIEW, TEAMS, playersById } from "../test-fixtures";
import { SnakeRoom } from "./snake-room";

const room: DraftRoomState = {
  status: "ready",
  error: null,
  view: SNAKE_VIEW,
  players: PLAYERS,
  teams: TEAMS,
  myTeamId: "t1",
  isCommissioner: false,
  connection: "live",
  pendingPlayerId: null,
  submitting: false,
  lastPick: null,
  queue: ["rb1"],
  nudge: null,
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
  it("lays out the clock, player pool, queue, rosters, and pick history — both themes, axe-clean", async () => {
    await inBothThemes(
      <ToastProvider>
        <SnakeRoom room={room} playersById={playersById(PLAYERS)} onAct={() => {}} />
      </ToastProvider>,
      async ({ container }) => {
        expect(screen.getByText("You're on the clock")).toBeInTheDocument();
        expect(screen.getByRole("table", { name: /available players/i })).toBeInTheDocument();
        expect(screen.getByRole("group", { name: "Bay Bandits" })).toBeInTheDocument();
        expect(screen.getByText("Your queue")).toBeInTheDocument();
        expect(await axe(container)).toHaveNoViolations();
      },
    );
  });

  it("lets the team on the clock draft a player", () => {
    renderRoom();
    expect(screen.getAllByRole("button", { name: "Draft" })[0]).toBeEnabled();
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

  it("reorders the queue through the queue panel's own buttons, wired to room.setQueue", async () => {
    const setQueue = vi.fn(async () => ({ ok: true as const }));
    renderRoom({ queue: ["rb1", "qb1"], setQueue });
    fireEvent.click(screen.getByRole("button", { name: "Move Jalen Croft up" }));
    await waitFor(() => expect(setQueue).toHaveBeenCalledWith(["qb1", "rb1"]));
  });

  it("toasts the reducer's reason when a queue change is rejected", async () => {
    const setQueue = vi.fn(async () => ({ ok: false as const, reason: "A queue can hold at most 50 players." }));
    renderRoom({ setQueue });
    // Both the queue panel and the pool render a "Remove … from your queue" button for a
    // queued player — either one exercises the same `onQueueChange`/toast wiring.
    fireEvent.click(screen.getAllByRole("button", { name: "Remove Marcus Reed from your queue" })[0]!);
    expect(await screen.findByRole("alert")).toHaveTextContent("A queue can hold at most 50 players.");
  });
});
