import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import { renderSurface } from "@/components/ui/test-utils";
import type { TradeProposalView } from "@/trades/contract";
import { HOME, ROOM_DATA } from "../test-fixtures";
import type { LineupFixPlan } from "../lib/lineup-problems";
import { MomentVerb, momentFor } from "./moment-verb";

const PLAN: LineupFixPlan = {
  problem: { slot: "WR", slotIndex: 0, reason: "bye", severity: 2, playerId: "wr2", playerName: "Zay Flowers", position: "WR" },
  candidates: [],
  hasProjections: true,
  totalBefore: null,
  totalAfter: null,
};

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
  from: { teamId: "t2", teamName: "Iron Owls", assets: [{ kind: "player", playerId: "p-owl" }] },
  to: { teamId: "t1", teamName: "Bay Bandits", assets: [{ kind: "player", playerId: "qb1" }] },
};

const CLAIM = { claimId: "c1", playerId: "p9", playerName: "Romeo Doubs", position: "WR" as const, clearsAt: "2026-09-16T13:00:00.000Z", queuePosition: 2 };

describe("momentFor", () => {
  it("puts a lineup problem before a trade offer, and answers null when nothing needs you", () => {
    expect(momentFor([PLAN], [TRADE])).toEqual({ kind: "lineup", plan: PLAN });
    expect(momentFor([], [TRADE])).toEqual({ kind: "trade", trade: TRADE });
    expect(momentFor([], [])).toBeNull();
  });
});

describe("MomentVerb", () => {
  it("renders nothing at all when nothing needs you", () => {
    const { container } = render(<MomentVerb home={HOME} plans={[]} inboxTrades={[]} tradeContext={null} pendingClaims={[]} onFixLineup={vi.fn()} onViewTrade={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("deals the lineup problem as the one verb, on the amber wash, in both themes, axe-clean", async () => {
    const onFixLineup = vi.fn();
    await renderSurface(
      <MomentVerb home={HOME} plans={[PLAN]} inboxTrades={[TRADE]} tradeContext={ROOM_DATA.tradeContext} pendingClaims={[]} onFixLineup={onFixLineup} onViewTrade={vi.fn()} />,
      async ({ container }) => {
        expect(screen.getByTestId("moment-verb").className).toContain("self-wash");
        expect(screen.getByText("Your WR1 slot starts a player on bye")).toBeInTheDocument();
        expect(screen.getByText("Then 1 trade offer waiting.")).toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: "Set your lineup" }));
        expect(onFixLineup).toHaveBeenCalledWith(PLAN);
        expect(screen.queryByRole("button", { name: "Respond to the offer" })).toBeNull();
        expect(await axe(container)).toHaveNoViolations();
      },
    );
  });

  it("deals the trade offer when the lineup is fine, and its verb opens the trade", () => {
    const onViewTrade = vi.fn();
    render(<MomentVerb home={HOME} plans={[]} inboxTrades={[TRADE]} tradeContext={ROOM_DATA.tradeContext} pendingClaims={[]} onFixLineup={vi.fn()} onViewTrade={onViewTrade} />);
    expect(screen.getByText("Iron Owls offer a player for a player")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Respond to the offer" }));
    expect(onViewTrade).toHaveBeenCalledWith(TRADE);
  });

  it("states a filed claim quietly, with no verb and no wash", () => {
    render(<MomentVerb home={HOME} plans={[]} inboxTrades={[]} tradeContext={null} pendingClaims={[CLAIM]} onFixLineup={vi.fn()} onViewTrade={vi.fn()} />);
    expect(screen.getByText(/Your claim on/)).toHaveTextContent("Romeo Doubs");
    expect(screen.getByText(/2nd in line/)).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByTestId("moment-verb").className).not.toContain("self-wash");
  });
});
