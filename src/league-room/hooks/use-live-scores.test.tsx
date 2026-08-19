import { describe, it, expect } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import type { MatchupWeekBody } from "../contract";
import { fixtureLeagueDeps } from "../test-fixtures";
import { LeagueRoomDepsProvider, type LeagueRoomDeps } from "./deps";
import { useLiveScores, type LiveScoresInitial } from "./use-live-scores";

function wrapper(deps: LeagueRoomDeps) {
  return function Wrapper({ children }: { readonly children: ReactNode }) {
    return <LeagueRoomDepsProvider deps={deps}>{children}</LeagueRoomDepsProvider>;
  };
}

const INITIAL: LiveScoresInitial = {
  week: 5,
  status: "in_progress",
  scores: [
    { teamId: "t1", points: 12 },
    { teamId: "t2", points: 9 },
  ],
};

const WEEK_BODY: MatchupWeekBody = {
  leagueId: "l1",
  weekNumber: 5,
  totalWeeks: 14,
  myTeamId: "t1",
  weekStatus: "in_progress",
  matchups: [
    {
      weekNumber: 5,
      final: false,
      weekStatus: "in_progress",
      home: { teamId: "t1", teamName: "Bay Bandits", score: 12, starters: [], bench: [] },
      away: { teamId: "t2", teamName: "Iron Owls", score: 9, starters: [], bench: [] },
    },
  ],
};

describe("useLiveScores", () => {
  it("seeds from the initial snapshot before any frame arrives", async () => {
    const fixture = fixtureLeagueDeps({ ok: true, data: WEEK_BODY });
    const { result } = renderHook(() => useLiveScores("l1", INITIAL), { wrapper: wrapper(fixture.deps) });
    expect(result.current.scores.get("t1")).toBe(12);
    expect(result.current.status).toBe("in_progress");
    expect(result.current.connection).toBe("connecting");
  });

  it("folds a score.update frame's teams and status in", async () => {
    const fixture = fixtureLeagueDeps({ ok: true, data: WEEK_BODY });
    const { result } = renderHook(() => useLiveScores("l1", INITIAL), { wrapper: wrapper(fixture.deps) });

    act(() =>
      fixture.emit("score.update", {
        week: 5, status: "in_progress", version: 1, gamesFinal: 0, gamesTotal: 4,
        scores: [{ teamId: "t1", points: 17 }],
      }),
    );
    await waitFor(() => expect(result.current.scores.get("t1")).toBe(17));
    // A frame that only names t1 must not erase t2's last-known score.
    expect(result.current.scores.get("t2")).toBe(9);
  });

  it("moves the week to final once a frame says so", async () => {
    const fixture = fixtureLeagueDeps({ ok: true, data: WEEK_BODY });
    const { result } = renderHook(() => useLiveScores("l1", INITIAL), { wrapper: wrapper(fixture.deps) });

    act(() =>
      fixture.emit("score.update", {
        week: 5, status: "final", version: 3, gamesFinal: 4, gamesTotal: 4,
        scores: [{ teamId: "t1", points: 24 }, { teamId: "t2", points: 18 }],
      }),
    );
    await waitFor(() => expect(result.current.status).toBe("final"));
  });

  // The one behavior this hook adds on top of the chat idiom it otherwise copies: frames can
  // reorder across a reconnect, and folding an older one over a newer one would make a score go
  // backwards on screen — in a money product, that reads as a bug at the worst possible moment.
  it("drops a frame carrying a stale version", async () => {
    const fixture = fixtureLeagueDeps({ ok: true, data: WEEK_BODY });
    const { result } = renderHook(() => useLiveScores("l1", INITIAL), { wrapper: wrapper(fixture.deps) });

    act(() =>
      fixture.emit("score.update", {
        week: 5, status: "in_progress", version: 5, gamesFinal: 1, gamesTotal: 4,
        scores: [{ teamId: "t1", points: 20 }],
      }),
    );
    await waitFor(() => expect(result.current.scores.get("t1")).toBe(20));

    // Version 2 arrives AFTER version 5 — exactly the reorder a reconnect can produce.
    act(() =>
      fixture.emit("score.update", {
        week: 5, status: "in_progress", version: 2, gamesFinal: 0, gamesTotal: 4,
        scores: [{ teamId: "t1", points: 3 }],
      }),
    );
    // Nothing to await FOR (the assertion is that nothing changed) — give the listener a tick
    // and assert the newer value held.
    await Promise.resolve();
    expect(result.current.scores.get("t1")).toBe(20);
  });

  it("ignores a frame it doesn't own", async () => {
    const fixture = fixtureLeagueDeps({ ok: true, data: WEEK_BODY });
    const { result } = renderHook(() => useLiveScores("l1", INITIAL), { wrapper: wrapper(fixture.deps) });
    act(() => fixture.emit("chat.message", { message: { id: "1" } }));
    await Promise.resolve();
    expect(result.current.scores.get("t1")).toBe(12);
  });

  it("drops a malformed frame instead of throwing", async () => {
    const fixture = fixtureLeagueDeps({ ok: true, data: WEEK_BODY });
    const { result } = renderHook(() => useLiveScores("l1", INITIAL), { wrapper: wrapper(fixture.deps) });
    expect(() => act(() => fixture.emit("score.update", { week: "banana" }))).not.toThrow();
    await Promise.resolve();
    expect(result.current.scores.get("t1")).toBe(12);
  });

  it("tracks the connection and resyncs on every open", async () => {
    const fixture = fixtureLeagueDeps({ ok: true, data: WEEK_BODY });
    const { result } = renderHook(() => useLiveScores("l1", INITIAL), { wrapper: wrapper(fixture.deps) });

    act(() => fixture.fire("open"));
    await waitFor(() => expect(result.current.connection).toBe("live"));
    expect(fixture.calls.filter((call) => call === "GET /api/leagues/l1/matchups/5")).toHaveLength(2);

    act(() => fixture.fire("error"));
    await waitFor(() => expect(result.current.connection).toBe("reconnecting"));
  });

  it("replaces the whole snapshot on refetch, not a merge", async () => {
    const fixture = fixtureLeagueDeps({ ok: true, data: WEEK_BODY });
    const { result } = renderHook(() => useLiveScores("l1", INITIAL), { wrapper: wrapper(fixture.deps) });
    await waitFor(() => expect(fixture.calls).toContain("GET /api/leagues/l1/matchups/5"));

    fixture.response = {
      ok: true,
      data: { ...WEEK_BODY, weekStatus: "final", matchups: [{ ...WEEK_BODY.matchups[0]!, final: true, weekStatus: "final", home: { ...WEEK_BODY.matchups[0]!.home, score: 30 }, away: { ...WEEK_BODY.matchups[0]!.away, score: 22 } }] },
    };
    act(() => fixture.fire("open"));
    await waitFor(() => expect(result.current.status).toBe("final"));
    expect(result.current.scores.get("t1")).toBe(30);
    expect(result.current.scores.get("t2")).toBe(22);
  });

  it("leaves the last-known state alone when the background refresh fails", async () => {
    const fixture = fixtureLeagueDeps({ ok: true, data: WEEK_BODY });
    fixture.deps = {
      ...fixture.deps,
      fetchJson: async () => {
        throw new Error("offline");
      },
    };
    const { result } = renderHook(() => useLiveScores("l1", INITIAL), { wrapper: wrapper(fixture.deps) });
    await Promise.resolve();
    await Promise.resolve();
    expect(result.current.scores.get("t1")).toBe(12);
    expect(result.current.status).toBe("in_progress");
  });
});
