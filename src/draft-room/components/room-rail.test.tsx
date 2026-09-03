import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import type { CompletedPick, DraftStateView } from "@/draft-engine";
import { describeStartTiming } from "@/matchmaking/roll";
import { renderSurface } from "@/components/ui/test-utils";
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

/**
 * Sunday v5 (`feat(room): the dock becomes the lower third, and the room gets its clock back`):
 * the pick clock, the on-clock subject/sentence and the picks-until-yours figure all moved out of
 * this rail and down into `RoomDock`'s lower third (see that component's own test file). What
 * stays here is the standing MASTHEAD — league identity, the format badge, where the board is
 * (round/pick or lot number), the pending-picks count, the scheduled/complete/tightening/paused
 * lines, the team chip, the connection banner and the way home — plus the one piece of "the moment"
 * this rail still morphs with: `data-mode` and the on-clock pulse beside the turn label.
 */
describe("RoomRail", () => {
  it("names the league, the format, the turn and your team — both themes, axe-clean", async () => {
    await renderSurface(<RoomRail {...props} view={liveView()} myTeamId="t2" />, async ({ container }) => {
      expect(screen.getByRole("heading", { level: 1, name: LEAGUE_NAME })).toBeInTheDocument();
      expect(screen.getByText("Snake draft")).toBeInTheDocument();
      expect(screen.getByTestId("turn-label")).toHaveTextContent("Round 1 · Pick 1");
      expect(screen.getByText("Iron Owls")).toBeInTheDocument();
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  it("says when the clock tightens", () => {
    render(<RoomRail {...props} view={liveView()} myTeamId="t2" />);
    expect(screen.getByText("Picks shorten to 10 minutes in 2h 14m")).toBeInTheDocument();
  });

  it("shows the paused state honestly, and drops it once picks resume — both themes, axe-clean", async () => {
    // 3 hours out: well within the freeze right now (real time, not a fake timer — see this
    // file's own top-of-file note on why).
    const resumeAt = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString();
    await renderSurface(<RoomRail {...props} view={liveView({ pausedUntil: resumeAt })} myTeamId="t2" />, async ({ container }) => {
      const message = screen.getByTestId("paused-message");
      expect(message).toHaveTextContent(/^Picks are paused until \d{1,2}:\d{2} (AM|PM) Eastern\. You can still make yours\.$/);
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  it("shows no paused message once pausedUntil is already in the past", () => {
    // The stale-payload case: an event set `pausedUntil` for a freeze that has since lifted, and
    // no later event has refreshed it (nothing happened overnight). `now` having already passed
    // it is what the live room reads, never the field alone.
    const resumeAt = new Date(Date.now() - 60_000).toISOString();
    render(<RoomRail {...props} view={liveView({ pausedUntil: resumeAt })} myTeamId="t2" />);
    expect(screen.queryByTestId("paused-message")).toBeNull();
  });

  it("never shows the paused message when the view carries no pausedUntil at all", () => {
    render(<RoomRail {...props} view={liveView({ pausedUntil: null })} myTeamId="t2" />);
    expect(screen.queryByTestId("paused-message")).toBeNull();
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

  // Sunday v5 (founder ruling 2026-08-28, "the UX should explain itself — we shouldn't need
  // tips"): the format-name and on-the-clock `InfoTip`s are gone outright, not merely re-gated by
  // `helpLevel` — "Snake draft"/"Auction draft" are plain `Badge` text, and the full definition
  // lives at `/league-rules` instead of a click-to-reveal trigger on the rail itself.
  it("stays a fixed-height-floor band and axe-clean, with no clickable tips at all, in both themes", async () => {
    await renderSurface(<RoomRail {...props} view={liveView()} myTeamId="t2" />, async ({ container }) => {
      expect(screen.getByText("Snake draft")).toBeInTheDocument();
      expect(screen.queryByRole("button")).not.toBeInTheDocument();
      expect(screen.getByTestId("room-rail").className).toContain("lg:min-h-20");
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  it("goes hot when the turn is mine, and stays calm when it is not", () => {
    const { rerender } = render(<RoomRail {...props} view={liveView()} myTeamId="t1" />);
    expect(screen.getByTestId("room-rail")).toHaveAttribute("data-mode", "hot");

    rerender(<RoomRail {...props} view={liveView()} myTeamId="t2" />);
    expect(screen.getByTestId("room-rail")).toHaveAttribute("data-mode", "watching");
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

  // N1/A2 (2026-08-27 flow analysis, "the live draft room has no way out"): the rail is the
  // room's own chrome — the `(room)` layout group declines the app shell on purpose, so this is
  // the ONLY place a way home can live. Two working links, present regardless of phase or
  // variant: the wordmark to `/app`, the league name to its own league.
  describe("the way home (N1/A2)", () => {
    it.each([
      ["scheduled" as const, { ...SNAKE_VIEW, phase: "scheduled" as const, ...finished }],
      ["in_progress" as const, liveView()],
      ["complete" as const, { ...SNAKE_VIEW, phase: "complete" as const, ...finished }],
    ])("renders both exits in the %s phase", (_phase, view) => {
      render(<RoomRail {...props} view={view} myTeamId="t1" />);
      expect(screen.getByRole("link", { name: "Commish" })).toHaveAttribute("href", "/app");
      expect(screen.getByRole("link", { name: props.leagueName })).toHaveAttribute("href", `/app/leagues/${view.leagueId}`);
    });

    it("renders NO exit links on the TV variant — an unattended screen has no clickable control", () => {
      // RULED (flow-remediation review D-3): this rail's own TV invariant wins. A party screen
      // is unattended; one bumped trackpad navigating it away from the board mid-draft is worse
      // than N1's dead end, and whoever opened that display still has the browser it opened in.
      render(<RoomRail {...props} view={liveView()} myTeamId={null} variant="tv" />);
      expect(screen.queryByRole("link", { name: "Commish" })).not.toBeInTheDocument();
      expect(screen.queryByRole("link", { name: props.leagueName })).not.toBeInTheDocument();
      // The league name still reads as the rail's own heading — it simply is not a control.
      expect(screen.getByRole("heading", { level: 1, name: props.leagueName })).toBeInTheDocument();
    });

    it("keeps the league name as the rail's h1, not merely a link beside it", () => {
      render(<RoomRail {...props} view={liveView()} myTeamId="t1" />);
      expect(screen.getByRole("heading", { level: 1, name: props.leagueName })).toBeInTheDocument();
    });
  });

  // Sunday v5: the standalone "Not started"/"Draft complete" headline is gone from this rail —
  // the lower third's own phase cell already shouts those two words, and this rail restating them
  // in an eyebrow was the "same fact stated twice, differently" pattern the room keeps finding in
  // itself. A finished draft still gets its one honest sentence here.
  it("drops the turn label once the draft is not in progress, and states the finished room plainly", () => {
    const { rerender } = render(<RoomRail {...props} view={{ ...SNAKE_VIEW, phase: "scheduled", ...finished }} myTeamId="t1" />);
    expect(screen.getByTestId("room-rail")).toHaveAttribute("data-mode", "scheduled");
    expect(screen.queryByTestId("turn-label")).toBeNull();

    rerender(<RoomRail {...props} view={{ ...SNAKE_VIEW, phase: "complete", ...finished }} myTeamId="t1" />);
    expect(screen.getByTestId("room-rail")).toHaveAttribute("data-mode", "complete");
    expect(screen.getByText("Every roster is final.")).toBeInTheDocument();
    expect(screen.queryByTestId("turn-label")).toBeNull();
  });

  // R2 (the draft-room design review, carried into this lane by Task 10): the scheduled rail
  // tells the real waiting story — a kickoff countdown and the trigger-aware sentence quoted
  // off the wire from the `describeStartTiming` authority (or `MOCK_COPY` for a practice room)
  // — never the commissioner sentence it used to hardcode, which was false for every house,
  // auto-start and mock room.
  describe("the scheduled waiting story (R2)", () => {
    const scheduledView: DraftStateView = { ...SNAKE_VIEW, phase: "scheduled", ...finished };

    it("counts down to kickoff and quotes the trigger-aware sentence — both themes, axe-clean", async () => {
      const waiting = {
        kickoffAt: new Date(Date.now() + 125_000).toISOString(),
        detail: describeStartTiming({ startTrigger: "scheduled", authority: "member" }),
      };
      await renderSurface(<RoomRail {...props} view={scheduledView} myTeamId="t1" waiting={waiting} />, async ({ container }) => {
        expect(screen.getByText(waiting.detail)).toBeInTheDocument();
        expect(screen.getByText("Starts in")).toBeInTheDocument();
        expect(screen.getByTestId("kickoff-countdown")).toHaveTextContent("2:05");
        expect(await axe(container)).toHaveNoViolations();
      });
    });

    it("shows the sentence alone when the trigger has no kickoff time (a when_full room)", () => {
      const waiting = { kickoffAt: null, detail: describeStartTiming({ startTrigger: "when_full", authority: "member" }) };
      render(<RoomRail {...props} view={scheduledView} myTeamId="t1" waiting={waiting} />);
      expect(screen.getByText(waiting.detail)).toBeInTheDocument();
      expect(screen.queryByTestId("kickoff-countdown")).toBeNull();
      expect(screen.queryByText("Starts in")).toBeNull();
    });

    it("carries a practice room's own waiting sentence and counts to its fill-window start", () => {
      // The detail is a PROP here, as every MOCK_COPY string reaching this room is — the string
      // itself is pinned to `MOCK_COPY.waitingDetail` by the snapshot route's own test.
      const waiting = {
        kickoffAt: new Date(Date.now() + 125_000).toISOString(),
        detail: "Practice opponents fill any open seats.",
      };
      render(<RoomRail {...props} view={scheduledView} myTeamId="t1" waiting={waiting} />);
      expect(screen.getByText(waiting.detail)).toBeInTheDocument();
      expect(screen.getByTestId("kickoff-countdown")).toHaveTextContent("2:05");
    });

    it("never guesses a commissioner into a room that has none — with no waiting info, nothing invented shows", () => {
      render(<RoomRail {...props} view={scheduledView} myTeamId="t1" />);
      expect(screen.queryByText(/commissioner/)).toBeNull();
      expect(screen.queryByTestId("kickoff-countdown")).toBeNull();
    });

    it("keeps the kickoff clock calm, and TV-sized on the TV variant", () => {
      const waiting = {
        kickoffAt: new Date(Date.now() + 125_000).toISOString(),
        detail: describeStartTiming({ startTrigger: "scheduled", authority: "house" }),
      };
      const { rerender } = render(<RoomRail {...props} view={scheduledView} myTeamId="t1" waiting={waiting} />);
      expect(screen.getByTestId("kickoff-countdown").className).toContain("text-text-primary");
      expect(screen.getByTestId("kickoff-countdown").className).toContain("text-3xl");
      rerender(<RoomRail {...props} view={scheduledView} myTeamId={null} variant="tv" waiting={waiting} />);
      expect(screen.getByTestId("kickoff-countdown").className).toContain("text-display-xl");
      expect(screen.getByText("Starts in").className).not.toMatch(/(^|\s)text-xs(\s|$)/);
    });

    it("ignores waiting info entirely once the draft is live — the tightening line owns the rail instead", () => {
      const waiting = { kickoffAt: new Date(Date.now() + 9_000_000).toISOString(), detail: "Stale sentence." };
      render(<RoomRail {...props} view={liveView()} myTeamId="t2" waiting={waiting} />);
      expect(screen.queryByTestId("kickoff-countdown")).toBeNull();
      expect(screen.queryByText("Stale sentence.")).toBeNull();
      expect(screen.getByText("Picks shorten to 10 minutes in 2h 14m")).toBeInTheDocument();
    });
  });

  it("names the lot rather than a round, and never claims a team is on the clock, during a live auction lot", async () => {
    const lotView: DraftStateView = {
      ...AUCTION_VIEW,
      onClockTeamId: null,
      deadlineAt: new Date(Date.now() + 45_000).toISOString(),
      auction: { minBid: 1, nominatingTeamId: null, lot: { playerId: "qb1", highBid: 12, highBidTeamId: "t2", nominatedByTeamId: "t1", autoNominated: false } },
    };
    await renderSurface(<RoomRail {...props} view={lotView} myTeamId="t1" />, async ({ container }) => {
      expect(screen.getByText("Auction draft")).toBeInTheDocument();
      expect(screen.getByTestId("turn-label")).toHaveTextContent("Lot 1");
      expect(screen.queryByText(/on the clock/i)).toBeNull();
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  it("goes hot while it's my turn to nominate, and stays calm when it's somebody else's", () => {
    const mineNominating: DraftStateView = { ...AUCTION_VIEW, onClockTeamId: null, auction: { nominatingTeamId: "t1", lot: null, minBid: 1 } };
    const { rerender } = render(<RoomRail {...props} view={mineNominating} myTeamId="t1" />);
    expect(screen.getByTestId("room-rail")).toHaveAttribute("data-mode", "hot");

    const theirsNominating: DraftStateView = { ...AUCTION_VIEW, onClockTeamId: null, auction: { nominatingTeamId: "t2", lot: null, minBid: 1 } };
    rerender(<RoomRail {...props} view={theirsNominating} myTeamId="t1" />);
    expect(screen.getByTestId("room-rail")).toHaveAttribute("data-mode", "watching");
  });

  // E9 (2026-08-26 design review): hot-state redundancy — "Your team: Bay Bandits" sat beside
  // "You're on the clock · Bay Bandits". While the turn is mine the turn line already names my
  // team; the chip returns the moment the turn moves on.
  it("suppresses the team chip while the turn is mine — the turn line already says it (E9)", () => {
    const { rerender } = render(<RoomRail {...props} view={liveView()} myTeamId="t1" />);
    expect(screen.getByTestId("room-rail")).toHaveAttribute("data-mode", "hot");
    expect(screen.queryByText(/Your team:/)).toBeNull();

    rerender(<RoomRail {...props} view={liveView()} myTeamId="t2" />);
    expect(screen.getByText(/Your team:/)).toBeInTheDocument();
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
    // A shared, unattended display has no clickable control at all.
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.getByTestId("room-rail")).toHaveAttribute("data-mode", "watching");
  });

  /** Rule 6, spent rather than merely obeyed: the clock genuinely is running out, and the dot
   *  is the product's existing "live" vocabulary (`animate-pulse-live`). It is decorative and
   *  `aria-hidden` — the turn label right beside it already says the same thing in words. */
  it("pulses a live dot beside the turn label only while the clock is yours", () => {
    const { rerender } = render(<RoomRail {...props} view={liveView()} myTeamId="t1" />);
    const dot = screen.getByTestId("on-clock-pulse");
    expect(dot.className).toContain("animate-pulse-live");
    expect(dot).toHaveAttribute("aria-hidden", "true");

    rerender(<RoomRail {...props} view={liveView()} myTeamId="t2" />);
    expect(screen.queryByTestId("on-clock-pulse")).toBeNull();
  });

  // Task 12 Step 3: "the one surface where `xs` never appears", scoped to this rail's OWN
  // authored labels (the turn label and the tightening line) — not the shared `Badge`/`Avatar`
  // chrome beside them, which stays fixed-size everywhere in the product (see `RAIL_EYEBROW`'s
  // own docblock for the stated carve-out).
  it("never drops its own labels to text-xs on the TV, across every mode", () => {
    const { rerender } = render(<RoomRail {...props} view={liveView()} myTeamId={null} variant="tv" />);
    expect(screen.getByTestId("turn-label").className).not.toMatch(/(^|\s)text-xs(\s|$)/);

    rerender(
      <RoomRail
        {...props}
        view={liveView({ nextTightening: { at: new Date(Date.now() + 134 * 60_000 + 30_000).toISOString(), pickSeconds: 600 } })}
        myTeamId={null}
        variant="tv"
      />,
    );
    expect(screen.getByText("Picks shorten to 10 minutes in 2h 14m").className).not.toMatch(/(^|\s)text-xs(\s|$)/);
  });
});
