import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import type { AdvisorView } from "@/draft-service/assistant/view";
import { DraftRoomDepsProvider, type DraftRoomDeps } from "../hooks/deps";
import { resetAdvisorMemoryForTests } from "./advisor-memory";
import { advisorView } from "./test-view";
import { foldLandedView, presentView, useAdvisor, type AdvisorRoom } from "./use-advisor";

function jsonOf(body: unknown): Response {
  return { json: async () => body } as unknown as Response;
}

function view(computedAtPick: number, onTheClock: boolean): AdvisorView {
  return advisorView({ pickNumber: computedAtPick, onTheClock, stamp: { computedAtPick, sequence: computedAtPick } });
}

const EVERYONE: ReadonlySet<string> = new Set(["rb1", "wr1", "te1"]);

/** The room as the hook reads it: the draft, the log sequence the client holds, and who is still on the board. */
function roomAt(sequence: number, available: ReadonlySet<string> = EVERYONE, draftId = "d1"): AdvisorRoom {
  return { draftId, sequence, availablePlayerIds: available };
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

describe("presentView (the wrong-people guard: only candidates still on the board at render time)", () => {
  it("drops a named pick, an odds row and a tier row for anyone the room has since drafted, and keeps the rest", () => {
    const held = view(3, false); // names rb1; odds and tiers over rb1, wr1, te1
    const shown = presentView(held, new Set(["wr1", "te1"]));
    expect(shown.pick).toBeNull();
    expect(Object.keys(shown.odds!.survived).sort()).toEqual(["te1", "wr1"]);
    expect(Object.keys(shown.tiers).sort()).toEqual(["te1", "wr1"]);
    expect(shown.odds!.runs).toBe(held.odds!.runs);
    expect(shown.stamp).toEqual(held.stamp);
  });

  it("is the identical view when everyone it names is still available", () => {
    const held = view(3, true);
    const shown = presentView(held, EVERYONE);
    expect(shown.pick).toEqual(held.pick);
    expect(shown.odds).toEqual(held.odds);
    expect(shown.tiers).toEqual(held.tiers);
  });
});

describe("useAdvisor", () => {
  beforeEach(() => resetAdvisorMemoryForTests());

  it("fetches on mount through the room's own route and never for a seatless caller", async () => {
    const fetchJson = vi.fn(async () => jsonOf({ ok: true, data: view(3, true) }));
    const deps: DraftRoomDeps = { fetchJson, openEventSource: noopSource };
    const { result } = renderHook(() => useAdvisor(roomAt(3), "t1"), { wrapper: wrapper(deps) });
    await waitFor(() => expect(result.current.view).not.toBeNull());
    expect(fetchJson).toHaveBeenCalledWith("/api/drafts/d1/assistant");
    expect(result.current.recomputing).toBe(false);

    const seatless = renderHook(() => useAdvisor(roomAt(3), null), { wrapper: wrapper(deps) });
    expect(seatless.result.current.view).toBeNull();
    expect(fetchJson).toHaveBeenCalledTimes(1);
  });

  it("recomputes when the room's sequence moves, keeping the previous view on screen while it flies", async () => {
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
    const { result, rerender } = renderHook(({ room }) => useAdvisor(room, "t1"), { wrapper: wrapper(deps), initialProps: { room: roomAt(3) } });
    await waitFor(() => expect(result.current.view?.stamp.computedAtPick).toBe(3));

    rerender({ room: roomAt(4) });
    await waitFor(() => expect(result.current.recomputing).toBe(true));
    expect(result.current.view?.stamp.computedAtPick).toBe(3);
    await act(async () => {
      release!(jsonOf({ ok: true, data: view(4, false) }));
      await Promise.resolve();
    });
    await waitFor(() => expect(result.current.view?.stamp.computedAtPick).toBe(4));
    expect(result.current.recomputing).toBe(false);
    expect(fetchJson).toHaveBeenCalledTimes(2);
  });

  it("a candidate drafted between compute and render is filtered out of what the hook returns, and a stamp behind the room reads as recomputing", async () => {
    // The server answers a view stamped at sequence 3 that names rb1. By the time it renders,
    // the room the client holds is at sequence 4 and rb1 is gone (the fetch for sequence 4 is
    // still out). The card must not name him, and the view must say it is recomputing.
    const pending: ((response: Response) => void)[] = [];
    const fetchJson = vi.fn(() => new Promise<Response>((resolve) => pending.push(resolve)));
    const deps: DraftRoomDeps = { fetchJson, openEventSource: noopSource };
    const { result, rerender } = renderHook(({ room }) => useAdvisor(room, "t1"), { wrapper: wrapper(deps), initialProps: { room: roomAt(3) } });
    rerender({ room: roomAt(4, new Set(["wr1", "te1"])) });
    await act(async () => {
      pending[0]!(jsonOf({ ok: true, data: view(3, false) }));
      await Promise.resolve();
    });
    await waitFor(() => expect(result.current.view).not.toBeNull());
    expect(result.current.view?.pick).toBeNull();
    expect(Object.keys(result.current.view!.odds!.survived).sort()).toEqual(["te1", "wr1"]);
    expect(result.current.recomputing).toBe(true);

    await act(async () => {
      pending[1]!(jsonOf({ ok: true, data: advisorView({ pickNumber: 4, onTheClock: true, stamp: { computedAtPick: 4, sequence: 4 }, pick: null, odds: { pickNumber: 20, runs: 200, survived: { wr1: 150, te1: 20 } }, tiers: {} }) }));
      await Promise.resolve();
    });
    await waitFor(() => expect(result.current.recomputing).toBe(false));
    expect(result.current.view?.stamp.sequence).toBe(4);
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
    const { result, rerender } = renderHook(({ room }) => useAdvisor(room, "t1"), { wrapper: wrapper(deps), initialProps: { room: roomAt(1) } });
    expect(fetchJson).toHaveBeenCalledTimes(1);
    // Three picks land while the first request is still out.
    rerender({ room: roomAt(2) });
    rerender({ room: roomAt(3) });
    rerender({ room: roomAt(4) });
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
    const first = renderHook(({ room }) => useAdvisor(room, "t1"), { wrapper: wrapper(deps), initialProps: { room: roomAt(1) } });
    await waitFor(() => expect(first.result.current.view?.stamp.computedAtPick).toBe(1));
    first.rerender({ room: roomAt(2) });
    await waitFor(() => expect(first.result.current.prePickView?.stamp.computedAtPick).toBe(1));
    first.unmount();

    const second = renderHook(() => useAdvisor(roomAt(2), "t1"), { wrapper: wrapper(deps) });
    expect(second.result.current.prePickView?.stamp.computedAtPick).toBe(1);
    expect(second.result.current.view?.stamp.computedAtPick).toBe(2);
  });

  it("forgets one draft's memory when the room changes to another draft", async () => {
    const fetchJson = vi.fn(async () => jsonOf({ ok: true, data: view(1, true) }));
    const deps: DraftRoomDeps = { fetchJson, openEventSource: noopSource };
    const { result, rerender } = renderHook(({ room }) => useAdvisor(room, "t1"), { wrapper: wrapper(deps), initialProps: { room: roomAt(1) } });
    await waitFor(() => expect(result.current.view).not.toBeNull());
    rerender({ room: roomAt(1, EVERYONE, "d2") });
    await waitFor(() => expect(fetchJson).toHaveBeenLastCalledWith("/api/drafts/d2/assistant"));
  });

  it("surfaces the server's own words on a refused call and a network line on a failure", async () => {
    const refused: DraftRoomDeps = { fetchJson: async () => jsonOf({ ok: false, error: "The advisor has nothing to call right now." }), openEventSource: noopSource };
    const a = renderHook(() => useAdvisor(roomAt(1), "t1"), { wrapper: wrapper(refused) });
    await waitFor(() => expect(a.result.current.error).toBe("The advisor has nothing to call right now."));

    const failing: DraftRoomDeps = { fetchJson: async () => { throw new Error("boom"); }, openEventSource: noopSource };
    const b = renderHook(() => useAdvisor(roomAt(1, EVERYONE, "d2"), "t1"), { wrapper: wrapper(failing) });
    await waitFor(() => expect(b.result.current.error).toMatch(/reach the advisor/));
  });
});
