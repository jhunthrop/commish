import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import type { DraftStateView } from "@/draft-engine";
import { DraftRoomDepsProvider, type DraftRoomDeps, type EventSourceLike } from "./deps";
import { useDraftRoom, type SubmitOutcome } from "./use-draft-room";

class FakeEventSource implements EventSourceLike {
  closed = false;
  private readonly listeners = new Map<string, ((event: MessageEvent) => void)[]>();
  constructor(readonly url: string) {}
  addEventListener(type: string, listener: (event: MessageEvent) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  close(): void {
    this.closed = true;
  }
  emit(type: string, payload?: unknown): void {
    const data = payload === undefined ? "" : JSON.stringify({ id: "1-0", type, leagueId: "l1", timestamp: "2026-09-01T00:00:00.000Z", payload });
    for (const listener of this.listeners.get(type) ?? []) listener({ data } as unknown as MessageEvent);
  }
}

const VIEW: DraftStateView = {
  phase: "in_progress",
  sequence: 1,
  pickNumber: 1,
  onClockTeamId: "t1",
  deadlineAt: "2026-09-01T08:00:00.000Z",
  clockSeconds: 28_800,
  nextTightening: null,
  upcoming: ["t1", "t2"],
  draftId: "d1",
  leagueId: "l1",
  format: "snake",
  slotConfig: [{ slot: "QB", count: 1, eligiblePositions: ["QB"] }],
  draftOrder: ["t1", "t2"],
  picks: [],
  rosters: { t1: [], t2: [] },
  budgets: {},
  auction: null,
  availablePlayerIds: ["qb1", "rb1"],
  minBid: null,
  maxBids: {},
};

const PLAYERS = [
  { id: "qb1", name: "Jalen Croft", position: "QB", nflTeam: "KC" },
  { id: "rb1", name: "Marcus Reed", position: "RB", nflTeam: "SF" },
];

const TEAMS = [
  { id: "t1", name: "Bay Bandits", ownerDisplayName: "Dana", ownerAvatarUrl: null },
  { id: "t2", name: "Iron Owls", ownerDisplayName: "Rey", ownerAvatarUrl: null },
];

const pickPayload = (sequence: number) => ({
  draftId: "d1",
  clock: { ...VIEW, sequence, pickNumber: 2, onClockTeamId: "t2" },
  pickNumber: 1,
  round: 1,
  teamId: "t1",
  playerId: "qb1",
  slot: "QB",
  slotIndex: 0,
  price: null,
  timestamp: "2026-09-01T00:05:00.000Z",
  auto: false,
});

function jsonOf(body: unknown): Response {
  return { json: async () => body } as unknown as Response;
}

interface Harness {
  /** Mutable: a couple of cases swap in a failing `fetchJson` before mounting. */
  deps: DraftRoomDeps;
  readonly sources: FakeEventSource[];
  readonly fetches: string[];
  snapshot: DraftStateView;
  postResponse: unknown;
  /** What the snapshot reports as the caller's own queue. */
  queue: readonly string[];
  /** What `POST /queue` answers with. */
  queueResponse: unknown;
}

function harness(): Harness {
  const state: Harness = {
    sources: [],
    fetches: [],
    snapshot: VIEW,
    postResponse: null,
    queue: [],
    queueResponse: { ok: true, data: { queue: [] } },
    deps: {
      fetchJson: async (url, init) => {
        state.fetches.push(`${init?.method ?? "GET"} ${url}`);
        if (url.endsWith("/players")) return jsonOf({ ok: true, data: { players: PLAYERS } });
        if (url.endsWith("/queue")) return jsonOf(init?.method === "POST" ? state.queueResponse : { ok: true, data: { queue: state.queue } });
        if (init?.method === "POST") return jsonOf(state.postResponse);
        return jsonOf({ ok: true, data: { draft: state.snapshot, teamId: "t1", isCommissioner: false, teams: TEAMS, queue: state.queue } });
      },
      openEventSource: (url) => {
        const source = new FakeEventSource(url);
        state.sources.push(source);
        return source;
      },
    },
  };
  return state;
}

const wrapper = (deps: DraftRoomDeps) =>
  function Wrapper({ children }: { readonly children: ReactNode }) {
    return <DraftRoomDepsProvider deps={deps}>{children}</DraftRoomDepsProvider>;
  };

async function mounted(h: Harness) {
  const rendered = renderHook(() => useDraftRoom("d1"), { wrapper: wrapper(h.deps) });
  await waitFor(() => expect(rendered.result.current.status).toBe("ready"));
  return rendered;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useDraftRoom", () => {
  it("loads the view, the players and the teams, then subscribes to the league stream", async () => {
    const h = harness();
    const { result } = await mounted(h);
    expect(result.current.view?.draftId).toBe("d1");
    expect(result.current.players).toHaveLength(2);
    expect(result.current.teams).toHaveLength(2);
    expect(result.current.myTeamId).toBe("t1");
    expect(h.sources[0]?.url).toBe("/api/leagues/l1/events");
  });

  it("surfaces the server's own message when the state request fails", async () => {
    const h = harness();
    h.deps = { ...h.deps, fetchJson: async () => jsonOf({ ok: false, error: "You don't have a team in this league." }) };
    const { result } = renderHook(() => useDraftRoom("d1"), { wrapper: wrapper(h.deps) });
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.error).toBe("You don't have a team in this league.");
  });

  it("applies a pick event to the local view without refetching", async () => {
    const h = harness();
    const { result } = await mounted(h);
    const before = h.fetches.length;
    act(() => h.sources[0]!.emit("draft.pick", pickPayload(2)));
    await waitFor(() => expect(result.current.view?.picks).toHaveLength(1));
    expect(result.current.view?.onClockTeamId).toBe("t2");
    expect(result.current.lastPick).toEqual({ pick: expect.objectContaining({ playerId: "qb1" }), isMine: true });
    expect(h.fetches).toHaveLength(before);
  });

  it("refetches the whole view when the sequence skips ahead", async () => {
    const h = harness();
    const { result } = await mounted(h);
    h.snapshot = { ...VIEW, sequence: 9, pickNumber: 5, availablePlayerIds: ["rb1"] };
    act(() => h.sources[0]!.emit("draft.pick", pickPayload(9)));
    await waitFor(() => expect(result.current.view?.sequence).toBe(9));
    expect(h.fetches.filter((f) => f === "GET /api/drafts/d1")).toHaveLength(2);
  });

  it("coalesces two gapped-sequence frames arriving back-to-back into a single refetch — single-flight", async () => {
    const h = harness();
    const { result } = await mounted(h);
    h.snapshot = { ...VIEW, sequence: 9, pickNumber: 5, availablePlayerIds: ["rb1"] };
    // Both frames are gaps on their own (view.sequence is still 1), so a naive implementation
    // would fire two separate refetches — one per `void refresh()` call from the SSE handler.
    act(() => {
      h.sources[0]!.emit("draft.pick", pickPayload(9));
      h.sources[0]!.emit("draft.pick", pickPayload(20));
    });
    await waitFor(() => expect(result.current.view?.sequence).toBe(9));
    // Same count as the single-gap case above: the second resync attached to the first's
    // in-flight promise instead of starting a new fetch pair.
    expect(h.fetches.filter((f) => f === "GET /api/drafts/d1")).toHaveLength(2);
    // Players are fetched once per draftId — the mount fetch loaded them, so this resync
    // (still `d1`) never asks again.
    expect(h.fetches.filter((f) => f === "GET /api/drafts/d1/players")).toHaveLength(1);
  });

  it("fetches players once per draftId — not on every resync, but again after a draftId change", async () => {
    const h = harness();
    const { result, rerender } = renderHook(({ id }: { id: string }) => useDraftRoom(id), {
      wrapper: wrapper(h.deps),
      initialProps: { id: "d1" },
    });
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(h.fetches.filter((f) => f === "GET /api/drafts/d1/players")).toHaveLength(1);

    h.snapshot = { ...VIEW, draftId: "d2", leagueId: "l2" };
    rerender({ id: "d2" });
    await waitFor(() => expect(result.current.view?.draftId).toBe("d2"));
    expect(h.fetches.filter((f) => f === "GET /api/drafts/d2/players")).toHaveLength(1);
    // The old draft's players are never asked for again either.
    expect(h.fetches.filter((f) => f === "GET /api/drafts/d1/players")).toHaveLength(1);
  });

  it("bumps the generation on a draftId change so a slow response for the OLD draft can never overwrite the NEW draft's state", async () => {
    const oldView = VIEW;
    const newView: DraftStateView = { ...VIEW, draftId: "d2", leagueId: "l2", sequence: 7 };

    const deferred = new Map<string, { readonly promise: Promise<Response>; readonly resolve: (value: Response) => void }>();
    function deferredFor(key: string) {
      const existing = deferred.get(key);
      if (existing !== undefined) return existing;
      let resolve!: (value: Response) => void;
      const promise = new Promise<Response>((res) => {
        resolve = res;
      });
      const entry = { promise, resolve };
      deferred.set(key, entry);
      return entry;
    }

    const sources: FakeEventSource[] = [];
    const fetches: string[] = [];
    const deps: DraftRoomDeps = {
      fetchJson: async (url, init) => {
        fetches.push(`${init?.method ?? "GET"} ${url}`);
        if (url.endsWith("/players")) return jsonOf({ ok: true, data: { players: PLAYERS } });
        // The state GET for d1 or d2 — deferred, so the test controls resolution order.
        return deferredFor(url).promise;
      },
      openEventSource: (url) => {
        const source = new FakeEventSource(url);
        sources.push(source);
        return source;
      },
    };

    const { result, rerender } = renderHook(({ id }: { id: string }) => useDraftRoom(id), {
      wrapper: wrapper(deps),
      initialProps: { id: "d1" },
    });
    await waitFor(() => expect(fetches).toContain("GET /api/drafts/d1"));

    rerender({ id: "d2" });
    // A draftId change is a hard reset, not a stale-while-revalidate: the old draft's view
    // disappears immediately rather than lingering while the new one loads.
    expect(result.current.status).toBe("loading");
    expect(result.current.view).toBeNull();
    await waitFor(() => expect(fetches).toContain("GET /api/drafts/d2"));

    // Resolve the NEWER (d2) request first, then the OLDER (d1) request out of order.
    deferredFor("/api/drafts/d2").resolve(jsonOf({ ok: true, data: { draft: newView, teamId: "t1", isCommissioner: false, teams: TEAMS } }));
    await waitFor(() => expect(result.current.view?.draftId).toBe("d2"));
    // The new draft's own league stream is already open.
    expect(sources[sources.length - 1]?.url).toBe("/api/leagues/l2/events");

    deferredFor("/api/drafts/d1").resolve(jsonOf({ ok: true, data: { draft: oldView, teamId: "t1", isCommissioner: false, teams: TEAMS } }));
    // Give the stale d1 response every chance to (incorrectly) apply, if the generation guard
    // were missing — a macrotask tick flushes the whole `await`-chain in `refresh()`, not just
    // one promise's continuation, so a still-buggy implementation has room to overwrite state
    // before we assert.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(result.current.view?.draftId).toBe("d2");
    expect(result.current.view?.sequence).toBe(7);
  });

  it("refetches after a reconnect and reports the connection state while it is down", async () => {
    const h = harness();
    const { result } = await mounted(h);
    act(() => h.sources[0]!.emit("error"));
    await waitFor(() => expect(result.current.connection).toBe("reconnecting"));
    h.snapshot = { ...VIEW, sequence: 12 };
    act(() => h.sources[0]!.emit("open"));
    await waitFor(() => expect(result.current.connection).toBe("live"));
    await waitFor(() => expect(result.current.view?.sequence).toBe(12));
  });

  it("resyncs state (but not players, already cached) on the very first open — the gap between the mount snapshot and the stream opening", async () => {
    const h = harness();
    const { result } = await mounted(h);
    const stateFetchesBefore = h.fetches.filter((f) => f === "GET /api/drafts/d1").length;
    const playersFetchesBefore = h.fetches.filter((f) => f === "GET /api/drafts/d1/players").length;
    act(() => h.sources[0]!.emit("open"));
    await waitFor(() => expect(result.current.connection).toBe("live"));
    await waitFor(() => expect(h.fetches.filter((f) => f === "GET /api/drafts/d1")).toHaveLength(stateFetchesBefore + 1));
    expect(h.fetches.filter((f) => f === "GET /api/drafts/d1/players")).toHaveLength(playersFetchesBefore);
  });

  it("renders a submitted pick immediately and settles on the server's view", async () => {
    const h = harness();
    const settled = { ...VIEW, sequence: 2, pickNumber: 2, onClockTeamId: "t2", availablePlayerIds: ["rb1"], picks: [{ pickNumber: 1, round: 1, teamId: "t1", playerId: "qb1", slot: "QB" as const, slotIndex: 0, price: null, timestamp: "2026-09-01T00:05:00.000Z", auto: false }] };
    h.postResponse = { ok: true, data: { draft: settled } };
    const { result } = await mounted(h);

    let outcome: unknown;
    await act(async () => {
      outcome = await result.current.submit({ type: "MAKE_PICK", playerId: "qb1" });
    });
    expect(outcome).toEqual({ ok: true });
    expect(result.current.view?.picks).toHaveLength(1);
    expect(result.current.pendingPlayerId).toBeNull();
    expect(h.fetches).toContain("POST /api/drafts/d1/actions");
  });

  it("rolls back and reports the reducer's reason when the server rejects the action — control case, nothing else happened", async () => {
    const h = harness();
    h.postResponse = { ok: false, error: "It's not your turn to pick." };
    const { result } = await mounted(h);

    let outcome: unknown;
    await act(async () => {
      outcome = await result.current.submit({ type: "MAKE_PICK", playerId: "qb1" });
    });
    expect(outcome).toEqual({ ok: false, reason: "It's not your turn to pick." });
    expect(result.current.view?.availablePlayerIds).toEqual(["qb1", "rb1"]);
    expect(result.current.pendingPlayerId).toBeNull();
  });

  it("does not rewind a pick that lands over SSE while our POST is pending — asks the server for the truth instead of restoring the pre-submit view", async () => {
    const h = harness();
    let resolvePost!: (value: Response) => void;
    const postPromise = new Promise<Response>((resolve) => {
      resolvePost = resolve;
    });
    const inner = h.deps.fetchJson;
    h.deps = {
      ...h.deps,
      fetchJson: async (url, init) => {
        if (init?.method === "POST") return postPromise;
        return inner(url, init);
      },
    };
    const { result } = await mounted(h);

    let submitPromise!: Promise<SubmitOutcome>;
    act(() => {
      submitPromise = result.current.submit({ type: "MAKE_PICK", playerId: "qb1" });
    });

    // While our POST for qb1 is pending, team t2's REAL pick of rb1 lands over SSE — the
    // routine "someone else acted first" race in an auction bid war, here for a snake pick.
    const rivalPick = {
      draftId: "d1",
      clock: { ...VIEW, sequence: 2, pickNumber: 3, onClockTeamId: "t1" },
      pickNumber: 2,
      round: 1,
      teamId: "t2",
      playerId: "rb1",
      slot: "RB",
      slotIndex: 0,
      price: null,
      timestamp: "2026-09-01T00:06:00.000Z",
      auto: false,
    };
    act(() => h.sources[0]!.emit("draft.pick", rivalPick));
    await waitFor(() => expect(result.current.view?.picks).toHaveLength(1));

    // The server rejects OUR pick — someone else acted first — but rb1's pick already
    // landed for real, so the refetch the rejection triggers must return it too.
    h.snapshot = {
      ...VIEW,
      sequence: 2,
      pickNumber: 3,
      onClockTeamId: "t1",
      picks: [{ pickNumber: 2, round: 1, teamId: "t2", playerId: "rb1", slot: "RB", slotIndex: 0, price: null, timestamp: "2026-09-01T00:06:00.000Z", auto: false }],
      availablePlayerIds: ["qb1"],
    };
    resolvePost(jsonOf({ ok: false, error: "Someone else acted first. Try again." }));

    let outcome: SubmitOutcome | undefined;
    await act(async () => {
      outcome = await submitPromise;
    });
    await waitFor(() => expect(result.current.view?.sequence).toBe(2));

    expect(outcome).toEqual({ ok: false, reason: "Someone else acted first. Try again." });
    // The other team's real pick is still there — a plain restore to the pre-submit view
    // would have erased it.
    expect(result.current.view?.picks).toHaveLength(1);
    expect(result.current.view?.picks[0]?.teamId).toBe("t2");
    expect(result.current.pendingPlayerId).toBeNull();
  });

  it("rolls back and explains itself when the request never lands", async () => {
    const h = harness();
    const inner = h.deps.fetchJson;
    h.deps = {
      ...h.deps,
      fetchJson: async (url, init) => {
        if (init?.method === "POST") throw new Error("offline");
        return inner(url, init);
      },
    };
    const { result } = renderHook(() => useDraftRoom("d1"), { wrapper: wrapper(h.deps) });
    await waitFor(() => expect(result.current.status).toBe("ready"));

    let outcome: { readonly ok: boolean; readonly reason?: string } | undefined;
    await act(async () => {
      outcome = await result.current.submit({ type: "MAKE_PICK", playerId: "qb1" });
    });
    expect(outcome?.ok).toBe(false);
    expect(outcome?.reason).toMatch(/connection/i);
    expect(result.current.view?.availablePlayerIds).toEqual(["qb1", "rb1"]);
  });

  it("closes the stream on unmount", async () => {
    const h = harness();
    const { unmount } = await mounted(h);
    unmount();
    expect(h.sources[0]?.closed).toBe(true);
  });

  it("loads the caller's own queue with the snapshot", async () => {
    const h = harness();
    h.queue = ["rb1"];
    const { result } = await mounted(h);
    expect(result.current.queue).toEqual(["rb1"]);
  });

  it("submits a queue change optimistically and keeps the server's answer", async () => {
    const h = harness();
    h.queueResponse = { ok: true, data: { queue: ["rb1", "qb1"] } };
    const { result } = await mounted(h);
    await act(async () => {
      expect(await result.current.setQueue(["rb1", "qb1"])).toEqual({ ok: true });
    });
    expect(h.fetches).toContain("POST /api/drafts/d1/queue");
    expect(result.current.queue).toEqual(["rb1", "qb1"]);
  });

  it("rolls a rejected queue change back and reports the reason", async () => {
    const h = harness();
    h.queue = ["rb1"];
    h.queueResponse = { ok: false, error: "A queue can hold at most 50 players." };
    const { result } = await mounted(h);
    await act(async () => {
      expect(await result.current.setQueue(["rb1", "qb1"])).toEqual({
        ok: false,
        reason: "A queue can hold at most 50 players.",
      });
    });
    expect(result.current.queue).toEqual(["rb1"]);
  });

  it("does not let even my own draft.queue echo clobber the locally-held queue", async () => {
    const h = harness();
    h.queueResponse = { ok: true, data: { queue: ["rb1"] } };
    const { result } = await mounted(h);
    await act(async () => {
      await result.current.setQueue(["rb1"]);
    });
    expect(result.current.queue).toEqual(["rb1"]);

    const before = h.fetches.length;
    act(() => h.sources[0]!.emit("draft.queue", { draftId: "d1", clock: { ...VIEW, sequence: VIEW.sequence + 1 }, teamId: "t1" }));
    await waitFor(() => expect(result.current.view?.sequence).toBe(VIEW.sequence + 1));
    // The queue is untouched by the echo — no resync was needed, so no refetch happened either.
    expect(result.current.queue).toEqual(["rb1"]);
    expect(h.fetches).toHaveLength(before);
  });

  it("keeps a nudge addressed to me and drops one addressed to somebody else", async () => {
    const h = harness();
    const { result } = await mounted(h);
    act(() => h.sources[0]!.emit("draft.nudge", { draftId: "d1", clock: { ...VIEW }, teamId: "t2", message: "Not for you." }));
    expect(result.current.nudge).toBeNull();
    act(() => h.sources[0]!.emit("draft.nudge", { draftId: "d1", clock: { ...VIEW }, teamId: "t1", message: "You're up." }));
    expect(result.current.nudge).toEqual({ message: "You're up.", sequence: VIEW.sequence });
  });
});
