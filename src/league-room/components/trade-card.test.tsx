import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { axe } from "vitest-axe";
import { renderSurface } from "@/components/ui/test-utils";
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

afterEach(() => {
  if (vi.isFakeTimers()) vi.useRealTimers();
});

describe("TradeCard", () => {
  // Fix round 1, F2 (HIGH, member panel): neither the recipient nor the sender was ever told
  // when an open offer stops being answerable, despite `expiresAt` already being on the wire.
  it("shows a live remaining count on an open offer, for both the recipient and the sender", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-18T00:00:00.000Z")); // 3 full days before BASE.expiresAt

    const recipient = render(<TradeCard trade={BASE} meTeamId="me" playersById={PLAYERS} />);
    expect(screen.getByText("Expires in 3 days.")).toBeInTheDocument();
    recipient.unmount();

    render(<TradeCard trade={BASE} meTeamId="them" playersById={PLAYERS} />);
    expect(screen.getByText("Expires in 3 days.")).toBeInTheDocument();
  });

  it("says today or tomorrow rather than a fraction of a day", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-20T00:00:00.000Z")); // exactly 1 day before BASE.expiresAt
    const tomorrow = render(<TradeCard trade={BASE} meTeamId="me" playersById={PLAYERS} />);
    expect(screen.getByText("Expires tomorrow.")).toBeInTheDocument();
    tomorrow.unmount();

    vi.setSystemTime(new Date("2026-08-20T18:00:00.000Z")); // 6 hours left
    render(<TradeCard trade={BASE} meTeamId="me" playersById={PLAYERS} />);
    expect(screen.getByText("Expires today.")).toBeInTheDocument();
  });

  it("shows no expiry line once a trade has settled — there is nothing left to expire", () => {
    const trade: TradeProposalView = { ...BASE, status: "rejected", settledAt: "2026-08-19T00:00:00.000Z" };
    render(<TradeCard trade={trade} meTeamId="me" playersById={PLAYERS} />);
    expect(screen.queryByText(/^Expires/)).not.toBeInTheDocument();
  });

  /**
   * FINAL REVIEW, HIGH 3 — the member's dead end, closed. Nothing ever writes `status =
   * 'expired'` (there is no event moment to write one at, and no scheduler), so a dead offer is
   * still `open` on the wire. `isExpired` had ZERO production consumers, so this card kept
   * rendering "Needs your answer" and a live Accept button on an offer whose Accept could only
   * ever 409, above an expiry line that said "Expires today." for as long as the row existed.
   */
  it("shows a past-due offer as expired, with the day it ran out, never as expiring today", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-24T00:00:00.000Z")); // three days after BASE.expiresAt

    render(<TradeCard trade={BASE} meTeamId="me" playersById={PLAYERS} />);
    expect(screen.getByText("Expired August 21.")).toBeInTheDocument();
    expect(screen.queryByText("Expires today.")).not.toBeInTheDocument();
  });

  it("takes the answer controls and the badge off an expired offer, for the party who owes an answer", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-24T00:00:00.000Z"));

    render(<TradeCard trade={BASE} meTeamId="me" playersById={PLAYERS} />);
    expect(screen.queryByText("Needs your answer")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Accept" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Decline" })).not.toBeInTheDocument();
  });

  it("leaves the proposer their Withdraw on an expired offer, and stops claiming it is waiting for a reply", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-24T00:00:00.000Z"));

    render(<TradeCard trade={BASE} meTeamId="them" playersById={PLAYERS} onWithdraw={() => {}} />);
    expect(screen.getByRole("button", { name: "Withdraw" })).toBeInTheDocument();
    expect(screen.queryByText("Proposed. Waiting for a reply.")).not.toBeInTheDocument();
    // Fun pass, Task 4: the permission clause went. Nothing was stopping anyone clearing it.
    expect(screen.getByText("Nobody answered before this ran out.")).toBeInTheDocument();
  });

  it("keeps the answer controls right up to the moment the offer runs out", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-20T23:59:59.000Z")); // one second left

    render(<TradeCard trade={BASE} meTeamId="me" playersById={PLAYERS} />);
    // The "Needs your answer" badge left the card (Sunday v5 subtraction — the inbox band above
    // says it once); the answer controls themselves are what must survive to the last second.
    expect(screen.getByRole("button", { name: "Accept" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Decline" })).toBeInTheDocument();
  });
});

describe("TradeCard states", () => {
  // The clock is PINNED for every case below (final review, HIGH 3). `BASE` is an OPEN offer with
  // a fixed `expiresAt`, and an open offer's controls now depend on whether that date has passed
  // — so against a real wall clock this whole block would silently start asserting the expired
  // card the day `BASE.expiresAt` went by. `shouldAdvanceTime` keeps `axe`'s own async work
  // running normally.
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-08-19T00:00:00.000Z")); // BASE is live, two days out
  });

  it("shows the verdict beside the accept control, never instead of it, in both themes, axe-clean", async () => {
    await renderSurface(
      <TradeCard trade={BASE} meTeamId="me" playersById={PLAYERS} assessmentStatus="ready" assessment={LOPSIDED_ASSESSMENT} />,
      async ({ container }) => {
        expect(screen.getByText(/a long way from even/i)).toBeVisible();
        expect(screen.getByRole("button", { name: "Accept" })).toBeEnabled();
        expect(screen.getByRole("button", { name: "Decline" })).toBeEnabled();
        expect(await axe(container)).toHaveNoViolations();
      },
    );
  });

  // Fix round 1, F4 (MEDIUM): the verdict must be asked for, never fetched for every card on
  // mount — the same "ask, then show the answer" shape `AdvisorPanel` already uses, so an inbox
  // full of open offers can never burst the shared advisor rate limiter.
  it("asks before it shows a verdict, on the same shape AdvisorPanel already uses", () => {
    const onRequestAssessment = vi.fn();
    render(<TradeCard trade={BASE} meTeamId="me" playersById={PLAYERS} onRequestAssessment={onRequestAssessment} />);
    expect(screen.queryByText(/weekly production/i)).not.toBeInTheDocument();
    const ask = screen.getByRole("button", { name: "See what the platform thinks of this trade" });
    fireEvent.click(ask);
    expect(onRequestAssessment).toHaveBeenCalledWith("t1");
  });

  it("shows it is checking, not a blank card, while the verdict is in flight", () => {
    render(<TradeCard trade={BASE} meTeamId="me" playersById={PLAYERS} assessmentStatus="loading" />);
    expect(screen.getByText("Checking what the platform thinks of this trade.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "See what the platform thinks of this trade" })).not.toBeInTheDocument();
  });

  // Fix round 1, F4 (MEDIUM): a failed verdict fetch used to leave the card silently missing its
  // verdict panel, with no error and no retry — never distinguishable from "nobody asked yet".
  it("says the advice failed, honestly, and offers a retry rather than staying silent", () => {
    const onRequestAssessment = vi.fn();
    render(<TradeCard trade={BASE} meTeamId="me" playersById={PLAYERS} assessmentStatus="error" onRequestAssessment={onRequestAssessment} />);
    expect(screen.getByText(/Advice is unavailable right now\./)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRequestAssessment).toHaveBeenCalledWith("t1");
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

  // E5 (competition review): a position used to be a 769px `Sticker` slab per asset — 202 of
  // them, 40.4% of the trades page's own ink. It is a plain row with a `PositionBadge` chip now,
  // the same treatment the matchup table and `LineupEditor`'s roster table already use.
  it("renders each asset as a quiet row, never a full sticker slab (E5)", () => {
    const { container } = render(<TradeCard trade={BASE} meTeamId="me" playersById={PLAYERS} />);
    expect(container.querySelector(".shadow-sticker")).toBeNull();
    expect(screen.getByText("WR").className).toContain("bg-pos-wr");
  });

  // E6 (competition review): `counterpartyName` used to be computed for the `aria-label` alone
  // — a card never visibly named who you traded with, and neither `proposedAt` nor `settledAt`
  // was ever rendered despite both being on the wire.
  it("names the counterparty and the date visibly, not only in the aria-label (E6)", () => {
    render(<TradeCard trade={BASE} meTeamId="me" playersById={PLAYERS} />);
    expect(screen.getByText(/With Iron Owls/)).toBeInTheDocument();
    expect(screen.getByText(/Proposed August 18/)).toBeInTheDocument();
  });

  it("names both sides plainly, and the settled date, for a league-wide history row that is not the viewer's own trade (E6)", () => {
    const trade: TradeProposalView = { ...BASE, status: "accepted", settledAt: "2026-08-19T00:00:00.000Z" };
    render(<TradeCard trade={trade} meTeamId="somebody_else" playersById={PLAYERS} />);
    expect(screen.getByText(/Iron Owls and Bay Bandits/)).toBeInTheDocument();
    expect(screen.getByText(/Settled August 19/)).toBeInTheDocument();
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

    fireEvent.click(screen.getByRole("button", { name: "Confirm trade" }));
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
    expect(screen.getByText("Proposed. Waiting for a reply.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Withdraw" }));
    expect(onWithdraw).toHaveBeenCalledWith("t1");
  });

  it("renders a superseded offer with what happened, not with a blank status", () => {
    const trade: TradeProposalView = { ...BASE, status: "superseded", settledAt: "2026-08-19T00:00:00.000Z" };
    render(<TradeCard trade={trade} meTeamId="me" playersById={PLAYERS} />);
    // Fun pass, Task 4: "This offer can't be answered anymore" restated the status chip
    // above it, in the register of a refusal. The card names the reason and stops.
    expect(screen.getByText(/moved in another trade/i)).toBeInTheDocument();
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
    expect(screen.getByText(/an operator reversed this trade/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Accept" })).toBeNull();
  });

  it("shows the held-trade banner for a held trade, honestly, to both parties, and offers no accept/decline", () => {
    const trade: TradeProposalView = { ...BASE, status: "held" };
    const recipient = render(<TradeCard trade={trade} meTeamId="me" playersById={PLAYERS} leagueName="Sunday Money" />);
    expect(screen.getByText(/Your trade with Iron Owls in Sunday Money is on hold/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Accept" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Decline" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Withdraw" })).toBeNull();
    recipient.unmount();

    render(<TradeCard trade={trade} meTeamId="them" playersById={PLAYERS} leagueName="Sunday Money" />);
    expect(screen.getByText(/Your trade with Bay Bandits in Sunday Money is on hold/)).toBeInTheDocument();
  });

  it("renders a blocked trade with what happened, and offers nothing to answer", () => {
    const trade: TradeProposalView = { ...BASE, status: "blocked", settledAt: "2026-08-19T00:00:00.000Z" };
    render(<TradeCard trade={trade} meTeamId="me" playersById={PLAYERS} />);
    expect(screen.getByText(/was blocked/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Accept" })).toBeNull();
    expect(screen.queryByText(/Your trade with/)).not.toBeInTheDocument(); // no held banner leaks into a blocked render
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
    // E6: `settledAt`/`reversedAt` are real ISO instants now that the card renders them (a
    // date line, "Settled August 19." etc.) — "x"/"y" placeholders would throw once formatted,
    // where before they were write-only fields this card never read.
    const states: readonly TradeProposalView[] = [
      BASE,
      { ...BASE, status: "accepted", settledAt: "2026-08-19T00:00:00.000Z" },
      { ...BASE, status: "accepted", settledAt: "2026-08-19T00:00:00.000Z", reversedAt: "2026-08-20T00:00:00.000Z" },
      { ...BASE, status: "rejected", settledAt: "2026-08-19T00:00:00.000Z" },
      { ...BASE, status: "withdrawn", settledAt: "2026-08-19T00:00:00.000Z" },
      { ...BASE, status: "expired" },
      { ...BASE, status: "superseded", settledAt: "2026-08-19T00:00:00.000Z" },
    ];
    for (const trade of states) {
      const { unmount, container } = render(<TradeCard trade={trade} meTeamId="me" playersById={PLAYERS} />);
      expect(container.textContent).not.toMatch(/[–—]/);
      unmount();
    }
  });
});
