import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { axe } from "vitest-axe";
import type { TradeProposalView } from "@/trades/contract";
import type { TradeRoomContext } from "../contract";
import { LeagueRoomDepsProvider, type LeagueRoomDeps } from "../hooks/deps";
import type { TradeSheetMath } from "../lib/trade-math";
import { PlayerPeekHost } from "./player-peek";
import { TradeSheet } from "./trade-sheet";

/** First response answers the assessment fetch; the second answers the decision POST. */
function capturingDeps(responses: readonly unknown[]) {
  const queue = [...responses];
  const calls: { url: string; body: unknown }[] = [];
  const deps: LeagueRoomDeps = {
    fetchJson: (url, init) => {
      calls.push({ url, body: typeof init?.body === "string" ? JSON.parse(init.body) : null });
      const response = queue.length > 1 ? queue.shift() : queue[0];
      return Promise.resolve({ json: () => Promise.resolve(response) } as Response);
    },
    openEventSource: () => ({ addEventListener: () => undefined, close: () => undefined }),
  };
  return { deps, calls };
}

const TRADE: TradeProposalView = {
  id: "trade-1",
  leagueId: "l1",
  weekNumber: 3,
  status: "open",
  proposedAt: "2026-09-14T12:00:00.000Z",
  expiresAt: "2026-09-18T21:00:00.000Z",
  settledAt: null,
  reversedAt: null,
  note: null,
  from: { teamId: "t2", teamName: "Iron Owls", assets: [{ kind: "player", playerId: "rb-gibbs" }] },
  to: { teamId: "t1", teamName: "Bay Bandits", assets: [{ kind: "player", playerId: "wr-asb" }] },
};

const CONTEXT: TradeRoomContext = {
  weekNumber: 3,
  myTeamId: "t1",
  counterparties: [{ teamId: "t2", teamName: "Iron Owls" }],
  rostersByTeamId: {},
  leagueName: "Sunday Money",
};

const MATH: TradeSheetMath = {
  receive: [{ playerId: "rb-gibbs", name: "Jahmyr Gibbs", position: "RB", nflTeam: "DET", weekProjection: 15.1, byeWeek: 8 }],
  send: [{ playerId: "wr-asb", name: "Amon-Ra St. Brown", position: "WR", nflTeam: "DET", weekProjection: 14.0, byeWeek: 8 }],
  depthBefore: { WR: 5, RB: 2 },
  depthAfter: { WR: 4, RB: 3 },
  byes: { shared: [8], gained: [], cleared: [] },
};

const ASSESSMENT = {
  ok: true,
  data: { verdict: "fair", flags: [], givingValue: 231.9, receivingValue: 248.3, headline: "", reasoning: [], degraded: false },
};

const sheet = (deps: LeagueRoomDeps, onDecided = vi.fn(), onCounter = vi.fn()) => (
  <LeagueRoomDepsProvider deps={deps}>
    <TradeSheet
      leagueId="l1"
      trade={TRADE}
      context={CONTEXT}
      math={MATH}
      onClose={vi.fn()}
      onCounter={onCounter}
      onDecided={onDecided}
    />
  </LeagueRoomDepsProvider>
);

describe("TradeSheet", () => {
  it("prices both sides with the week projection, the bye, and the assessment's side values", async () => {
    render(sheet(capturingDeps([ASSESSMENT]).deps));
    expect(screen.getByText("Jahmyr Gibbs")).toBeTruthy();
    expect(screen.getByText("Amon-Ra St. Brown")).toBeTruthy();
    expect(screen.getAllByText(/bye week 8/)).toHaveLength(2);
    expect(screen.getByText("15.1")).toBeTruthy();
    await waitFor(() => expect(screen.getByText("side value 248")).toBeTruthy());
    expect(screen.getByText("side value 232")).toBeTruthy();
  });

  // Task 4 (player-name adoption sweep): each asset's name is a bare `<p>` with no other control
  // on its row, so it goes straight through `PlayerName`.
  it("makes every asset's name a pressable button that opens the season peek, axe-clean", async () => {
    const base = capturingDeps([ASSESSMENT]).deps;
    // The season-peek fetch (`/player-season`) answers `ok: false` — `capturingDeps` otherwise
    // hands every call the same assessment envelope, which is not a `PlayerSeasonBody`.
    const deps: LeagueRoomDeps = {
      ...base,
      fetchJson: (url, init) =>
        url.includes("/player-season")
          ? Promise.resolve({ json: () => Promise.resolve({ ok: false, error: "not available" }) } as Response)
          : base.fetchJson(url, init),
    };
    const { container } = render(
      <LeagueRoomDepsProvider deps={deps}>
        <PlayerPeekHost />
        <TradeSheet leagueId="l1" trade={TRADE} context={CONTEXT} math={MATH} onClose={vi.fn()} onCounter={vi.fn()} onDecided={vi.fn()} />
      </LeagueRoomDepsProvider>,
    );
    const name = screen.getByRole("button", { name: "Jahmyr Gibbs" });
    expect(await axe(container)).toHaveNoViolations();
    await act(async () => {
      fireEvent.click(name);
    });
    expect(screen.getByRole("dialog", { name: "Jahmyr Gibbs" })).toBeInTheDocument();
  });

  it("asks the advisor endpoint from the viewer's own seat", async () => {
    const { deps, calls } = capturingDeps([ASSESSMENT]);
    render(sheet(deps));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]?.url).toBe("/api/leagues/l1/advisor/trade");
    expect(calls[0]?.body).toEqual({
      weekNumber: 3,
      counterpartyTeamId: "t2",
      give: ["wr-asb"],
      receive: ["rb-gibbs"],
    });
  });

  it("draws roster depth before and after, and clears the bye question", () => {
    render(sheet(capturingDeps([ASSESSMENT]).deps));
    expect(screen.getByText("5 becomes 4")).toBeTruthy();
    expect(screen.getByText("2 becomes 3")).toBeTruthy();
    expect(screen.getByText("Same bye week both ways, nothing new to cover.")).toBeTruthy();
  });

  it("offers three verbs with accept as the one that commits, and reports each accept outcome", async () => {
    const { deps, calls } = capturingDeps([ASSESSMENT, { ok: true, data: { tradeId: "trade-1", status: "under_review" } }]);
    const onDecided = vi.fn();
    render(sheet(deps, onDecided));
    expect(screen.getByRole("button", { name: "Decline" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Counter" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Accept trade" }));
    await waitFor(() => expect(screen.getByText(/review window before it executes/)).toBeTruthy());
    expect(calls.at(-1)?.url).toBe("/api/leagues/l1/trades/trade-1");
    expect(calls.at(-1)?.body).toEqual({ action: "accept" });
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(onDecided).toHaveBeenCalledTimes(1);
  });

  it("counter hands off to the trades surface without deciding anything", () => {
    const onCounter = vi.fn();
    render(sheet(capturingDeps([ASSESSMENT]).deps, vi.fn(), onCounter));
    fireEvent.click(screen.getByRole("button", { name: "Counter" }));
    expect(onCounter).toHaveBeenCalledTimes(1);
  });

  it("offers only withdraw on the viewer's own outgoing offer", () => {
    const outgoing = { ...TRADE, from: TRADE.to, to: TRADE.from };
    render(
      <LeagueRoomDepsProvider deps={capturingDeps([ASSESSMENT]).deps}>
        <TradeSheet
          leagueId="l1"
          trade={outgoing}
          context={CONTEXT}
          math={MATH}
          onClose={vi.fn()}
          onCounter={vi.fn()}
          onDecided={vi.fn()}
        />
      </LeagueRoomDepsProvider>,
    );
    expect(screen.getByRole("button", { name: "Withdraw offer" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Accept trade" })).toBeNull();
  });

  it("still stands when the assessment is unavailable, with no invented values", async () => {
    render(sheet(capturingDeps([{ ok: false, error: "unavailable" }]).deps));
    await waitFor(() => expect(screen.queryByText(/Valuing both sides/)).toBeNull());
    expect(screen.queryByText(/side value/)).toBeNull();
    expect(screen.getByRole("button", { name: "Accept trade" })).toBeTruthy();
  });
});
