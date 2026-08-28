import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { axe } from "vitest-axe";
import Link from "next/link";
import type { DraftStateView } from "@/draft-engine";
import { renderSurface } from "@/components/ui/test-utils";
import { MOCK_RESULTS_COPY, PLAYERS, SNAKE_VIEW, TEAMS } from "../test-fixtures";
import { MockResults } from "./mock-results";

const COPY = MOCK_RESULTS_COPY;

const ACTIONS = {
  runAgain: <Link href="/app/mock-drafts?create=solo">{COPY.runAgainLabel}</Link>,
  openLobby: <Link href="/app/mock-drafts">{COPY.openLobbyLabel}</Link>,
  browseLeagues: <Link href="/browse">{COPY.browseLeaguesLabel}</Link>,
};

// PLAYERS (test-fixtures) is [qb1, rb1, rb2, wr1] — pool rank order 1..4.
const COMPLETE_VIEW: DraftStateView = {
  ...SNAKE_VIEW,
  phase: "complete",
  onClockTeamId: null,
  picks: [
    { pickNumber: 1, round: 1, teamId: "t1", playerId: "rb1", slot: "RB", slotIndex: 0, price: null, timestamp: "2026-09-01T00:00:00.000Z", auto: false },
    { pickNumber: 2, round: 1, teamId: "t2", playerId: "wr1", slot: "RB", slotIndex: 0, price: null, timestamp: "2026-09-01T00:01:00.000Z", auto: false },
    // qb1 carries the fixture set's ONE real headshot URL — on t1's roster it is what lets the
    // D1 face assertion below see an <img> rather than the initials fallback.
    { pickNumber: 3, round: 2, teamId: "t1", playerId: "qb1", slot: "QB", slotIndex: 0, price: null, timestamp: "2026-09-01T00:02:00.000Z", auto: false },
  ],
  rosters: {
    t1: [
      { slot: "QB", slotIndex: 0, playerId: "qb1" },
      { slot: "RB", slotIndex: 0, playerId: "rb1" },
      { slot: "RB", slotIndex: 1, playerId: null },
    ],
    t2: [
      { slot: "QB", slotIndex: 0, playerId: null },
      { slot: "RB", slotIndex: 0, playerId: "wr1" },
      { slot: "RB", slotIndex: 1, playerId: null },
    ],
  },
};

describe("MockResults", () => {
  it("states the heading and meta line, restates NO retention (the banner owns it), axe-clean in both themes", async () => {
    await renderSurface(
      <MockResults teams={TEAMS} board={null} view={COMPLETE_VIEW} players={PLAYERS} myTeamId="t1" copy={COPY} actions={ACTIONS} />,
      async ({ container }) => {
        expect(screen.getByRole("heading", { name: COPY.heading, level: 1 })).toBeInTheDocument();
        // E3 (results review): the practice banner directly above this panel already says the
        // room clears itself — one retention fact per view, so the panel says it zero times.
        expect(screen.queryByText(COPY.retentionSentence)).not.toBeInTheDocument();
        // E5: the debrief's meta line — seat, shape, opponents — from data the props held.
        expect(screen.getByText(/seat \d+ of \d+/)).toBeInTheDocument();
        expect(screen.getByText(/practice opponents/)).toBeInTheDocument();
        expect(await axe(container)).toHaveNoViolations();
      },
    );
  });

  it("draws the roster with the rail's own row — the player's face and true position, dashed placeholders for open spots (D1/D2)", () => {
    render(<MockResults teams={TEAMS} board={null} view={COMPLETE_VIEW} players={PLAYERS} myTeamId="t1" copy={COPY} actions={ACTIONS} />);
    const roster = screen.getByRole("list", { name: "Your roster" });
    expect(within(roster).getByText("Marcus Reed")).toBeInTheDocument();
    // The shared RosterRow (roster-row.tsx): open spots read as the slot's own chip, exactly
    // as the rail draws them — the word "Open" was this panel's private idiom and is gone.
    expect(within(roster).queryByText("Open")).not.toBeInTheDocument();
    // Faces: qb1's fixture headshot renders when qb1 is on the roster.
    const rosterImgs = Array.from(roster.querySelectorAll("img"));
    expect(rosterImgs.length).toBeGreaterThan(0);
  });

  it("states each pick's honest board facts — the board's own best available at that position, never a raw rank", () => {
    render(<MockResults teams={TEAMS} board={null} view={COMPLETE_VIEW} players={PLAYERS} myTeamId="t1" copy={COPY} actions={ACTIONS} />);
    const picks = screen.getByRole("list", { name: "Your picks" });
    // rb1 (Marcus Reed) is the board's own best available RB at pick 1 — the D3 case exactly.
    // Tabular now (E1): number, face, name and the fact clause live in their own cells; the
    // prose lead-in that named every player twice is gone.
    expect(within(picks).getByText("Marcus Reed")).toBeInTheDocument();
    expect(within(picks).getByText(/The board's best RB available\. RB1 on the board\./)).toBeInTheDocument();
    expect(within(picks).queryByText(/You took/)).not.toBeInTheDocument();
    // Never a letter grade (ruling 5) — no A/B/C/D/F verdict anywhere on the panel.
    expect(screen.queryByText(/grade/i)).not.toBeInTheDocument();
    // Never a bare, un-normalized overall rank either (D3) — the defect this replaces.
    expect(screen.queryByText(/ranked \d/)).not.toBeInTheDocument();
  });

  it("never leaves the room a dead end — the three next actions always render", () => {
    render(<MockResults teams={TEAMS} board={null} view={COMPLETE_VIEW} players={PLAYERS} myTeamId="t1" copy={COPY} actions={ACTIONS} />);
    expect(screen.getByRole("link", { name: COPY.runAgainLabel })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: COPY.openLobbyLabel })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: COPY.browseLeaguesLabel })).toBeInTheDocument();
  });

  /**
   * FOUNDER 2026-08-27: "there's no navigation at the top of a finished mock draft." The actions
   * were rendering — the test above proves that, and proved it while the defect was live — but on
   * a desktop they sat below the roster AND a fifteen-round pick list, a full screen of scrolling
   * away from the headline. PRESENT is not the same as REACHABLE, so this pins the thing that was
   * actually broken: the way out precedes the log in document order, which is what puts it beside
   * the headline at every width.
   */
  it("puts the way out at the TOP, before the pick log a manager would otherwise scroll past", () => {
    render(<MockResults teams={TEAMS} board={null} view={COMPLETE_VIEW} players={PLAYERS} myTeamId="t1" copy={COPY} actions={ACTIONS} />);

    const runAgain = screen.getByRole("link", { name: COPY.runAgainLabel });
    const pickLog = screen.getByRole("list", { name: "Your picks" });

    // Node.compareDocumentPosition: FOLLOWING means the log comes after the action in the DOM.
    expect(runAgain.compareDocumentPosition(pickLog) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  /**
   * TASKS 7 AND 13. The page already recorded what you did; this is where it says whether it was
   * any good. The chips are the verdict on each pick, and the debrief above the log is what the
   * plan calls the story they accumulate into.
   *
   * Deliberately still NO letter grade (ruling 5, unchanged): a grade manufactures authority this
   * platform has not earned. A steal is arithmetic over this draft's own log.
   */
  describe("the debrief (Task 13)", () => {
    // qb1 is the board's first player and t1 took him at pick 10: nine picks past his rank. wr1
    // (rank 4) went to t2 at pick 2, two picks early. Both far enough out to clear the even band.
    const judgedView: DraftStateView = {
      ...COMPLETE_VIEW,
      picks: [
        { pickNumber: 2, round: 1, teamId: "t2", playerId: "wr1", slot: "RB", slotIndex: 0, price: null, timestamp: "2026-09-01T00:01:00.000Z", auto: false },
        { pickNumber: 9, round: 1, teamId: "t1", playerId: "rb1", slot: "RB", slotIndex: 0, price: null, timestamp: "2026-09-01T00:00:00.000Z", auto: false },
        { pickNumber: 10, round: 2, teamId: "t1", playerId: "qb1", slot: "QB", slotIndex: 0, price: null, timestamp: "2026-09-01T00:02:00.000Z", auto: false },
      ],
    };

    it("counts the steals and the reaches, and names the single best pick — axe-clean in both themes", async () => {
      await renderSurface(
        <MockResults teams={TEAMS} board={null} view={judgedView} players={PLAYERS} myTeamId="t1" copy={COPY} actions={ACTIONS} />,
        async ({ container }) => {
          const debrief = screen.getByTestId("mock-debrief");
          expect(within(debrief).getByText("Steals")).toBeInTheDocument();
          expect(within(debrief).getByText("2")).toBeInTheDocument();
          expect(within(debrief).getByText("Reaches")).toBeInTheDocument();
          expect(within(debrief).getByText("0")).toBeInTheDocument();
          // rb1 at pick 9 slipped seven; qb1 at pick 10 slipped nine, so qb1 is the best.
          expect(within(debrief).getByText("Best pick")).toBeInTheDocument();
          expect(within(debrief).getByText("Jalen Croft")).toBeInTheDocument();
          expect(within(debrief).getByText("+9")).toBeInTheDocument();
          expect(await axe(container)).toHaveNoViolations();
        },
      );
    });

    it("puts the verdict on each pick in the log, beside the fact it came from", () => {
      render(<MockResults teams={TEAMS} board={null} view={judgedView} players={PLAYERS} myTeamId="t1" copy={COPY} actions={ACTIONS} />);
      const picks = screen.getByRole("list", { name: "Your picks" });
      expect(within(picks).getByText("+7")).toBeInTheDocument();
      expect(within(picks).getByText("+9")).toBeInTheDocument();
      // The honest board fact is still there on every row — the chip is a second reading of it,
      // not a replacement for it.
      expect(within(picks).getAllByText(/on the board\./)).toHaveLength(2);
    });

    /** An honest silence. A manager who never beat the board gets no "best pick" rather than a
     *  best that was merely least bad. */
    it("names no best pick when nothing beat the board", () => {
      render(<MockResults teams={TEAMS} board={null} view={COMPLETE_VIEW} players={PLAYERS} myTeamId="t1" copy={COPY} actions={ACTIONS} />);
      const debrief = screen.getByTestId("mock-debrief");
      expect(within(debrief).queryByText("Best pick")).not.toBeInTheDocument();
      expect(within(debrief).getByText("Steals")).toBeInTheDocument();
    });

    it("says the count in the singular when there is exactly one", () => {
      // A reach needs a board rank further down than the four-player fixture reaches, so this
      // case gets a deeper pool: `deep11` sits at rank 12 and goes first overall.
      const deepPool = [
        ...PLAYERS,
        ...Array.from({ length: 8 }, (_, index) => ({ id: `deep${index + 4}`, name: `Deep Player ${index + 4}`, position: "WR" as const, nflTeam: "DAL", headshotUrl: null, adp: index + 12 })),
      ];
      const oneEach: DraftStateView = {
        ...COMPLETE_VIEW,
        picks: [
          { pickNumber: 1, round: 1, teamId: "t1", playerId: "deep11", slot: "RB", slotIndex: 0, price: null, timestamp: "2026-09-01T00:00:00.000Z", auto: false },
          { pickNumber: 10, round: 2, teamId: "t1", playerId: "qb1", slot: "QB", slotIndex: 0, price: null, timestamp: "2026-09-01T00:02:00.000Z", auto: false },
        ],
      };
      render(<MockResults teams={TEAMS} board={null} view={oneEach} players={deepPool} myTeamId="t1" copy={COPY} actions={ACTIONS} />);
      const debrief = screen.getByTestId("mock-debrief");
      expect(within(debrief).getByText("Steal")).toBeInTheDocument();
      expect(within(debrief).getByText("Reach")).toBeInTheDocument();
    });

    it("tells a commissioner with no seat no story at all — there are no picks to have one about", () => {
      render(<MockResults teams={TEAMS} board={null} view={judgedView} players={PLAYERS} myTeamId={null} copy={COPY} actions={ACTIONS} />);
      expect(screen.queryByTestId("mock-debrief")).not.toBeInTheDocument();
    });
  });

  it("gives a commissioner with no team the heading, the actions, and the room's own finished board (E7)", () => {
    render(
      <MockResults teams={TEAMS} board={<p>the finished board</p>} view={COMPLETE_VIEW} players={PLAYERS} myTeamId={null} copy={COPY} actions={ACTIONS} />,
    );
    expect(screen.queryByRole("list", { name: "Your roster" })).not.toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Your picks" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: COPY.heading })).toBeInTheDocument();
    expect(screen.getByText("the finished board")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: COPY.browseLeaguesLabel })).toBeInTheDocument();
  });
});
