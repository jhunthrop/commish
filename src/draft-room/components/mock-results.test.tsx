import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { axe } from "vitest-axe";
import type { DraftStateView } from "@/draft-engine";
import { renderSurface } from "@/components/ui/test-utils";
import { PLAYERS, SNAKE_VIEW } from "../test-fixtures";
import { MockResults, type MockResultsCopy } from "./mock-results";

const COPY: MockResultsCopy = {
  heading: "Your practice draft is complete.",
  retentionSentence: "Your results stay here for 24 hours, then this room clears itself.",
  runAgainLabel: "Run another practice draft",
  openLobbyLabel: "Open the practice lobby",
  browseLeaguesLabel: "Browse real leagues",
};

const ACTIONS = {
  runAgain: <a href="/app/mock-drafts?create=solo">{COPY.runAgainLabel}</a>,
  openLobby: <a href="/app/mock-drafts">{COPY.openLobbyLabel}</a>,
  browseLeagues: <a href="/browse">{COPY.browseLeaguesLabel}</a>,
};

// PLAYERS (test-fixtures) is [qb1, rb1, rb2, wr1] — pool rank order 1..4.
const COMPLETE_VIEW: DraftStateView = {
  ...SNAKE_VIEW,
  phase: "complete",
  onClockTeamId: null,
  picks: [
    { pickNumber: 1, round: 1, teamId: "t1", playerId: "rb1", slot: "RB", slotIndex: 0, price: null, timestamp: "2026-09-01T00:00:00.000Z", auto: false },
    { pickNumber: 2, round: 1, teamId: "t2", playerId: "wr1", slot: "RB", slotIndex: 0, price: null, timestamp: "2026-09-01T00:01:00.000Z", auto: false },
  ],
  rosters: {
    t1: [
      { slot: "QB", slotIndex: 0, playerId: null },
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
  it("states the heading and retention sentence it is given, axe-clean in both themes", async () => {
    await renderSurface(
      <MockResults view={COMPLETE_VIEW} players={PLAYERS} myTeamId="t1" copy={COPY} actions={ACTIONS} />,
      async ({ container }) => {
        expect(screen.getByRole("heading", { name: COPY.heading, level: 1 })).toBeInTheDocument();
        expect(screen.getByText(COPY.retentionSentence)).toBeInTheDocument();
        expect(await axe(container)).toHaveNoViolations();
      },
    );
  });

  it("groups your roster by slot, marking an unfilled slot Open rather than leaving it blank", () => {
    render(<MockResults view={COMPLETE_VIEW} players={PLAYERS} myTeamId="t1" copy={COPY} actions={ACTIONS} />);
    const roster = screen.getByRole("list", { name: "Your roster" });
    expect(within(roster).getByText("Marcus Reed")).toBeInTheDocument();
    expect(within(roster).getAllByText("Open").length).toBeGreaterThan(0);
  });

  it("states each pick's honest board delta — the fact of this draft's own log, never a grade", () => {
    render(<MockResults view={COMPLETE_VIEW} players={PLAYERS} myTeamId="t1" copy={COPY} actions={ACTIONS} />);
    const picks = screen.getByRole("list", { name: "Your picks" });
    expect(within(picks).getByText("You took Marcus Reed at pick 1. The board ranked Marcus Reed 2nd.")).toBeInTheDocument();
    // Never a letter grade (ruling 5) — no A/B/C/D/F verdict anywhere on the panel.
    expect(screen.queryByText(/grade/i)).not.toBeInTheDocument();
  });

  it("never leaves the room a dead end — the three next actions always render", () => {
    render(<MockResults view={COMPLETE_VIEW} players={PLAYERS} myTeamId="t1" copy={COPY} actions={ACTIONS} />);
    expect(screen.getByRole("link", { name: COPY.runAgainLabel })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: COPY.openLobbyLabel })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: COPY.browseLeaguesLabel })).toBeInTheDocument();
  });

  it("says only the heading, retention line and actions for a commissioner with no team of their own", () => {
    render(<MockResults view={COMPLETE_VIEW} players={PLAYERS} myTeamId={null} copy={COPY} actions={ACTIONS} />);
    expect(screen.queryByRole("list", { name: "Your roster" })).not.toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Your picks" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: COPY.heading })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: COPY.browseLeaguesLabel })).toBeInTheDocument();
  });
});
