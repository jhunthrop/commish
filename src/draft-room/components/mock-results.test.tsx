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
    // Tabular now (E1): number, face, name, the position rank (its own sticker) and the fact
    // clause live in their own cells; the prose lead-in that named every player twice, and the
    // raw rank the clause used to repeat in prose ("RB1 on the board."), are both gone — the
    // rank rides the sticker the pool has always drawn (`PositionBadge`'s own `rank` prop).
    expect(within(picks).getByText("Marcus Reed")).toBeInTheDocument();
    expect(within(picks).getByText("RB1")).toBeInTheDocument();
    expect(within(picks).getByText("Best RB available")).toBeInTheDocument();
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
   * away from the headline. PRESENT is not the same as REACHABLE, so this originally pinned the
   * thing that was actually broken: the way out precedes the log in document order.
   *
   * SUNDAY v5 LAW 6 split "the way out" in two. The two ways OUT (open the lobby, browse real
   * leagues) still ride the headline, ahead of the log — the founder's original fix, unchanged.
   * The one ACT ("Run another mock draft") moved into the debrief's own lower third at the foot
   * of the page (this component's own docblock: "law 6 gives the verb a place... it goes last in
   * the strip") — deliberately AFTER the log now, since the debrief that names it is itself built
   * from the log's own verdicts.
   */
  it("keeps the two ways out at the TOP before the pick log, while the one verb waits in the debrief strip below it (law 6)", () => {
    render(<MockResults teams={TEAMS} board={null} view={COMPLETE_VIEW} players={PLAYERS} myTeamId="t1" copy={COPY} actions={ACTIONS} />);

    const openLobby = screen.getByRole("link", { name: COPY.openLobbyLabel });
    const browseLeagues = screen.getByRole("link", { name: COPY.browseLeaguesLabel });
    const runAgain = screen.getByRole("link", { name: COPY.runAgainLabel });
    const pickLog = screen.getByRole("list", { name: "Your picks" });

    // Node.compareDocumentPosition: FOLLOWING means the log comes after the node in the DOM.
    expect(openLobby.compareDocumentPosition(pickLog) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(browseLeagues.compareDocumentPosition(pickLog) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(pickLog.compareDocumentPosition(runAgain) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
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
      // not a replacement for it. rb1 (pick 9) is the board's own best RB still there; qb1
      // (pick 10) is the board's own best player overall — the position rank both facts used to
      // restate in prose ("RB1 on the board.") now rides each row's own sticker instead.
      expect(within(picks).getByText("Best RB available")).toBeInTheDocument();
      expect(within(picks).getByText("Best available")).toBeInTheDocument();
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

    // A commissioner with no seat has no picks to judge, so `judgedPicks` is empty and the two
    // counts are honestly zero rather than fabricated — the strip itself still renders (it also
    // carries the room's one act, "Run another mock draft", which nothing else on the page owns
    // for this caller) but names no "Best pick", since nothing was there to beat the board.
    it("shows honest zero counts and no best pick for a commissioner with no seat — there are no picks to judge", () => {
      render(<MockResults teams={TEAMS} board={null} view={judgedView} players={PLAYERS} myTeamId={null} copy={COPY} actions={ACTIONS} />);
      const debrief = screen.getByTestId("mock-debrief");
      expect(within(debrief).getByText("Steals")).toBeInTheDocument();
      expect(within(debrief).getByText("Reaches")).toBeInTheDocument();
      expect(within(debrief).getAllByText("0")).toHaveLength(2);
      expect(within(debrief).queryByText("Best pick")).not.toBeInTheDocument();
      expect(within(debrief).getByRole("link", { name: COPY.runAgainLabel })).toBeInTheDocument();
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
