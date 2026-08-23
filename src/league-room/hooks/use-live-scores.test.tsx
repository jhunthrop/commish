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
      median: null,
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

  it("ignores a frame for a different week, however new its version", async () => {
    // The SSE stream is per LEAGUE; `stat_weeks.version` is per WEEK. A tick publishes for the
    // week it examined, and team ids are stable across weeks within a league — so a frame for
    // another week merged straight over this week's totals, under this week's header, with that
    // week's status. Most reachable trigger: a manager leaves last week's matchup page open on
    // Sunday, the current week settles, and last week repaints with this week's scores marked
    // Final.
    const fixture = fixtureLeagueDeps({ ok: true, data: WEEK_BODY });
    const { result } = renderHook(() => useLiveScores("l1", INITIAL), { wrapper: wrapper(fixture.deps) });

    act(() =>
      fixture.emit("score.update", {
        week: 6, status: "final", version: 99, gamesFinal: 4, gamesTotal: 4,
        scores: [{ teamId: "t1", points: 101 }, { teamId: "t2", points: 88 }],
      }),
    );

    expect(result.current.scores.get("t1")).toBe(12);
    expect(result.current.scores.get("t2")).toBe(9);
    expect(result.current.status).toBe("in_progress");

    // And the foreign frame did not poison the version gate either: this week's next frame,
    // whose version is far lower than the one that was ignored, still applies.
    act(() =>
      fixture.emit("score.update", {
        week: 5, status: "in_progress", version: 2, gamesFinal: 1, gamesTotal: 4,
        scores: [{ teamId: "t1", points: 20 }],
      }),
    );
    await waitFor(() => expect(result.current.scores.get("t1")).toBe(20));
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

  // Task 8 review, FIX 2: the report claimed this race was "tested adversarially", but no test
  // constructed it — deleting the guard at use-live-scores.ts left all 9 original tests green.
  // This is the scenario the guard exists for: a refetch is already in flight (the mount effect
  // fired it) when a FRESHER score.update frame lands, and only THEN does the refetch resolve,
  // carrying data that was already stale the moment it arrived. Without the
  // `versionRef.current !== versionBeforeRequest` guard, this test fails — the refetch's older
  // snapshot clobbers the frame's newer values.
  it("keeps a fresher live frame's values when an in-flight refetch resolves after it, carrying older data", async () => {
    const fixture = fixtureLeagueDeps({ ok: true, data: WEEK_BODY }, { deferred: true });
    const { result } = renderHook(() => useLiveScores("l1", INITIAL), { wrapper: wrapper(fixture.deps) });
    await waitFor(() => expect(fixture.pending()).toBe(1)); // the mount refresh, in flight

    // A live frame lands WHILE the refetch above is still pending — strictly newer information.
    act(() =>
      fixture.emit("score.update", {
        week: 5, status: "final", version: 9, gamesFinal: 4, gamesTotal: 4,
        scores: [{ teamId: "t1", points: 40 }, { teamId: "t2", points: 33 }],
      }),
    );
    await waitFor(() => expect(result.current.scores.get("t1")).toBe(40));
    expect(result.current.status).toBe("final");

    // NOW the in-flight refetch resolves, carrying the OLDER snapshot it was issued to fetch —
    // this is the exact reorder the guard exists for.
    await act(async () => {
      await fixture.settle(0, { ok: true, data: WEEK_BODY });
    });

    // The frame's newer values must still hold — a score going backwards on screen reads as a
    // bug at the worst possible moment.
    expect(result.current.scores.get("t1")).toBe(40);
    expect(result.current.scores.get("t2")).toBe(33);
    expect(result.current.status).toBe("final");
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
