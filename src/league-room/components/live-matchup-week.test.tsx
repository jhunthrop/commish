import { describe, it, expect } from "vitest";
import { act, screen, waitFor } from "@testing-library/react";
import type { MatchupWeekBody } from "../contract";
import { fixtureLeagueDeps, renderInLeague } from "../test-fixtures";
import { LiveMatchupWeek } from "./live-matchup-week";

// Team scores are chosen so they never collide with a starter's own points column — a single
// number appearing in both places would make `getByText` ambiguous and mask the real assertion.
const WEEK_BODY: MatchupWeekBody = {
  leagueId: "l1",
  weekNumber: 5,
  totalWeeks: 14,
  myTeamId: "t1",
  weekStatus: "in_progress",
  matchups: [
    {
      weekNumber: 5,
      final: false,
      weekStatus: "in_progress",
      median: null,
      home: {
        teamId: "t1", teamName: "Bay Bandits", score: 10.5,
        starters: [{ slot: "QB", slotIndex: 0, playerId: "qb1", playerName: "Josh Allen", position: "QB", points: 3.5 }],
        bench: [],
      },
      away: {
        teamId: "t2", teamName: "Iron Owls", score: 8.75,
        starters: [{ slot: "QB", slotIndex: 0, playerId: "qb2", playerName: "Marcus Reed", position: "QB", points: 2.25 }],
        bench: [],
      },
    },
  ],
};

describe("LiveMatchupWeek", () => {
  it("renders the server-rendered snapshot immediately, before any frame arrives", () => {
    const fixture = fixtureLeagueDeps({ ok: true, data: WEEK_BODY });
    renderInLeague(<LiveMatchupWeek leagueId="l1" body={WEEK_BODY} />, fixture.deps);
    expect(screen.getByText("10.50")).toBeInTheDocument();
    expect(screen.getByText("8.75")).toBeInTheDocument();
    expect(screen.getByText("In progress")).toBeInTheDocument();
  });

  it("folds a score.update frame into the displayed score", async () => {
    const fixture = fixtureLeagueDeps({ ok: true, data: WEEK_BODY });
    renderInLeague(<LiveMatchupWeek leagueId="l1" body={WEEK_BODY} />, fixture.deps);

    act(() =>
      fixture.emit("score.update", {
        week: 5, status: "in_progress", version: 1, gamesFinal: 0, gamesTotal: 2,
        scores: [{ teamId: "t1", points: 24.5 }],
      }),
    );
    await waitFor(() => expect(screen.getByText("24.50")).toBeInTheDocument());
    // t2 wasn't in that frame — its last-known score must still be on screen, not blanked.
    expect(screen.getByText("8.75")).toBeInTheDocument();
  });

  it("updates the badge when a frame moves the week to final", async () => {
    const fixture = fixtureLeagueDeps({ ok: true, data: WEEK_BODY });
    renderInLeague(<LiveMatchupWeek leagueId="l1" body={WEEK_BODY} />, fixture.deps);
    expect(screen.getByText("In progress")).toBeInTheDocument();

    act(() =>
      fixture.emit("score.update", {
        week: 5, status: "final", version: 5, gamesFinal: 2, gamesTotal: 2,
        scores: [{ teamId: "t1", points: 30 }, { teamId: "t2", points: 22 }],
      }),
    );
    await waitFor(() => expect(screen.getByText("Final")).toBeInTheDocument());
    expect(screen.queryByText("In progress")).not.toBeInTheDocument();
  });
});
