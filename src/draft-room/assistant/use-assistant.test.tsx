import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import type { AssistantCallView } from "@/draft-service/assistant/call";
import { DraftRoomDepsProvider, type DraftRoomDeps } from "../hooks/deps";
import { resetAssistantMemoryForTests } from "./assistant-memory";
import { useAssistant } from "./use-assistant";

function jsonOf(body: unknown): Response {
  return { json: async () => body } as unknown as Response;
}

function callView(pickNumber: number, onTheClock = true): AssistantCallView {
  return { pickNumber, onTheClock, candidates: [], yourBuild: [], winningBuilds: null, computedBasis: "gen1" };
}

const wrapper = (deps: DraftRoomDeps) =>
  function Wrapper({ children }: { readonly children: ReactNode }) {
    return <DraftRoomDepsProvider deps={deps}>{children}</DraftRoomDepsProvider>;
  };

function noopSource() {
  return { addEventListener: () => {}, close: () => {} };
}

describe("useAssistant", () => {
  // `assistant-memory.ts`'s map is a process-wide singleton — every test in this file reuses
  // "d1" as its draftId, so a prior test's write-through would otherwise bleed into the next
  // one's fresh mount.
  beforeEach(() => {
    resetAssistantMemoryForTests();
  });

  it("fetches the call for the current pick on mount, through the room's own route", async () => {
    const calls: string[] = [];
    const deps: DraftRoomDeps = {
      fetchJson: async (url) => {
        calls.push(url);
        return jsonOf({ ok: true, data: callView(3) });
      },
      openEventSource: noopSource,
    };
    const { result } = renderHook(() => useAssistant("d1", 3, "t1"), { wrapper: wrapper(deps) });
    await waitFor(() => expect(result.current.call).not.toBeNull());
    expect(calls).toEqual(["/api/drafts/d1/assistant"]);
    expect(result.current.call?.pickNumber).toBe(3);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("never fetches for a commissioner with no team of their own", () => {
    const fetchJson = vi.fn(async () => jsonOf({ ok: true, data: callView(1) }));
    const deps: DraftRoomDeps = { fetchJson, openEventSource: noopSource };
    const { result } = renderHook(() => useAssistant("d1", 1, null), { wrapper: wrapper(deps) });
    expect(fetchJson).not.toHaveBeenCalled();
    expect(result.current.call).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it("refetches when pickNumber changes and keeps the previous call rendered while it flies, no spinner flash", async () => {
    let callCount = 0;
    let releaseSecond: ((response: Response) => void) | null = null;
    const fetchJson = vi.fn(() => {
      callCount += 1;
      if (callCount === 1) return Promise.resolve(jsonOf({ ok: true, data: callView(1) }));
      return new Promise<Response>((resolve) => {
        releaseSecond = resolve;
      });
    });
    const deps: DraftRoomDeps = { fetchJson, openEventSource: noopSource };
    const { result, rerender } = renderHook(({ pickNumber }) => useAssistant("d1", pickNumber, "t1"), {
      wrapper: wrapper(deps),
      initialProps: { pickNumber: 1 },
    });
    await waitFor(() => expect(result.current.call?.pickNumber).toBe(1));

    rerender({ pickNumber: 2 });
    await waitFor(() => expect(result.current.loading).toBe(true));
    // The second fetch is still in flight — the OLD call keeps rendering, never null.
    expect(result.current.call?.pickNumber).toBe(1);

    await act(async () => {
      releaseSecond!(jsonOf({ ok: true, data: callView(2) }));
      await Promise.resolve();
    });
    await waitFor(() => expect(result.current.call?.pickNumber).toBe(2));
    expect(result.current.prePickCall?.pickNumber).toBe(1);
  });

  it("latches the pre-pick call across other teams' intervening picks", async () => {
    const bodies = [
      jsonOf({ ok: true, data: callView(1, true) }), // your turn — pick 1
      jsonOf({ ok: true, data: callView(2, false) }), // someone else resolves pick 2
      jsonOf({ ok: true, data: callView(3, false) }), // someone else resolves pick 3
    ];
    let index = 0;
    const fetchJson = vi.fn(async () => bodies[index++]);
    const deps: DraftRoomDeps = { fetchJson, openEventSource: noopSource };
    const { result, rerender } = renderHook(({ pickNumber }) => useAssistant("d1", pickNumber, "t1"), {
      wrapper: wrapper(deps),
      initialProps: { pickNumber: 1 },
    });
    await waitFor(() => expect(result.current.call?.pickNumber).toBe(1));
    expect(result.current.prePickCall).toBeNull();

    rerender({ pickNumber: 2 });
    await waitFor(() => expect(result.current.call?.pickNumber).toBe(2));
    expect(result.current.prePickCall?.pickNumber).toBe(1);

    rerender({ pickNumber: 3 });
    await waitFor(() => expect(result.current.call?.pickNumber).toBe(3));
    // A second other-team pick landed since — the latch still holds your own pre-pick call.
    expect(result.current.prePickCall?.pickNumber).toBe(1);
  });

  it("survives your own next turn arriving, and is replaced only when your next pick resolves", async () => {
    const bodies = [
      jsonOf({ ok: true, data: callView(1, true) }), // your turn — pick 1
      jsonOf({ ok: true, data: callView(2, false) }), // someone else resolves pick 2
      jsonOf({ ok: true, data: callView(3, false) }), // someone else resolves pick 3
      jsonOf({ ok: true, data: callView(4, true) }), // your next turn — pick 4 (beat must survive this)
      jsonOf({ ok: true, data: callView(5, false) }), // your pick 4 just resolved — beat is replaced
    ];
    let index = 0;
    const fetchJson = vi.fn(async () => bodies[index++]);
    const deps: DraftRoomDeps = { fetchJson, openEventSource: noopSource };
    const { result, rerender } = renderHook(({ pickNumber }) => useAssistant("d1", pickNumber, "t1"), {
      wrapper: wrapper(deps),
      initialProps: { pickNumber: 1 },
    });
    await waitFor(() => expect(result.current.call?.pickNumber).toBe(1));

    rerender({ pickNumber: 2 });
    await waitFor(() => expect(result.current.call?.pickNumber).toBe(2));
    expect(result.current.prePickCall?.pickNumber).toBe(1);

    rerender({ pickNumber: 3 });
    await waitFor(() => expect(result.current.call?.pickNumber).toBe(3));
    expect(result.current.prePickCall?.pickNumber).toBe(1);

    rerender({ pickNumber: 4 });
    await waitFor(() => expect(result.current.call?.pickNumber).toBe(4));
    // Your own next turn has arrived, but the beat is about your NEXT pick landing, not your next
    // turn starting — it survives, still pointing at pick 1.
    expect(result.current.prePickCall?.pickNumber).toBe(1);
    expect(result.current.call?.onTheClock).toBe(true);

    rerender({ pickNumber: 5 });
    await waitFor(() => expect(result.current.call?.pickNumber).toBe(5));
    // Your pick 4 just resolved — the old beat about pick 1 is superseded by the fresh capture.
    expect(result.current.prePickCall?.pickNumber).toBe(4);
  });

  it("survives the unmount/remount cycle the Pool-tab pick round trip requires", async () => {
    const bodies = [
      jsonOf({ ok: true, data: callView(1, true) }), // your turn — pick 1, before the pick
      jsonOf({ ok: true, data: callView(16, true) }), // sim-to-next-pick landed you back on the clock
    ];
    let index = 0;
    const fetchJson = vi.fn(async () => bodies[index++]);
    const deps: DraftRoomDeps = { fetchJson, openEventSource: noopSource };

    const first = renderHook(({ pickNumber }) => useAssistant("d-remount", pickNumber, "t1"), {
      wrapper: wrapper(deps),
      initialProps: { pickNumber: 1 },
    });
    await waitFor(() => expect(first.result.current.call?.pickNumber).toBe(1));
    expect(first.result.current.prePickCall).toBeNull();

    // The Pool-tab round trip a pick requires: `DrawerAssistantTab` (and this hook with it)
    // unmounts the instant you leave the Assistant tab to submit your pick.
    first.unmount();

    // It remounts once the sim has already landed you back on the clock at pick 16 — no
    // intermediate render of THIS hook instance ever saw pick 2..15 (the real fetch trace: the
    // pick action's own response jumps `pickNumber` straight there).
    const second = renderHook(({ pickNumber }) => useAssistant("d-remount", pickNumber, "t1"), {
      wrapper: wrapper(deps),
      initialProps: { pickNumber: 16 },
    });
    await waitFor(() => expect(second.result.current.call?.pickNumber).toBe(16));
    // The fresh instance hydrated pick 1's onTheClock call from `assistant-memory.ts`, so its own
    // first fetch still finds a "previous" call to latch — the beat's own input survives the
    // unmount that the pick itself forced.
    expect(second.result.current.prePickCall?.pickNumber).toBe(1);
  });

  it("never inherits another draft's memory", async () => {
    const roomABodies = [
      jsonOf({ ok: true, data: callView(1, true) }), // room A's own turn — pick 1
      jsonOf({ ok: true, data: callView(2, true) }), // room A's pick just resolved, back on the clock
    ];
    let roomAIndex = 0;
    const fetchJson = vi.fn(async (url: string) => {
      if (url.includes("d-room-a")) return roomABodies[roomAIndex++];
      return jsonOf({ ok: true, data: callView(1, true) });
    });
    const deps: DraftRoomDeps = { fetchJson, openEventSource: noopSource };

    const roomA = renderHook(({ pickNumber }) => useAssistant("d-room-a", pickNumber, "t1"), {
      wrapper: wrapper(deps),
      initialProps: { pickNumber: 1 },
    });
    await waitFor(() => expect(roomA.result.current.call?.pickNumber).toBe(1));
    roomA.rerender({ pickNumber: 2 });
    await waitFor(() => expect(roomA.result.current.prePickCall?.pickNumber).toBe(1));
    roomA.unmount();

    // A different draftId is a different room entirely — its own first mount must never see room
    // A's latched call, even though room A's entry is still sitting in the same module-scope map.
    const roomB = renderHook(({ pickNumber }) => useAssistant("d-room-b", pickNumber, "t1"), {
      wrapper: wrapper(deps),
      initialProps: { pickNumber: 1 },
    });
    await waitFor(() => expect(roomB.result.current.call?.pickNumber).toBe(1));
    expect(roomB.result.current.prePickCall).toBeNull();
  });

  it("surfaces the server's own honest message on a 409, without inventing a call", async () => {
    const deps: DraftRoomDeps = {
      fetchJson: async () => jsonOf({ ok: false, error: "The assistant has nothing to call right now." }),
      openEventSource: noopSource,
    };
    const { result } = renderHook(() => useAssistant("d1", 1, "t1"), { wrapper: wrapper(deps) });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.call).toBeNull();
    expect(result.current.error).toBe("The assistant has nothing to call right now.");
  });

  it("keeps the last good call and reports a network error when a later fetch throws", async () => {
    let fail = false;
    const deps: DraftRoomDeps = {
      fetchJson: async () => {
        if (fail) throw new Error("network down");
        return jsonOf({ ok: true, data: callView(1) });
      },
      openEventSource: noopSource,
    };
    const { result, rerender } = renderHook(({ pickNumber }) => useAssistant("d1", pickNumber, "t1"), {
      wrapper: wrapper(deps),
      initialProps: { pickNumber: 1 },
    });
    await waitFor(() => expect(result.current.call?.pickNumber).toBe(1));

    fail = true;
    rerender({ pickNumber: 2 });
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.call?.pickNumber).toBe(1);
  });
});
