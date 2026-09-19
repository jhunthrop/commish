import { describe, it, expect, vi } from "vitest";
import { renderHook, screen, act, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { ToastProvider } from "@/components/ui";
import type { DraftRoom as DraftRoomState } from "./use-draft-room";
import { SNAKE_VIEW, PLAYERS, TEAMS, LEAGUE_NAME } from "../test-fixtures";
import { useQueueHandlers } from "./use-queue-handlers";

function fakeRoom(over: Partial<DraftRoomState> = {}): DraftRoomState {
  return {
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
    queue: [],
    nudge: null,
    mock: null,
    waiting: null,
    submit: async () => ({ ok: true, notice: null }),
    refresh: async () => {},
    setQueue: async () => ({ ok: true }),
    ...over,
  };
}

const wrapper = ({ children }: { readonly children: ReactNode }) => <ToastProvider>{children}</ToastProvider>;

describe("useQueueHandlers", () => {
  it("computes queuedPlayerIds from room.queue", () => {
    const { result } = renderHook(() => useQueueHandlers(fakeRoom({ queue: ["rb1", "qb1"] })), { wrapper });
    expect(result.current.queuedPlayerIds).toEqual(new Set(["rb1", "qb1"]));
  });

  it("calls room.setQueue on a change and shows no toast when it succeeds", async () => {
    const setQueue = vi.fn(async () => ({ ok: true as const }));
    const { result } = renderHook(() => useQueueHandlers(fakeRoom({ setQueue })), { wrapper });
    await act(async () => {
      result.current.onQueueChange(["rb1"]);
    });
    expect(setQueue).toHaveBeenCalledWith(["rb1"]);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows the rejection reason as a toast when room.setQueue fails", async () => {
    const setQueue = vi.fn(async () => ({ ok: false as const, reason: "A queue can hold at most 50 players." }));
    const { result } = renderHook(() => useQueueHandlers(fakeRoom({ setQueue })), { wrapper });
    act(() => {
      result.current.onQueueChange(["rb1"]);
    });
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("A queue can hold at most 50 players."));
  });

  it("toggles: adds an unqueued player and removes an already-queued one", async () => {
    const setQueue = vi.fn(async () => ({ ok: true as const }));
    const { result, rerender } = renderHook(({ queue }: { queue: readonly string[] }) => useQueueHandlers(fakeRoom({ queue, setQueue })), {
      wrapper,
      initialProps: { queue: [] as readonly string[] },
    });
    await act(async () => {
      result.current.onQueueToggle("rb1");
    });
    expect(setQueue).toHaveBeenLastCalledWith(["rb1"]);

    rerender({ queue: ["rb1"] });
    await act(async () => {
      result.current.onQueueToggle("rb1");
    });
    expect(setQueue).toHaveBeenLastCalledWith([]);
  });
});
