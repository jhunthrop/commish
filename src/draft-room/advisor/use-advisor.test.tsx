import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import type { AdvisorView } from "@/draft-service/assistant/view";
import { DraftRoomDepsProvider, type DraftRoomDeps } from "../hooks/deps";
import { resetAdvisorMemoryForTests } from "./advisor-memory";
import { advisorRoomKey, foldLandedView, useAdvisor } from "./use-advisor";

function jsonOf(body: unknown): Response {
  return { json: async () => body } as unknown as Response;
}

function view(computedAtPick: number, onTheClock: boolean, voiceStatus: AdvisorView["voice"]["status"] = "absent"): AdvisorView {
  return {
    pickNumber: computedAtPick,
    onTheClock,
    picksUntilYourTurn: 0,
    teamCount: 10,
    stamp: { computedAtPick, sequence: computedAtPick },
    now: [],
    plan: { computedAtPick, runs: 200, horizon: 3, reachFloor: 0.25, turns: [] },
    signals: { run: null, collapses: [], ahead: [] },
    yourBuild: [],
    winningBuilds: null,
    computedBasis: "gen1",
    names: {},
    strategyTemplate: "The board is quiet.",
    voice: { status: voiceStatus, strategy: null, reasons: {} },
    ledger: { numbers: [], names: [] },
  };
}

const wrapper = (deps: DraftRoomDeps) =>
  function Wrapper({ children }: { readonly children: ReactNode }) {
    return <DraftRoomDepsProvider deps={deps}>{children}</DraftRoomDepsProvider>;
  };

const noopSource = () => ({ addEventListener: () => {}, close: () => {} });

describe("foldLandedView", () => {
  it("latches the on-clock view and rolls the previous plan only when the room moved", () => {
    const empty = { view: null, prePickView: null, previousPlan: null };
    const first = foldLandedView(empty, view(4, true));
    expect(first.prePickView).toBeNull();
    const repoll = foldLandedView(first, view(4, true, "ready"));
    expect(repoll.prePickView).toBeNull();
    expect(repoll.previousPlan).toBeNull();
    const moved = foldLandedView(repoll, view(5, false));
    expect(moved.prePickView?.stamp.computedAtPick).toBe(4);
    expect(moved.previousPlan?.computedAtPick).toBe(4);
    const later = foldLandedView(moved, view(6, false));
    expect(later.prePickView?.stamp.computedAtPick).toBe(4);
    expect(later.previousPlan?.computedAtPick).toBe(5);
  });
});

describe("useAdvisor", () => {
  beforeEach(() => resetAdvisorMemoryForTests());

  it("fetches on mount through the room's own route and never for a seatless caller", async () => {
    const fetchJson = vi.fn(async () => jsonOf({ ok: true, data: view(3, true) }));
    const deps: DraftRoomDeps = { fetchJson, openEventSource: noopSource };
    const { result } = renderHook(() => useAdvisor("d1", advisorRoomKey(2, 3), "t1"), { wrapper: wrapper(deps) });
    await waitFor(() => expect(result.current.view).not.toBeNull());
    expect(fetchJson).toHaveBeenCalledWith("/api/drafts/d1/assistant");
    expect(result.current.recomputing).toBe(false);

    const seatless = renderHook(() => useAdvisor("d1", advisorRoomKey(2, 3), null), { wrapper: wrapper(deps) });
    expect(seatless.result.current.view).toBeNull();
    expect(fetchJson).toHaveBeenCalledTimes(1);
  });

  it("recomputes on every room key change (a pick landing), keeping the previous view on screen while it flies", async () => {
    let release: ((response: Response) => void) | null = null;
    let calls = 0;
    const fetchJson = vi.fn(() => {
      calls += 1;
      if (calls === 1) return Promise.resolve(jsonOf({ ok: true, data: view(3, false) }));
      return new Promise<Response>((resolve) => {
        release = resolve;
      });
    });
    const deps: DraftRoomDeps = { fetchJson, openEventSource: noopSource };
    const { result, rerender } = renderHook(({ key }) => useAdvisor("d1", key, "t1"), { wrapper: wrapper(deps), initialProps: { key: advisorRoomKey(2, 3) } });
    await waitFor(() => expect(result.current.view?.stamp.computedAtPick).toBe(3));

    // Another seat's pick lands: the pick number the advisor answers for is unchanged (3 is still
    // this seat's next turn) but the room moved, so the advisor recomputes.
    rerender({ key: advisorRoomKey(3, 3) });
    await waitFor(() => expect(result.current.recomputing).toBe(true));
    expect(result.current.view?.stamp.computedAtPick).toBe(3);
    await act(async () => {
      release!(jsonOf({ ok: true, data: view(4, false) }));
      await Promise.resolve();
    });
    await waitFor(() => expect(result.current.view?.stamp.computedAtPick).toBe(4));
    expect(fetchJson).toHaveBeenCalledTimes(2);
  });

  it("re-polls while the writer is pending, and stops once it lands", async () => {
    vi.useFakeTimers();
    try {
      const bodies = [view(4, true, "pending"), view(4, true, "ready"), view(4, true, "ready")];
      let index = 0;
      const fetchJson = vi.fn(async () => jsonOf({ ok: true, data: bodies[Math.min(index++, bodies.length - 1)] }));
      const deps: DraftRoomDeps = { fetchJson, openEventSource: noopSource };
      const { result } = renderHook(() => useAdvisor("d1", advisorRoomKey(3, 4), "t1"), { wrapper: wrapper(deps) });
      await act(async () => {
        await Promise.resolve();
      });
      expect(result.current.view?.voice.status).toBe("pending");
      await act(async () => {
        vi.advanceTimersByTime(3_000);
        await Promise.resolve();
      });
      expect(fetchJson).toHaveBeenCalledTimes(2);
      expect(result.current.view?.voice.status).toBe("ready");
      await act(async () => {
        vi.advanceTimersByTime(10_000);
      });
      expect(fetchJson).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("survives a remount through the module memory, latch included", async () => {
    const bodies = [view(1, true), view(2, false)];
    let index = 0;
    const fetchJson = vi.fn(async () => jsonOf({ ok: true, data: bodies[Math.min(index++, 1)] }));
    const deps: DraftRoomDeps = { fetchJson, openEventSource: noopSource };
    const first = renderHook(({ key }) => useAdvisor("d1", key, "t1"), { wrapper: wrapper(deps), initialProps: { key: "0:1" } });
    await waitFor(() => expect(first.result.current.view?.stamp.computedAtPick).toBe(1));
    first.rerender({ key: "1:2" });
    await waitFor(() => expect(first.result.current.prePickView?.stamp.computedAtPick).toBe(1));
    first.unmount();

    const second = renderHook(() => useAdvisor("d1", "1:2", "t1"), { wrapper: wrapper(deps) });
    expect(second.result.current.prePickView?.stamp.computedAtPick).toBe(1);
    expect(second.result.current.view?.stamp.computedAtPick).toBe(2);
  });

  it("surfaces the server's own words on a refused call and a network line on a failure", async () => {
    const refused: DraftRoomDeps = { fetchJson: async () => jsonOf({ ok: false, error: "The advisor has nothing to call right now." }), openEventSource: noopSource };
    const a = renderHook(() => useAdvisor("d1", "0:1", "t1"), { wrapper: wrapper(refused) });
    await waitFor(() => expect(a.result.current.error).toBe("The advisor has nothing to call right now."));

    const failing: DraftRoomDeps = { fetchJson: async () => { throw new Error("boom"); }, openEventSource: noopSource };
    const b = renderHook(() => useAdvisor("d2", "0:1", "t1"), { wrapper: wrapper(failing) });
    await waitFor(() => expect(b.result.current.error).toMatch(/reach the advisor/));
  });
});
