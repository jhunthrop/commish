import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import type { DraftStateView } from "@/draft-engine";
import { DraftRoomDepsProvider, type DraftRoomDeps, type EventSourceLike } from "./deps";
import { useDraftRoom } from "./use-draft-room";

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
}

function harness(): Harness {
  const state: Harness = {
    sources: [],
    fetches: [],
    snapshot: VIEW,
    postResponse: null,
    deps: {
      fetchJson: async (url, init) => {
        state.fetches.push(`${init?.method ?? "GET"} ${url}`);
        if (url.endsWith("/players")) return jsonOf({ ok: true, data: { players: PLAYERS } });
        if (init?.method === "POST") return jsonOf(state.postResponse);
        return jsonOf({ ok: true, data: { draft: state.snapshot, teamId: "t1", isCommissioner: false, teams: TEAMS } });
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

  it("does not refetch on the first open — only after a drop", async () => {
    const h = harness();
    const { result } = await mounted(h);
    const before = h.fetches.length;
    act(() => h.sources[0]!.emit("open"));
    await waitFor(() => expect(result.current.connection).toBe("live"));
    expect(h.fetches).toHaveLength(before);
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

  it("rolls back and reports the reducer's reason when the server rejects the action", async () => {
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
});
