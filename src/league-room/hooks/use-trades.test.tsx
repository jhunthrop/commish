import { describe, it, expect } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import type { TradesPageBody } from "@/trades/contract";
import { fixtureLeagueDeps } from "../test-fixtures";
import { LeagueRoomDepsProvider } from "./deps";
import { useTrades } from "./use-trades";

const EMPTY_PAGE: TradesPageBody = { leagueId: "l1", meTeamId: "me", inbox: [], outbox: [], history: [] };

function wrapper(deps: ReturnType<typeof fixtureLeagueDeps>["deps"]) {
  return function Wrapper({ children }: { readonly children: ReactNode }) {
    return <LeagueRoomDepsProvider deps={deps}>{children}</LeagueRoomDepsProvider>;
  };
}

describe("useTrades", () => {
  it("fetches the caller's own three bands on mount", async () => {
    const page: TradesPageBody = { ...EMPTY_PAGE, meTeamId: "t1" };
    const fixture = fixtureLeagueDeps({ ok: true, data: page });
    const { result } = renderHook(() => useTrades("l1"), { wrapper: wrapper(fixture.deps) });

    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.meTeamId).toBe("t1");
    expect(fixture.calls).toEqual(["GET /api/leagues/l1/trades"]);
  });

  it("surfaces the server's own error and offers a working refetch", async () => {
    const fixture = fixtureLeagueDeps({ ok: false, error: "Not signed in." });
    const { result } = renderHook(() => useTrades("l1"), { wrapper: wrapper(fixture.deps) });

    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.error).toBe("Not signed in.");

    fixture.response = { ok: true, data: EMPTY_PAGE };
    await act(() => result.current.refetch());
    expect(result.current.status).toBe("ready");
  });

  it("proposes a trade, naming only the counterparty and the assets, and refetches on success", async () => {
    const fixture = fixtureLeagueDeps({ ok: true, data: EMPTY_PAGE });
    const { result } = renderHook(() => useTrades("l1"), { wrapper: wrapper(fixture.deps) });
    await waitFor(() => expect(result.current.status).toBe("ready"));

    fixture.response = { ok: true, data: { tradeId: "t1", verdict: { givingValue: 10, receivingValue: 12, delta: -2, verdict: "even", flags: [] } } };
    const outcome = await act(() =>
      result.current.propose({
        counterpartyTeamId: "them",
        weekNumber: 5,
        proposerAssets: [{ kind: "player", playerId: "p1" }],
        counterpartyAssets: [{ kind: "player", playerId: "p2" }],
        note: null,
      }),
    );

    expect(outcome).toEqual({ ok: true, data: { tradeId: "t1", verdict: { givingValue: 10, receivingValue: 12, delta: -2, verdict: "even", flags: [] } } });
    expect(fixture.calls).toEqual([
      "GET /api/leagues/l1/trades",
      "POST /api/leagues/l1/trades",
      "GET /api/leagues/l1/trades",
    ]);
  });

  it("decides an offer (accept/reject/withdraw) against the trade's own route, and refetches on success", async () => {
    const fixture = fixtureLeagueDeps({ ok: true, data: EMPTY_PAGE });
    const { result } = renderHook(() => useTrades("l1"), { wrapper: wrapper(fixture.deps) });
    await waitFor(() => expect(result.current.status).toBe("ready"));

    fixture.response = { ok: true, data: { tradeId: "t1", status: "accepted" } };
    const outcome = await act(() => result.current.decide("t1", "accept"));

    expect(outcome).toEqual({ ok: true, data: { tradeId: "t1", status: "accepted" } });
    expect(fixture.calls).toContain("POST /api/leagues/l1/trades/t1");
  });

  it("does not refetch when a mutation fails", async () => {
    const fixture = fixtureLeagueDeps({ ok: true, data: EMPTY_PAGE });
    const { result } = renderHook(() => useTrades("l1"), { wrapper: wrapper(fixture.deps) });
    await waitFor(() => expect(result.current.status).toBe("ready"));

    fixture.response = { ok: false, error: "You can't trade with your own team." };
    await act(() =>
      result.current.propose({ counterpartyTeamId: "me", weekNumber: 5, proposerAssets: [{ kind: "player", playerId: "p1" }], counterpartyAssets: [{ kind: "player", playerId: "p2" }], note: null }),
    );

    expect(fixture.calls).toEqual(["GET /api/leagues/l1/trades", "POST /api/leagues/l1/trades"]);
  });

  it("assesses a trade against the advisor route, without any mutation or refetch", async () => {
    const fixture = fixtureLeagueDeps({ ok: true, data: EMPTY_PAGE });
    const { result } = renderHook(() => useTrades("l1"), { wrapper: wrapper(fixture.deps) });
    await waitFor(() => expect(result.current.status).toBe("ready"));

    fixture.response = { ok: true, data: { headline: "x", reasoning: "y", degraded: false, verdict: "even", flags: [], givingValue: 10, receivingValue: 10 } };
    const outcome = await act(() => result.current.assess({ weekNumber: 5, counterpartyTeamId: "them", give: ["p1"], receive: ["p2"] }));

    expect(outcome.ok).toBe(true);
    expect(fixture.calls).toEqual(["GET /api/leagues/l1/trades", "POST /api/leagues/l1/advisor/trade"]);
  });

  it("guards a slow mount fetch against a faster later write, the same generation idiom useNotices uses", async () => {
    const fixture = fixtureLeagueDeps({ ok: true, data: EMPTY_PAGE }, { deferred: true });
    const { result } = renderHook(() => useTrades("l1"), { wrapper: wrapper(fixture.deps) });

    // The mount fetch (index 0) is still in flight when an explicit refetch (index 1) is fired
    // and resolves FIRST with newer data.
    const freshPage: TradesPageBody = { leagueId: "l1", meTeamId: "fresh", inbox: [], outbox: [], history: [] };
    await waitFor(() => expect(fixture.pending()).toBe(1)); // the mount fetch, in flight
    act(() => {
      void result.current.refetch();
    });
    await waitFor(() => expect(fixture.pending()).toBe(2));
    await act(async () => {
      await fixture.settle(1, { ok: true, data: freshPage });
    });
    expect(result.current.meTeamId).toBe("fresh");

    // The stale mount fetch resolving afterward must NOT clobber the fresher state.
    await act(async () => {
      await fixture.settle(0, { ok: true, data: { ...EMPTY_PAGE, meTeamId: "stale" } });
    });
    expect(result.current.meTeamId).toBe("fresh");
  });
});
