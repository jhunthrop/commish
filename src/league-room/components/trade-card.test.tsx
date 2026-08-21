import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { axe } from "vitest-axe";
import { inBothThemes } from "@/components/ui/test-utils";
import type { TradeProposalView } from "@/trades/contract";
import type { ValuedPlayer } from "@/trades/fairness";
import type { TradeAssessmentSummary } from "./trade-verdict";
import { TradeCard } from "./trade-card";

const PLAYERS: Readonly<Record<string, ValuedPlayer>> = {
  p1: { playerId: "p1", name: "Bijan Robinson", position: "RB", averagePoints: 18.2 },
  p2: { playerId: "p2", name: "Puka Nacua", position: "WR", averagePoints: 15.4 },
  p3: { playerId: "p3", name: "Sam LaPorta", position: "TE", averagePoints: 10.1 },
};

const BASE: TradeProposalView = {
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

const LOPSIDED_ASSESSMENT: TradeAssessmentSummary = { verdict: "lopsided", givingValue: 40, receivingValue: 5 };

describe("TradeCard", () => {
  it("shows the verdict beside the accept control, never instead of it, in both themes, axe-clean", async () => {
    await inBothThemes(
      <TradeCard trade={BASE} meTeamId="me" playersById={PLAYERS} assessment={LOPSIDED_ASSESSMENT} />,
      async ({ container }) => {
        expect(screen.getByText(/a long way from even/i)).toBeVisible();
        expect(screen.getByRole("button", { name: "Accept" })).toBeEnabled();
        expect(screen.getByRole("button", { name: "Decline" })).toBeEnabled();
        expect(await axe(container)).toHaveNoViolations();
      },
    );
  });

  it("renders both sides through PositionBadge and a name, framed as what you give and get", () => {
    render(<TradeCard trade={BASE} meTeamId="me" playersById={PLAYERS} />);
    expect(screen.getByText("You give")).toBeInTheDocument();
    expect(screen.getByText("You get")).toBeInTheDocument();
    expect(screen.getByText("Puka Nacua")).toBeInTheDocument();
    expect(screen.getByText("WR")).toBeInTheDocument();
    expect(screen.getByText("Bijan Robinson")).toBeInTheDocument();
    expect(screen.getByText("RB")).toBeInTheDocument();
  });

  it("degrades a player no longer on any roster to a neutral label instead of a raw id", () => {
    const trade: TradeProposalView = { ...BASE, from: { ...BASE.from, assets: [{ kind: "player", playerId: "ghost" }] } };
    render(<TradeCard trade={trade} meTeamId="me" playersById={PLAYERS} />);
    expect(screen.getByText("a player no longer on this roster")).toBeInTheDocument();
  });

  it("keeps the accept and decline controls in a spaced row, not touching, at 360px", () => {
    // happy-dom performs no real CSS layout, so a pixel-geometry assertion here would always
    // read every rect as zero regardless of the markup — asserting the deliberate `gap-4`
    // utility on their shared row is what this environment can actually prove, and is the class
    // the 360px baseline (`docs/design-system.md`) actually renders spacing from.
    render(<TradeCard trade={BASE} meTeamId="me" playersById={PLAYERS} />);
    const accept = screen.getByRole("button", { name: "Accept" });
    const row = accept.parentElement!;
    expect(row).toContainElement(screen.getByRole("button", { name: "Decline" }));
    expect(row.className).toMatch(/\bgap-4\b/);
  });

  it("asks once before it accepts, because nothing undoes it", () => {
    const onAccept = vi.fn();
    render(<TradeCard trade={BASE} meTeamId="me" playersById={PLAYERS} onAccept={onAccept} />);
    fireEvent.click(screen.getByRole("button", { name: "Accept" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("Both rosters change as soon as you accept. You can't undo it.");
    expect(onAccept).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Confirm accept" }));
    expect(onAccept).toHaveBeenCalledWith("t1");
  });

  it("declines with no confirmation, since a decline changes nothing that can't be re-offered", () => {
    const onDecline = vi.fn();
    render(<TradeCard trade={BASE} meTeamId="me" playersById={PLAYERS} onDecline={onDecline} />);
    fireEvent.click(screen.getByRole("button", { name: "Decline" }));
    expect(onDecline).toHaveBeenCalledWith("t1");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("offers no accept control to the proposer, and offers a withdraw instead", () => {
    const onWithdraw = vi.fn();
    render(<TradeCard trade={BASE} meTeamId="them" playersById={PLAYERS} onWithdraw={onWithdraw} />);
    expect(screen.queryByRole("button", { name: "Accept" })).not.toBeInTheDocument();
    expect(screen.getByText("Waiting for a reply.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Withdraw" }));
    expect(onWithdraw).toHaveBeenCalledWith("t1");
  });

  it("renders a superseded offer with what happened, not with a blank status", () => {
    const trade: TradeProposalView = { ...BASE, status: "superseded", settledAt: "2026-08-19T00:00:00.000Z" };
    render(<TradeCard trade={trade} meTeamId="me" playersById={PLAYERS} />);
    expect(screen.getByText(/moved to another team/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Accept" })).toBeNull();
  });

  it("renders a reversed trade as reversed, in the history where it still belongs", () => {
    const trade: TradeProposalView = {
      ...BASE,
      status: "accepted",
      settledAt: "2026-08-19T00:00:00.000Z",
      reversedAt: "2026-08-20T00:00:00.000Z",
    };
    render(<TradeCard trade={trade} meTeamId="me" playersById={PLAYERS} />);
    expect(screen.getByText(/an operator put this trade back/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Accept" })).toBeNull();
  });

  it("names an accepted, non reversed trade as settled without implying anything can still be answered", () => {
    const trade: TradeProposalView = { ...BASE, status: "accepted", settledAt: "2026-08-19T00:00:00.000Z" };
    render(<TradeCard trade={trade} meTeamId="me" playersById={PLAYERS} />);
    expect(screen.getByText("Both rosters changed when this trade was accepted.")).toBeInTheDocument();
  });

  it("names who took back a withdrawn offer, from the viewer's own side", () => {
    const trade: TradeProposalView = { ...BASE, status: "withdrawn", settledAt: "2026-08-19T00:00:00.000Z" };
    render(<TradeCard trade={trade} meTeamId="me" playersById={PLAYERS} />);
    expect(screen.getByText("They took this offer back.")).toBeInTheDocument();
  });

  it("shows the note a proposer attached, quoted", () => {
    const trade: TradeProposalView = { ...BASE, note: "Rebuilding my TE spot, thanks for considering" };
    render(<TradeCard trade={trade} meTeamId="me" playersById={PLAYERS} />);
    expect(screen.getByText('"Rebuilding my TE spot, thanks for considering"')).toBeInTheDocument();
  });

  it("disables its own buttons while an action for this card is in flight", () => {
    render(<TradeCard trade={BASE} meTeamId="me" playersById={PLAYERS} busy />);
    expect(screen.getByRole("button", { name: "Accept" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Decline" })).toBeDisabled();
  });

  it("carries no em dash or en dash across every state it can render", () => {
    const states: readonly TradeProposalView[] = [
      BASE,
      { ...BASE, status: "accepted", settledAt: "x" },
      { ...BASE, status: "accepted", settledAt: "x", reversedAt: "y" },
      { ...BASE, status: "rejected", settledAt: "x" },
      { ...BASE, status: "withdrawn", settledAt: "x" },
      { ...BASE, status: "expired" },
      { ...BASE, status: "superseded", settledAt: "x" },
    ];
    for (const trade of states) {
      const { unmount, container } = render(<TradeCard trade={trade} meTeamId="me" playersById={PLAYERS} />);
      expect(container.textContent).not.toMatch(/[–—]/);
      unmount();
    }
  });
});
