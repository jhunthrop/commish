import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import type { AdvisorView } from "@/draft-service/assistant/view";
import { DraftRoomDepsProvider, type DraftRoomDeps } from "../hooks/deps";
import { resetAdvisorMemoryForTests } from "./advisor-memory";
import { advisorView } from "./test-view";
import { advisorRoomKey, foldLandedView, useAdvisor } from "./use-advisor";

function jsonOf(body: unknown): Response {
  return { json: async () => body } as unknown as Response;
}

function view(computedAtPick: number, onTheClock: boolean): AdvisorView {
  return advisorView({ pickNumber: computedAtPick, onTheClock, stamp: { computedAtPick, sequence: computedAtPick } });
}

const wrapper = (deps: DraftRoomDeps) =>
  function Wrapper({ children }: { readonly children: ReactNode }) {
    return <DraftRoomDepsProvider deps={deps}>{children}</DraftRoomDepsProvider>;
  };

const noopSource = () => ({ addEventListener: () => {}, close: () => {} });

describe("foldLandedView", () => {
  it("latches the on-clock view only when the room moved", () => {
    const empty = { view: null, prePickView: null };
    const first = foldLandedView(empty, view(4, true));
    expect(first.prePickView).toBeNull();
    const repeat = foldLandedView(first, view(4, true));
    expect(repeat.prePickView).toBeNull();
    const moved = foldLandedView(repeat, view(5, false));
    expect(moved.prePickView?.stamp.computedAtPick).toBe(4);
    const later = foldLandedView(moved, view(6, false));
    expect(later.prePickView?.stamp.computedAtPick).toBe(4);
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

  it("recomputes on a room key change, keeping the previous view on screen while it flies", async () => {
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

  it("coalesces pick events that land while a request is in flight into exactly one follow-up request", async () => {
    const pending: ((response: Response) => void)[] = [];
    const fetchJson = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          pending.push(resolve);
        }),
    );
    const deps: DraftRoomDeps = { fetchJson, openEventSource: noopSource };
    const { result, rerender } = renderHook(({ key }) => useAdvisor("d1", key, "t1"), { wrapper: wrapper(deps), initialProps: { key: "0:1" } });
    expect(fetchJson).toHaveBeenCalledTimes(1);
    // Three picks land while the first request is still out.
    rerender({ key: "1:2" });
    rerender({ key: "2:3" });
    rerender({ key: "3:4" });
    expect(fetchJson).toHaveBeenCalledTimes(1);
    await act(async () => {
      pending[0]!(jsonOf({ ok: true, data: view(2, false) }));
      await Promise.resolve();
    });
    await waitFor(() => expect(fetchJson).toHaveBeenCalledTimes(2));
    expect(result.current.recomputing).toBe(true);
    await act(async () => {
      pending[1]!(jsonOf({ ok: true, data: view(4, false) }));
      await Promise.resolve();
    });
    await waitFor(() => expect(result.current.recomputing).toBe(false));
    expect(result.current.view?.stamp.computedAtPick).toBe(4);
    expect(fetchJson).toHaveBeenCalledTimes(2);
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
