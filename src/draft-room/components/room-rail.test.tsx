import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import type { CompletedPick, DraftStateView } from "@/draft-engine";
import { GLOSSARY } from "@/help/glossary";
import { inBothThemes } from "@/components/ui/test-utils";
import { AUCTION_VIEW, LEAGUE_NAME, SNAKE_VIEW, TEAMS, playersById } from "../test-fixtures";
import { RoomRail } from "./room-rail";

/**
 * Deadlines are built relative to the real clock rather than with fake timers: `useNow` reads
 * `Date.now()` once on mount, and `formatCountdown` rounds up, so a 125-second gap renders
 * "2:05" for any elapsed time under a second. Fake timers are avoided here on purpose — axe
 * runs async and deadlocks against them.
 */
function liveView(over: Partial<DraftStateView> = {}): DraftStateView {
  return {
    ...SNAKE_VIEW,
    deadlineAt: new Date(Date.now() + 125_000).toISOString(),
    // 134.5 minutes out, so the floor-to-minutes gap reads "2h 14m" with room to spare.
    nextTightening: { at: new Date(Date.now() + 134 * 60_000 + 30_000).toISOString(), pickSeconds: 600 },
    ...over,
  };
}

const finished: Partial<DraftStateView> = { onClockTeamId: null, deadlineAt: null, clockSeconds: null, nextTightening: null, upcoming: [] };

const props = { leagueName: LEAGUE_NAME, teams: TEAMS, playersById: playersById(), connection: "live" as const };

function pick(over: Partial<CompletedPick> = {}): CompletedPick {
  return {
    pickNumber: 1,
    round: 1,
    teamId: "t1",
    playerId: "qb1",
    slot: "QB",
    slotIndex: 0,
    price: null,
    timestamp: "2026-09-01T00:05:00.000Z",
    auto: false,
    ...over,
  };
}

describe("RoomRail", () => {
  it("names the league, the format, the turn and your team — both themes, axe-clean", async () => {
    await inBothThemes(<RoomRail {...props} view={liveView()} myTeamId="t2" />, async ({ container }) => {
      expect(screen.getByRole("heading", { level: 1, name: LEAGUE_NAME })).toBeInTheDocument();
      expect(screen.getByText("Snake draft")).toBeInTheDocument();
      expect(screen.getByTestId("turn-label")).toHaveTextContent("Round 1 · Pick 1");
      expect(screen.getByText("Iron Owls")).toBeInTheDocument();
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  it("names who is on the clock, counts down, and says when the clock tightens", () => {
    render(<RoomRail {...props} view={liveView()} myTeamId="t2" />);
    expect(screen.getByText("On the clock")).toBeInTheDocument();
    expect(screen.getByTestId("countdown")).toHaveTextContent("2:05");
    expect(screen.getByText("Picks shorten to 10 minutes in 2h 14m")).toBeInTheDocument();
  });

  it("shows the paused state honestly in place of the countdown, and drops it once picks resume — both themes, axe-clean", async () => {
    // 3 hours out: well within the freeze right now (real time, not a fake timer — see this
    // file's own top-of-file note on why).
    const resumeAt = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString();
    await inBothThemes(<RoomRail {...props} view={liveView({ pausedUntil: resumeAt })} myTeamId="t2" />, async ({ container }) => {
      expect(screen.queryByTestId("countdown")).toBeNull();
      const message = screen.getByTestId("paused-message");
      expect(message).toHaveTextContent(/^Picks are paused until \d{1,2}:\d{2} (AM|PM) Eastern\. You can still make yours\.$/);
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  it("keeps ticking the countdown once pausedUntil is already in the past", () => {
    // The stale-payload case: an event set `pausedUntil` for a freeze that has since lifted, and
    // no later event has refreshed it (nothing happened overnight). `now` having already passed
    // it is what the live room reads, never the field alone.
    const resumeAt = new Date(Date.now() - 60_000).toISOString();
    render(<RoomRail {...props} view={liveView({ pausedUntil: resumeAt })} myTeamId="t2" />);
    expect(screen.queryByTestId("paused-message")).toBeNull();
    expect(screen.getByTestId("countdown")).toBeInTheDocument();
  });

  it("never shows the paused message when the view carries no pausedUntil at all", () => {
    render(<RoomRail {...props} view={liveView({ pausedUntil: null })} myTeamId="t2" />);
    expect(screen.queryByTestId("paused-message")).toBeNull();
    expect(screen.getByTestId("countdown")).toBeInTheDocument();
  });

  // Task 5, Phase 3.5: a plain count, no name — the board's own pending cells and each owing
  // manager's own dock say WHO; this says only THAT the room is waiting on somebody.
  it("shows a neutral pending-picks count when the draft owes one, and none when it owes nothing", () => {
    const { rerender } = render(<RoomRail {...props} view={liveView({ owedPicks: { t1: [1] } })} myTeamId="t2" />);
    expect(screen.getByTestId("pending-picks")).toHaveTextContent("1 pick pending");

    rerender(<RoomRail {...props} view={liveView({ owedPicks: { t1: [1], t3: [2] } })} myTeamId="t2" />);
    expect(screen.getByTestId("pending-picks")).toHaveTextContent("2 picks pending");

    rerender(<RoomRail {...props} view={liveView({ owedPicks: {} })} myTeamId="t2" />);
    expect(screen.queryByTestId("pending-picks")).toBeNull();
  });

  it("carries an InfoTip on the format name and on the on-the-clock label", () => {
    render(<RoomRail {...props} view={liveView()} myTeamId="t2" />);
    expect(screen.getByRole("button", { name: "What is a snake draft?" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "What is on the clock?" })).toBeInTheDocument();
  });

  // FIX 1 (HIGH): helpLevel must actually reach a wired InfoTip, not just be accepted and
  // dropped — a guided caller sees the short line without clicking; a standard caller (or the
  // default, when it's omitted) only gets the click-to-reveal trigger.
  it("threads helpLevel into its InfoTips: guided shows the short line inline, standard doesn't", () => {
    const { rerender } = render(<RoomRail {...props} view={liveView()} myTeamId="t2" />);
    expect(screen.queryByText(GLOSSARY["on-the-clock"].short)).not.toBeInTheDocument();
    rerender(<RoomRail {...props} view={liveView()} myTeamId="t2" helpLevel="standard" />);
    expect(screen.queryByText(GLOSSARY["on-the-clock"].short)).not.toBeInTheDocument();
    rerender(<RoomRail {...props} view={liveView()} myTeamId="t2" helpLevel="guided" />);
    expect(screen.getByText(GLOSSARY["on-the-clock"].short)).toBeInTheDocument();
    expect(screen.getByText(GLOSSARY["snake-draft"].short)).toBeInTheDocument();
  });

  it("drops the on-the-clock InfoTip during a live auction lot — that state isn't the rule the term defines", () => {
    const lotView: DraftStateView = {
      ...AUCTION_VIEW,
      onClockTeamId: null,
      deadlineAt: new Date(Date.now() + 45_000).toISOString(),
      auction: { minBid: 1, nominatingTeamId: null, lot: { playerId: "qb1", highBid: 12, highBidTeamId: "t2", nominatedByTeamId: "t1", autoNominated: false } },
    };
    render(<RoomRail {...props} view={lotView} myTeamId="t1" />);
    expect(screen.getByRole("button", { name: "What is an auction draft?" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "What is on the clock?" })).not.toBeInTheDocument();
  });

  // Step 15's audit: the rail named whose turn it was but never showed a face. `Avatar` falls
  // back to initials with no `ownerAvatarUrl` on the fixture team, so Bay Bandits' owner (Dana
  // Whitfield) shows as "DW" beside the name while she is on the clock.
  it("puts a face beside the on-clock team's name", () => {
    render(<RoomRail {...props} view={liveView()} myTeamId="t2" />);
    expect(screen.getByText("DW")).toBeInTheDocument();
  });

  it("puts no face beside a live bid — the subject there is the player, not a team", async () => {
    const lotView: DraftStateView = {
      ...AUCTION_VIEW,
      onClockTeamId: null,
      deadlineAt: new Date(Date.now() + 45_000).toISOString(),
      auction: { minBid: 1, nominatingTeamId: null, lot: { playerId: "qb1", highBid: 12, highBidTeamId: "t2", nominatedByTeamId: "t1", autoNominated: false } },
    };
    render(<RoomRail {...props} view={lotView} myTeamId="t1" />);
    expect(screen.queryByText("DW")).toBeNull();
    expect(screen.queryByText("RO")).toBeNull();
  });

  it("hides the ticking digits from assistive tech and states the clock in words instead", () => {
    render(<RoomRail {...props} view={liveView()} myTeamId="t2" />);
    expect(screen.getByTestId("countdown")).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByText("Bay Bandits is on the clock. This round's pick clock is 8 hours.")).toBeInTheDocument();
  });

  it("goes hot when the turn is mine, and stays calm when it is not", () => {
    const { rerender } = render(<RoomRail {...props} view={liveView()} myTeamId="t1" />);
    expect(screen.getByTestId("room-rail")).toHaveAttribute("data-mode", "hot");
    expect(screen.getByText("You're on the clock")).toBeInTheDocument();
    expect(screen.getByTestId("countdown").className).toContain("text-negative");

    rerender(<RoomRail {...props} view={liveView()} myTeamId="t2" />);
    expect(screen.getByTestId("room-rail")).toHaveAttribute("data-mode", "watching");
    expect(screen.getByTestId("countdown").className).toContain("text-text-primary");
  });

  it("counts the round off the board rather than off a turn-order rule", () => {
    const view = liveView({
      onClockTeamId: "t2",
      pickNumber: 4,
      picks: [pick({ pickNumber: 1 }), pick({ pickNumber: 2, teamId: "t2", playerId: "rb1", slot: "RB" }), pick({ pickNumber: 3, round: 2, teamId: "t2", playerId: "rb2", slot: "RB" })],
    });
    render(<RoomRail {...props} view={view} myTeamId="t1" />);
    // t2 already owns two picks, so they are filling round 3.
    expect(screen.getByTestId("turn-label")).toHaveTextContent("Round 3 · Pick 4");
  });

  it("explains a draft that has not started and one that has finished, and drops the turn label", () => {
    const { rerender } = render(<RoomRail {...props} view={{ ...SNAKE_VIEW, phase: "scheduled", ...finished }} myTeamId="t1" />);
    expect(screen.getByTestId("room-rail")).toHaveAttribute("data-mode", "scheduled");
    expect(screen.getByText("Your commissioner starts it when everyone is here.")).toBeInTheDocument();
    expect(screen.queryByTestId("turn-label")).toBeNull();

    rerender(<RoomRail {...props} view={{ ...SNAKE_VIEW, phase: "complete", ...finished }} myTeamId="t1" />);
    expect(screen.getByTestId("room-rail")).toHaveAttribute("data-mode", "complete");
    expect(screen.getByText("Every roster is final.")).toBeInTheDocument();
  });

  it("never claims a team is on the clock during a live auction lot — it becomes the lot instead", async () => {
    const lotView: DraftStateView = {
      ...AUCTION_VIEW,
      onClockTeamId: null,
      deadlineAt: new Date(Date.now() + 45_000).toISOString(),
      auction: { minBid: 1, nominatingTeamId: null, lot: { playerId: "qb1", highBid: 12, highBidTeamId: "t2", nominatedByTeamId: "t1", autoNominated: false } },
    };
    await inBothThemes(<RoomRail {...props} view={lotView} myTeamId="t1" />, async ({ container }) => {
      expect(screen.getByText("Live bid")).toBeInTheDocument();
      expect(screen.getByText("Jalen Croft · $12")).toBeInTheDocument();
      expect(screen.getByText("Bidding is open on Jalen Croft. High bid $12 by Iron Owls.")).toBeInTheDocument();
      expect(screen.queryByText(/on the clock/i)).toBeNull();
      expect(screen.getByText("Auction draft")).toBeInTheDocument();
      expect(screen.getByTestId("turn-label")).toHaveTextContent("Lot 1");
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  it("says who is nominating when the auction has no lot open yet", () => {
    const nominateView: DraftStateView = { ...AUCTION_VIEW, onClockTeamId: null, auction: { nominatingTeamId: "t2", lot: null, minBid: 1 } };
    render(<RoomRail {...props} view={nominateView} myTeamId="t1" />);
    expect(screen.getByText("Iron Owls is nominating.")).toBeInTheDocument();
    expect(screen.queryByText(/on the clock/i)).toBeNull();
  });

  it("says it is your turn to nominate when it is", () => {
    const nominateView: DraftStateView = { ...AUCTION_VIEW, onClockTeamId: null, auction: { nominatingTeamId: "t1", lot: null, minBid: 1 } };
    render(<RoomRail {...props} view={nominateView} myTeamId="t1" />);
    expect(screen.getByText("You're nominating")).toBeInTheDocument();
    expect(screen.getByTestId("room-rail")).toHaveAttribute("data-mode", "hot");
  });

  it("says nothing about your team for a commissioner who fields none", () => {
    render(<RoomRail {...props} view={liveView()} myTeamId={null} />);
    expect(screen.queryByText(/Your team:/)).toBeNull();
  });

  it("shows the connection only when it is not working", () => {
    const { rerender } = render(<RoomRail {...props} view={liveView()} myTeamId="t1" />);
    expect(screen.queryByText("Reconnecting…")).toBeNull();
    rerender(<RoomRail {...props} view={liveView()} myTeamId="t1" connection="reconnecting" />);
    expect(screen.getByText("Reconnecting…")).toBeInTheDocument();
  });

  it("reads bigger on the TV and drops every personal affordance", () => {
    render(<RoomRail {...props} view={liveView()} myTeamId="t1" variant="tv" />);
    expect(screen.getByRole("heading", { level: 1, name: LEAGUE_NAME }).className).toContain("text-display-xl");
    // Nobody is "you" on a TV in the corner of a room: no team chip, and no my-turn heat.
    expect(screen.queryByText(/Your team/)).toBeNull();
    expect(screen.getByText("On the clock")).toBeInTheDocument();
    // A shared, unattended display has no clickable control at all, InfoTip included.
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.getByTestId("room-rail")).toHaveAttribute("data-mode", "watching");
  });
});
