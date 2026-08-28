import { describe, it, expect } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { axe } from "vitest-axe";
import { renderSurface } from "@/components/ui/test-utils";
import type { TradeProposalView, TradesPageBody } from "@/trades/contract";
import type { TradeRoomContext } from "../contract";
import { fixtureLeagueDeps, renderInLeague } from "../test-fixtures";
import { LeagueRoomDepsProvider } from "../hooks/deps";
import { TradeInbox } from "./trade-inbox";

const CONTEXT: TradeRoomContext = {
  weekNumber: 5,
  myTeamId: "me",
  counterparties: [{ teamId: "them", teamName: "Iron Owls" }],
  rostersByTeamId: {
    me: [{ playerId: "p1", name: "Bijan Robinson", position: "RB", nflTeam: "ATL", headshotUrl: null, adp: null }],
    them: [{ playerId: "p2", name: "Puka Nacua", position: "WR", nflTeam: "ATL", headshotUrl: null, adp: null }],
  },
  leagueName: "Sunday Money",
};

const EMPTY_PAGE: TradesPageBody = { leagueId: "l1", meTeamId: "me", inbox: [], outbox: [], history: [] };

/**
 * Three days out from whenever this suite runs — what a freshly proposed offer's own
 * `TRADE_CONFIG.proposalTtlHours` window actually is. A FIXED past date would have been a time
 * bomb since the final review's HIGH 3: an open offer's Accept control now depends on whether its
 * expiry has passed, so a hard-coded date silently turns every case below into the expired card
 * on the day it goes by. These cases are about the verdict and the accept flow, never about the
 * expiry line, so "genuinely live" is the honest fixture.
 */
const LIVE_EXPIRY = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();

const INBOUND: TradeProposalView = {
  id: "t1",
  leagueId: "l1",
  weekNumber: 5,
  status: "open",
  proposedAt: "2026-08-18T00:00:00.000Z",
  expiresAt: LIVE_EXPIRY,
  settledAt: null,
  reversedAt: null,
  note: null,
  from: { teamId: "them", teamName: "Iron Owls", assets: [{ kind: "player", playerId: "p1" }] },
  to: { teamId: "me", teamName: "Bay Bandits", assets: [{ kind: "player", playerId: "p2" }] },
};

describe("TradeInbox", () => {
  it("offers the composer from an empty inbox rather than dead ending on it, in both themes, axe-clean", async () => {
    const fixture = fixtureLeagueDeps({ ok: true, data: EMPTY_PAGE });
    await renderSurface(
      <LeagueRoomDepsProvider deps={fixture.deps}>
        <TradeInbox leagueId="l1" context={CONTEXT} />
      </LeagueRoomDepsProvider>,
      async ({ container }) => {
        expect(await screen.findByRole("button", { name: "Put an offer together" })).toBeVisible();
        expect(await axe(container)).toHaveNoViolations();
      },
    );
  });

  it("opens the composer from the empty state's own button", async () => {
    const fixture = fixtureLeagueDeps({ ok: true, data: EMPTY_PAGE });
    renderInLeague(<TradeInbox leagueId="l1" context={CONTEXT} />, fixture.deps);
    fireEvent.click(await screen.findByRole("button", { name: "Put an offer together" }));
    expect(screen.getByLabelText("Trade with")).toBeInTheDocument();
  });

  it("opens the composer from the header control too, even when the inbox isn't empty", async () => {
    const page: TradesPageBody = { ...EMPTY_PAGE, history: [{ ...INBOUND, status: "rejected", settledAt: "2026-08-20T00:00:00.000Z" }] };
    const fixture = fixtureLeagueDeps({ ok: true, data: page });
    renderInLeague(<TradeInbox leagueId="l1" context={CONTEXT} />, fixture.deps);
    fireEvent.click(await screen.findByRole("button", { name: "Put an offer together" }));
    expect(screen.getByLabelText("Trade with")).toBeInTheDocument();
  });

  it("shows a loading state while the first fetch is in flight", () => {
    const fixture = fixtureLeagueDeps({ ok: true, data: EMPTY_PAGE }, { deferred: true });
    renderInLeague(<TradeInbox leagueId="l1" context={CONTEXT} />, fixture.deps);
    expect(screen.getByText("Loading…")).toBeInTheDocument();
  });

  it("says so plainly when the fetch fails, and offers a retry", async () => {
    const fixture = fixtureLeagueDeps({ ok: false, error: "Not signed in." });
    renderInLeague(<TradeInbox leagueId="l1" context={CONTEXT} />, fixture.deps);
    expect(await screen.findByText("We could not load your trades.")).toBeInTheDocument();
    expect(screen.getByText("Not signed in.")).toBeInTheDocument();

    fixture.response = { ok: true, data: EMPTY_PAGE };
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("button", { name: "Put an offer together" })).toBeInTheDocument();
  });

  it("sorts trades into their own band: offers to answer, offers out, and history", async () => {
    const page: TradesPageBody = {
      leagueId: "l1",
      meTeamId: "me",
      inbox: [INBOUND],
      outbox: [{ ...INBOUND, id: "t2", from: { ...INBOUND.to, teamId: "me" }, to: { ...INBOUND.from, teamId: "them" } }],
      history: [{ ...INBOUND, id: "t3", status: "rejected", settledAt: "2026-08-19T00:00:00.000Z" }],
    };
    const fixture = fixtureLeagueDeps({ ok: true, data: page }, { deferred: true });
    renderInLeague(<TradeInbox leagueId="l1" context={CONTEXT} />, fixture.deps);
    await fixture.settle(0, { ok: true, data: page });

    expect(await screen.findByRole("region", { name: "Offers to answer" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Offers you have out" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Trade history" })).toBeInTheDocument();
  });

  // Fix round 1, F4: the verdict is asked for, never fetched on mount — a mount fires exactly
  // one request (the page's own GET), never a second one per open offer.
  it("fetches no verdict until asked, then shows it beside the accept control, never instead of it", async () => {
    const page: TradesPageBody = { leagueId: "l1", meTeamId: "me", inbox: [INBOUND], outbox: [], history: [] };
    const fixture = fixtureLeagueDeps({ ok: true, data: page }, { deferred: true });
    renderInLeague(<TradeInbox leagueId="l1" context={CONTEXT} />, fixture.deps);
    await fixture.settle(0, { ok: true, data: page });

    expect(await screen.findByRole("button", { name: "Accept" })).toBeEnabled();
    expect(fixture.calls).toEqual(["GET /api/leagues/l1/trades"]); // no verdict call yet

    fireEvent.click(screen.getByRole("button", { name: "See what the platform thinks of this trade" }));
    expect(screen.getByText("Checking what the platform thinks of this trade.")).toBeInTheDocument();
    await fixture.settle(1, {
      ok: true,
      data: { headline: "Lopsided.", reasoning: "One side gives up far more per week.", degraded: false, verdict: "lopsided", flags: [], givingValue: 5, receivingValue: 40 },
    });
    expect(await screen.findByText(/a long way from even/i)).toBeVisible();
    expect(screen.getByRole("button", { name: "Accept" })).toBeEnabled();
  });

  // Fix round 1, F4: a failed verdict fetch used to leave the card silently missing its panel.
  it("shows an honest failure and lets the manager try again when the verdict fetch fails", async () => {
    const page: TradesPageBody = { leagueId: "l1", meTeamId: "me", inbox: [INBOUND], outbox: [], history: [] };
    const fixture = fixtureLeagueDeps({ ok: true, data: page }, { deferred: true });
    renderInLeague(<TradeInbox leagueId="l1" context={CONTEXT} />, fixture.deps);
    await fixture.settle(0, { ok: true, data: page });
    await screen.findByRole("button", { name: "Accept" });

    fireEvent.click(screen.getByRole("button", { name: "See what the platform thinks of this trade" }));
    await fixture.settle(1, { ok: false, error: "Too many trade actions in a short time. Give it a minute and try again." });
    expect(await screen.findByText(/Advice is unavailable right now\./)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await fixture.settle(2, {
      ok: true,
      data: { headline: "Even.", reasoning: "Both sides give up similar value.", degraded: false, verdict: "even", flags: [], givingValue: 10, receivingValue: 10 },
    });
    expect(await screen.findByText(/close to even/i)).toBeVisible();
  });

  it("accepts an offer through the confirm dialog, then refetches", async () => {
    const page: TradesPageBody = { leagueId: "l1", meTeamId: "me", inbox: [INBOUND], outbox: [], history: [] };
    const fixture = fixtureLeagueDeps({ ok: true, data: page }, { deferred: true });
    renderInLeague(<TradeInbox leagueId="l1" context={CONTEXT} />, fixture.deps);
    await fixture.settle(0, { ok: true, data: page });
    await screen.findByRole("button", { name: "Accept" });

    fireEvent.click(screen.getByRole("button", { name: "Accept" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm trade" }));
    await waitFor(() => expect(fixture.calls).toContain("POST /api/leagues/l1/trades/t1"));
    const acceptIndex = fixture.calls.indexOf("POST /api/leagues/l1/trades/t1");

    await fixture.settle(acceptIndex, { ok: true, data: { tradeId: "t1", status: "accepted" } });
    await waitFor(() => expect(fixture.calls.length).toBeGreaterThan(acceptIndex + 1));
    const refetchIndex = fixture.calls.length - 1;
    await fixture.settle(refetchIndex, { ok: true, data: { ...page, inbox: [] } });
    await waitFor(() => expect(screen.getByRole("button", { name: "Put an offer together" })).toBeInTheDocument());
  });
});
