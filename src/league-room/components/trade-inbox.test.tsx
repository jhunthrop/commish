import { describe, it, expect } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { axe } from "vitest-axe";
import { inBothThemes } from "@/components/ui/test-utils";
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
    me: [{ playerId: "p1", name: "Bijan Robinson", position: "RB" }],
    them: [{ playerId: "p2", name: "Puka Nacua", position: "WR" }],
  },
};

const EMPTY_PAGE: TradesPageBody = { leagueId: "l1", meTeamId: "me", inbox: [], outbox: [], history: [] };

const INBOUND: TradeProposalView = {
  id: "t1",
  leagueId: "l1",
  weekNumber: 5,
  status: "open",
  proposedAt: "2026-08-18T00:00:00.000Z",
  expiresAt: "2026-08-21T00:00:00.000Z",
  settledAt: null,
  reversedAt: null,
  note: null,
  from: { teamId: "them", teamName: "Iron Owls", assets: [{ kind: "player", playerId: "p1" }] },
  to: { teamId: "me", teamName: "Bay Bandits", assets: [{ kind: "player", playerId: "p2" }] },
};

describe("TradeInbox", () => {
  it("offers the composer from an empty inbox rather than dead ending on it, in both themes, axe-clean", async () => {
    const fixture = fixtureLeagueDeps({ ok: true, data: EMPTY_PAGE });
    await inBothThemes(
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
    const page: TradesPageBody = { ...EMPTY_PAGE, history: [{ ...INBOUND, status: "rejected", settledAt: "x" }] };
    const fixture = fixtureLeagueDeps({ ok: true, data: page });
    renderInLeague(<TradeInbox leagueId="l1" context={CONTEXT} />, fixture.deps);
    fireEvent.click(await screen.findByRole("button", { name: "Propose a trade" }));
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
    expect(await screen.findByText("We couldn't load your trades.")).toBeInTheDocument();
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
    expect(screen.getByRole("region", { name: "Completed trades" })).toBeInTheDocument();
  });

  it("shows the verdict beside the accept control, never instead of it, for an offer awaiting an answer", async () => {
    const page: TradesPageBody = { leagueId: "l1", meTeamId: "me", inbox: [INBOUND], outbox: [], history: [] };
    const fixture = fixtureLeagueDeps({ ok: true, data: page }, { deferred: true });
    renderInLeague(<TradeInbox leagueId="l1" context={CONTEXT} />, fixture.deps);
    await fixture.settle(0, { ok: true, data: page });

    expect(await screen.findByRole("button", { name: "Accept" })).toBeEnabled();
    await fixture.settle(1, {
      ok: true,
      data: { headline: "Lopsided.", reasoning: "One side gives up far more per week.", degraded: false, verdict: "lopsided", flags: [], givingValue: 5, receivingValue: 40 },
    });
    expect(await screen.findByText(/a long way from even/i)).toBeVisible();
    expect(screen.getByRole("button", { name: "Accept" })).toBeEnabled();
  });

  it("accepts an offer through the confirm dialog, then refetches", async () => {
    const page: TradesPageBody = { leagueId: "l1", meTeamId: "me", inbox: [INBOUND], outbox: [], history: [] };
    const fixture = fixtureLeagueDeps({ ok: true, data: page }, { deferred: true });
    renderInLeague(<TradeInbox leagueId="l1" context={CONTEXT} />, fixture.deps);
    await fixture.settle(0, { ok: true, data: page });
    await screen.findByRole("button", { name: "Accept" });

    // Call 1 is the per-card advisory assess; let it resolve out of the way first.
    await fixture.settle(1, { ok: true, data: { headline: "x", reasoning: "y", degraded: false, verdict: "even", flags: [], givingValue: 10, receivingValue: 10 } });

    fireEvent.click(screen.getByRole("button", { name: "Accept" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm accept" }));
    await waitFor(() => expect(fixture.calls).toContain("POST /api/leagues/l1/trades/t1"));
    const acceptIndex = fixture.calls.indexOf("POST /api/leagues/l1/trades/t1");

    await fixture.settle(acceptIndex, { ok: true, data: { tradeId: "t1", status: "accepted" } });
    await waitFor(() => expect(fixture.calls.length).toBeGreaterThan(acceptIndex + 1));
    const refetchIndex = fixture.calls.length - 1;
    await fixture.settle(refetchIndex, { ok: true, data: { ...page, inbox: [] } });
    await waitFor(() => expect(screen.getByRole("button", { name: "Put an offer together" })).toBeInTheDocument());
  });
});
