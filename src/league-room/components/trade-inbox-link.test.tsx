import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import { renderSurface } from "@/components/ui/test-utils";
import type { TradesPageBody } from "@/trades/contract";
import { LeagueRoomDepsProvider } from "../hooks/deps";
import { fixtureLeagueDeps, renderInLeague } from "../test-fixtures";
import { TradeInboxLink } from "./trade-inbox-link";

const EMPTY_PAGE: TradesPageBody = { leagueId: "l1", meTeamId: "t1", inbox: [], outbox: [], history: [] };

describe("TradeInboxLink", () => {
  it("links to the league's trades page, with no badge when nothing is waiting, in both themes, axe-clean", async () => {
    const fixture = fixtureLeagueDeps({ ok: true, data: EMPTY_PAGE });
    await renderSurface(
      <LeagueRoomDepsProvider deps={fixture.deps}>
        <TradeInboxLink leagueId="l1" />
      </LeagueRoomDepsProvider>,
      async ({ container }) => {
        const link = await screen.findByRole("link", { name: /Trades/ });
        expect(link).toHaveAttribute("href", "/app/leagues/l1/trades");
        expect(screen.queryByText(/^\d+$/)).not.toBeInTheDocument();
        expect(await axe(container)).toHaveNoViolations();
      },
    );
  });

  it("counts offers waiting on the caller's own answer", async () => {
    const page: TradesPageBody = {
      ...EMPTY_PAGE,
      inbox: [
        {
          id: "t1", leagueId: "l1", weekNumber: 5, status: "open", proposedAt: "x", expiresAt: "y", settledAt: null, reversedAt: null, note: null,
          from: { teamId: "them", teamName: "Iron Owls", assets: [{ kind: "player", playerId: "p1" }] },
          to: { teamId: "t1", teamName: "Bay Bandits", assets: [{ kind: "player", playerId: "p2" }] },
        },
      ],
    };
    const fixture = fixtureLeagueDeps({ ok: true, data: page });
    renderInLeague(<TradeInboxLink leagueId="l1" />, fixture.deps);
    expect(await screen.findByText("1")).toBeInTheDocument();
  });
});
