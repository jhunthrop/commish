import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { act, render, screen, fireEvent } from "@testing-library/react";
import { axe } from "vitest-axe";
import { renderSurface } from "@/components/ui/test-utils";
import type { TradeProposalView } from "@/trades/contract";
import type { ValuedPlayer } from "@/trades/fairness";
import type { TradeRosterPlayer } from "../contract";
import { PlayerPeekHost } from "./player-peek";
import type { TradeAssessmentSummary } from "./trade-verdict";
import { TradeCard } from "./trade-card";

const ROSTER_BY_ID: Readonly<Record<string, TradeRosterPlayer>> = {
  p1: { playerId: "p1", name: "Bijan Robinson", position: "RB", nflTeam: "ATL", headshotUrl: null, adp: null },
  p2: { playerId: "p2", name: "Puka Nacua", position: "WR", nflTeam: "LAR", headshotUrl: null, adp: null },
};

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
  // SIDELINE (the wire, 2026-09-11): the remaining count is the card's ONE BIG NUMBER (P2) and it
  // names the window it counts down from in the same glance (P11), where it used to be a sentence
  // in the muted ink. Both sides of an open offer see it: the recipient deciding whether to
  // answer now, and the sender waiting on a reply.
  it("shows the days left as the card's one number, with its basis, for both sides", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-18T00:00:00.000Z")); // 3 full days before BASE.expiresAt

    const recipient = render(<TradeCard leagueId="l1" trade={BASE} meTeamId="me" playersById={PLAYERS} />);
    expect(screen.getByTestId("big-number")).toHaveTextContent("3");
    expect(screen.getByText("days left, of 3 days")).toBeInTheDocument();
    recipient.unmount();

    render(<TradeCard leagueId="l1" trade={BASE} meTeamId="them" playersById={PLAYERS} />);
    expect(screen.getByTestId("big-number")).toHaveTextContent("3");
  });

  it("counts whole days, so the last day reads as none left rather than a fraction", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-20T00:00:00.000Z")); // exactly 1 day before BASE.expiresAt
    const tomorrow = render(<TradeCard leagueId="l1" trade={BASE} meTeamId="me" playersById={PLAYERS} />);
    expect(screen.getByTestId("big-number")).toHaveTextContent("1");
    // Fix round 1, H2: one day left is "day", not "days". The unit rides the basis so the "3"
    // can never be read as a count of offers or of players in the deal.
    expect(screen.getByText("day left, of 3 days")).toBeInTheDocument();
    tomorrow.unmount();

    vi.setSystemTime(new Date("2026-08-20T18:00:00.000Z")); // 6 hours left
    render(<TradeCard leagueId="l1" trade={BASE} meTeamId="me" playersById={PLAYERS} />);
    expect(screen.getByTestId("big-number")).toHaveTextContent("0");
  });

  it("shows no clock at all once a trade has settled, because there is nothing left to count", () => {
    const trade: TradeProposalView = { ...BASE, status: "rejected", settledAt: "2026-08-19T00:00:00.000Z" };
    render(<TradeCard leagueId="l1" trade={trade} meTeamId="me" playersById={PLAYERS} />);
    expect(screen.queryByTestId("big-number")).not.toBeInTheDocument();
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

    render(<TradeCard leagueId="l1" trade={BASE} meTeamId="me" playersById={PLAYERS} />);
    expect(screen.getByText("Expired August 21.")).toBeInTheDocument();
    // A dead offer has NO FIGURE, not a dash with a caption: the slot would be pretending there
    // is still a count to make (P11, and the house rule that a dash is never a zero).
    expect(screen.queryByTestId("big-number")).not.toBeInTheDocument();
  });

  it("takes the answer controls and the badge off an expired offer, for the party who owes an answer", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-24T00:00:00.000Z"));

    render(<TradeCard leagueId="l1" trade={BASE} meTeamId="me" playersById={PLAYERS} />);
    expect(screen.queryByText("Needs your answer")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Accept" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Decline" })).not.toBeInTheDocument();
  });

  it("leaves the proposer their Withdraw on an expired offer, and stops claiming it is waiting for a reply", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-24T00:00:00.000Z"));

    render(<TradeCard leagueId="l1" trade={BASE} meTeamId="them" playersById={PLAYERS} onWithdraw={() => {}} />);
    expect(screen.getByRole("button", { name: "Withdraw" })).toBeInTheDocument();
    expect(screen.queryByText("Proposed. Waiting for a reply.")).not.toBeInTheDocument();
    // Fun pass, Task 4: the permission clause went. Nothing was stopping anyone clearing it.
    expect(screen.getByText("Nobody answered before this ran out.")).toBeInTheDocument();
  });

  it("keeps the answer controls right up to the moment the offer runs out", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-20T23:59:59.000Z")); // one second left

    render(<TradeCard leagueId="l1" trade={BASE} meTeamId="me" playersById={PLAYERS} />);
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
      <TradeCard leagueId="l1" trade={BASE} meTeamId="me" playersById={PLAYERS} assessmentStatus="ready" assessment={LOPSIDED_ASSESSMENT} />,
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
    render(<TradeCard leagueId="l1" trade={BASE} meTeamId="me" playersById={PLAYERS} onRequestAssessment={onRequestAssessment} />);
    expect(screen.queryByText(/weekly production/i)).not.toBeInTheDocument();
    const ask = screen.getByRole("button", { name: "Is it fair" });
    fireEvent.click(ask);
    expect(onRequestAssessment).toHaveBeenCalledWith("t1");
  });

  // FIX ROUND 1, H1. The fairness read used to be a third BUTTON in the foot, beside the one
  // irreversible pair, and it spoke in institutional third person ("What the platform thinks").
  // It is a leaguemate's question now, asked quietly on the byline row, and the foot holds
  // Decline and Accept and nothing else.
  it("keeps the fairness read off the verb foot, so the foot holds the two answers only", () => {
    render(<TradeCard leagueId="l1" trade={BASE} meTeamId="me" playersById={PLAYERS} onRequestAssessment={vi.fn()} />);
    const fair = screen.getByRole("button", { name: "Is it fair" });
    const accept = screen.getByRole("button", { name: "Accept" });
    const foot = accept.parentElement!.parentElement!;
    expect(foot).toContainElement(screen.getByRole("button", { name: "Decline" }));
    expect(foot).not.toContainElement(fair);
    // It sits in the message's own byline, beside who said it and when.
    expect(fair.closest("p")).toHaveTextContent("Iron Owls");
  });

  it("never calls itself the platform, anywhere a manager can read", () => {
    const asked = render(<TradeCard leagueId="l1" trade={BASE} meTeamId="me" playersById={PLAYERS} assessmentStatus="loading" />);
    expect(screen.getByText("Checking whether it is fair.")).toBeInTheDocument();
    expect(asked.container.textContent).not.toMatch(/platform/i);
    asked.unmount();

    const idle = render(<TradeCard leagueId="l1" trade={BASE} meTeamId="me" playersById={PLAYERS} onRequestAssessment={vi.fn()} />);
    expect(idle.container.textContent).not.toMatch(/platform/i);
  });

  it("shows it is checking, not a blank card, while the verdict is in flight", () => {
    render(<TradeCard leagueId="l1" trade={BASE} meTeamId="me" playersById={PLAYERS} assessmentStatus="loading" />);
    expect(screen.getByText("Checking whether it is fair.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Is it fair" })).not.toBeInTheDocument();
  });

  // Fix round 1, F4 (MEDIUM): a failed verdict fetch used to leave the card silently missing its
  // verdict panel, with no error and no retry — never distinguishable from "nobody asked yet".
  it("says the advice failed, honestly, and offers a retry rather than staying silent", () => {
    const onRequestAssessment = vi.fn();
    render(<TradeCard leagueId="l1" trade={BASE} meTeamId="me" playersById={PLAYERS} assessmentStatus="error" onRequestAssessment={onRequestAssessment} />);
    expect(screen.getByText(/Advice is unavailable right now\./)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRequestAssessment).toHaveBeenCalledWith("t1");
  });

  it("renders both sides through PositionBadge and a name, framed as what you give and get", () => {
    render(<TradeCard leagueId="l1" trade={BASE} meTeamId="me" playersById={PLAYERS} rosterById={ROSTER_BY_ID} />);
    expect(screen.getByText("You give")).toBeInTheDocument();
    expect(screen.getByText("You get")).toBeInTheDocument();
    expect(screen.getByText("Puka Nacua")).toBeInTheDocument();
    expect(screen.getByText("WR")).toBeInTheDocument();
    expect(screen.getByText("Bijan Robinson")).toBeInTheDocument();
    expect(screen.getByText("RB")).toBeInTheDocument();
  });

  // Task 4 (player-name adoption sweep): a name resolves to `PlayerName` only once `rosterById`
  // resolves the asset to a real roster player — the SAME gate that already decides whether the
  // row draws a `PlayerFace` — since the other branch's label is `describeAsset`'s own prose
  // ("a player no longer on this roster"), which names no one to open a peek for.
  it("makes a resolved asset's name a pressable button that opens the season peek, axe-clean", async () => {
    const { container } = render(
      <>
        <PlayerPeekHost />
        <TradeCard leagueId="l1" trade={BASE} meTeamId="me" playersById={PLAYERS} rosterById={ROSTER_BY_ID} />
      </>,
    );
    const name = screen.getByRole("button", { name: "Puka Nacua" });
    expect(await axe(container)).toHaveNoViolations();
    await act(async () => {
      fireEvent.click(name);
    });
    expect(screen.getByRole("dialog", { name: "Puka Nacua" })).toBeInTheDocument();
  });

  it("keeps an asset that resolves to nobody as inert prose, never a dead peek button", () => {
    // Only the "ghost" id is missing from `PLAYERS`/`ROSTER_BY_ID` — the "to" side's `p2` still
    // resolves normally, so this isolates the ONE fallback branch rather than emptying both maps
    // (which would render the identical prose sentence twice and make the row ambiguous).
    const trade: TradeProposalView = { ...BASE, from: { teamId: "them", teamName: "Iron Owls", assets: [{ kind: "player", playerId: "ghost" }] } };
    render(<TradeCard leagueId="l1" trade={trade} meTeamId="me" playersById={PLAYERS} rosterById={ROSTER_BY_ID} />);
    expect(screen.getByText("a player no longer on this roster")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /no longer on this roster/ })).not.toBeInTheDocument();
  });

  // E5 (competition review): a position used to be a 769px `Sticker` slab per asset — 202 of
  // them, 40.4% of the trades page's own ink. It is a plain row with a `PositionBadge` chip now,
  // the same treatment the matchup table and `LineupEditor`'s roster table already use.
  it("renders each asset as a quiet row, never a full sticker slab (E5)", () => {
    const { container } = render(<TradeCard leagueId="l1" trade={BASE} meTeamId="me" playersById={PLAYERS} rosterById={ROSTER_BY_ID} />);
    expect(container.querySelector(".shadow-sticker")).toBeNull();
    expect(screen.getByText("WR").className).toContain("bg-pos-wr");
  });

  // P1, ON THE SURFACE WHERE TWO PEOPLE NEGOTIATE. Both managers lead the card with a face and a
  // name; their team names ride the meta line under them, and the date is the message's byline.
  it("leads with both managers, names which team is which, and dates the message", () => {
    render(
      <TradeCard
        leagueId="l1"
        trade={BASE}
        meTeamId="me"
        playersById={PLAYERS}
        managersByTeamId={{
          them: { teamName: "Iron Owls", name: "Rey Okafor", avatar: null },
          me: { teamName: "Bay Bandits", name: "Dana Whitfield", avatar: null },
        }}
      />,
    );
    const managers = screen.getAllByTestId("manager");
    expect(managers).toHaveLength(2);
    expect(managers[0]).toHaveTextContent("Rey Okafor");
    expect(managers[0]).toHaveTextContent("Iron Owls");
    expect(managers[1]).toHaveTextContent("Dana Whitfield");
    expect(managers[1]).toHaveTextContent("Bay Bandits");
    expect(screen.getByText(/Proposed August 18/)).toBeInTheDocument();
  });

  it("falls back to the team names when nobody supplied the people behind them", () => {
    render(<TradeCard leagueId="l1" trade={BASE} meTeamId="me" playersById={PLAYERS} />);
    const managers = screen.getAllByTestId("manager");
    expect(managers[0]).toHaveTextContent("Iron Owls");
    expect(managers[1]).toHaveTextContent("Bay Bandits");
  });

  it("names both sides, and the settled date, for a league-wide history row that is not the viewer's own trade (E6)", () => {
    const trade: TradeProposalView = { ...BASE, status: "accepted", settledAt: "2026-08-19T00:00:00.000Z" };
    render(<TradeCard leagueId="l1" trade={trade} meTeamId="somebody_else" playersById={PLAYERS} />);
    const managers = screen.getAllByTestId("manager");
    expect(managers[0]).toHaveTextContent("Iron Owls");
    expect(managers[1]).toHaveTextContent("Bay Bandits");
    expect(screen.getByText(/Settled August 19/)).toBeInTheDocument();
  });

  it("degrades a player no longer on any roster to a neutral label instead of a raw id", () => {
    const trade: TradeProposalView = { ...BASE, from: { ...BASE.from, assets: [{ kind: "player", playerId: "ghost" }] } };
    render(<TradeCard leagueId="l1" trade={trade} meTeamId="me" playersById={PLAYERS} />);
    expect(screen.getByText("a player no longer on this roster")).toBeInTheDocument();
  });

  it("keeps the accept and decline controls in a spaced row, not touching, at 360px", () => {
    // happy-dom performs no real CSS layout, so a pixel-geometry assertion here would always
    // read every rect as zero regardless of the markup — asserting the deliberate `gap-4`
    // utility on their shared row is what this environment can actually prove, and is the class
    // the 360px baseline (`docs/design-system.md`) actually renders spacing from.
    render(<TradeCard leagueId="l1" trade={BASE} meTeamId="me" playersById={PLAYERS} />);
    const accept = screen.getByRole("button", { name: "Accept" });
    const row = accept.parentElement!;
    expect(row).toContainElement(screen.getByRole("button", { name: "Decline" }));
    expect(row.className).toMatch(/\bgap-4\b/);
  });

  it("asks once before it accepts, because nothing undoes it", () => {
    const onAccept = vi.fn();
    render(<TradeCard leagueId="l1" trade={BASE} meTeamId="me" playersById={PLAYERS} onAccept={onAccept} />);
    fireEvent.click(screen.getByRole("button", { name: "Accept" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("Both rosters change as soon as you accept. You cannot undo it.");
    expect(onAccept).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Confirm trade" }));
    expect(onAccept).toHaveBeenCalledWith("t1");
  });

  it("declines with no confirmation, since a decline changes nothing that can't be re-offered", () => {
    const onDecline = vi.fn();
    render(<TradeCard leagueId="l1" trade={BASE} meTeamId="me" playersById={PLAYERS} onDecline={onDecline} />);
    fireEvent.click(screen.getByRole("button", { name: "Decline" }));
    expect(onDecline).toHaveBeenCalledWith("t1");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("offers no accept control to the proposer, and offers a withdraw instead", () => {
    const onWithdraw = vi.fn();
    render(<TradeCard leagueId="l1" trade={BASE} meTeamId="them" playersById={PLAYERS} onWithdraw={onWithdraw} />);
    expect(screen.queryByRole("button", { name: "Accept" })).not.toBeInTheDocument();
    // "Proposed" is the byline's job now (the message is stamped with the day it was sent), so
    // the line beside Withdraw says only the part the byline does not: nobody has answered.
    expect(screen.getByText("Waiting for a reply.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Withdraw" }));
    expect(onWithdraw).toHaveBeenCalledWith("t1");
  });

  // FIX ROUND 1, M3. In a room whose thesis is "a trade is a conversation", your own sent offer
  // has to read as sent: your bubble, on your side, in Court blue, with no author header stamping
  // your own name back at you.
  it("draws your own outgoing offer as yours, and an inbound one as theirs", () => {
    const outgoing = render(<TradeCard leagueId="l1" trade={BASE} meTeamId="them" playersById={PLAYERS} />);
    expect(screen.getByTestId("message-bubble")).toHaveAttribute("data-mine", "true");
    outgoing.unmount();

    render(<TradeCard leagueId="l1" trade={BASE} meTeamId="me" playersById={PLAYERS} />);
    expect(screen.getByTestId("message-bubble")).not.toHaveAttribute("data-mine");
  });

  it("renders a superseded offer with what happened, not with a blank status", () => {
    const trade: TradeProposalView = { ...BASE, status: "superseded", settledAt: "2026-08-19T00:00:00.000Z" };
    render(<TradeCard leagueId="l1" trade={trade} meTeamId="me" playersById={PLAYERS} />);
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
    render(<TradeCard leagueId="l1" trade={trade} meTeamId="me" playersById={PLAYERS} />);
    expect(screen.getByText(/an operator reversed this trade/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Accept" })).toBeNull();
  });

  it("shows the held-trade banner for a held trade, honestly, to both parties, and offers no accept/decline", () => {
    const trade: TradeProposalView = { ...BASE, status: "held" };
    const recipient = render(<TradeCard leagueId="l1" trade={trade} meTeamId="me" playersById={PLAYERS} leagueName="Sunday Money" />);
    expect(screen.getByText(/Your trade with Iron Owls in Sunday Money is on hold/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Accept" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Decline" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Withdraw" })).toBeNull();
    recipient.unmount();

    render(<TradeCard leagueId="l1" trade={trade} meTeamId="them" playersById={PLAYERS} leagueName="Sunday Money" />);
    expect(screen.getByText(/Your trade with Bay Bandits in Sunday Money is on hold/)).toBeInTheDocument();
  });

  it("renders a blocked trade with what happened, and offers nothing to answer", () => {
    const trade: TradeProposalView = { ...BASE, status: "blocked", settledAt: "2026-08-19T00:00:00.000Z" };
    render(<TradeCard leagueId="l1" trade={trade} meTeamId="me" playersById={PLAYERS} />);
    expect(screen.getByText(/was blocked/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Accept" })).toBeNull();
    expect(screen.queryByText(/Your trade with/)).not.toBeInTheDocument(); // no held banner leaks into a blocked render
  });

  it("names an accepted, non reversed trade as settled without implying anything can still be answered", () => {
    const trade: TradeProposalView = { ...BASE, status: "accepted", settledAt: "2026-08-19T00:00:00.000Z" };
    render(<TradeCard leagueId="l1" trade={trade} meTeamId="me" playersById={PLAYERS} />);
    expect(screen.getByText("Both rosters changed when this trade was accepted.")).toBeInTheDocument();
  });

  it("names who took back a withdrawn offer, from the viewer's own side", () => {
    const trade: TradeProposalView = { ...BASE, status: "withdrawn", settledAt: "2026-08-19T00:00:00.000Z" };
    render(<TradeCard leagueId="l1" trade={trade} meTeamId="me" playersById={PLAYERS} />);
    expect(screen.getByText("They took this offer back.")).toBeInTheDocument();
  });

  it("shows the note a proposer attached, as their own message", () => {
    const trade: TradeProposalView = { ...BASE, note: "Rebuilding my TE spot, thanks for considering" };
    render(<TradeCard leagueId="l1" trade={trade} meTeamId="me" playersById={PLAYERS} />);
    // The quote marks went with the card: the note sits INSIDE the proposer's own message bubble
    // now, which is what a pair of quotation marks was standing in for.
    expect(screen.getByText("Rebuilding my TE spot, thanks for considering")).toBeInTheDocument();
  });

  it("disables its own buttons while an action for this card is in flight", () => {
    render(<TradeCard leagueId="l1" trade={BASE} meTeamId="me" playersById={PLAYERS} busy />);
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
      const { unmount, container } = render(<TradeCard leagueId="l1" trade={trade} meTeamId="me" playersById={PLAYERS} />);
      expect(container.textContent).not.toMatch(/[–—]/);
      unmount();
    }
  });
});
