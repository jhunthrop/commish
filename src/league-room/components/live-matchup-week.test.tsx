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
  gamesFinal: 3,
  gamesTotal: 8,
  matchups: [
    {
      weekNumber: 5,
      final: false,
      weekStatus: "in_progress",
      median: null,
      home: {
        teamId: "t1", teamName: "Bay Bandits", score: 10.5,
        starters: [{ slot: "QB", slotIndex: 0, playerId: "qb1", playerName: "Josh Allen", position: "QB", nflTeam: "BUF", headshotUrl: null, adp: null, points: 3.5 }],
        bench: [],
      },
      away: {
        teamId: "t2", teamName: "Iron Owls", score: 8.75,
        starters: [{ slot: "QB", slotIndex: 0, playerId: "qb2", playerName: "Marcus Reed", position: "QB", nflTeam: "BUF", headshotUrl: null, adp: null, points: 2.25 }],
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
    expect(screen.getByText("Live")).toBeInTheDocument();
  });

  // E1(a)+(c): the margin and the week's own games-final count, composed onto the caller's own
  // matchup from data this component already threads — `t1` (home, "You") leads 10.50 to 8.75.
  it("prints the margin and the games-final count on the caller's own matchup", () => {
    const fixture = fixtureLeagueDeps({ ok: true, data: WEEK_BODY });
    renderInLeague(<LiveMatchupWeek leagueId="l1" body={WEEK_BODY} />, fixture.deps);
    expect(screen.getByText("You are up 1.75. 3 of 8 games final.")).toBeInTheDocument();
  });

  // E3: one honest sentence for the whole page while the week is still mid-games, never repeated
  // per matchup panel — `gamesFinal`/`gamesTotal` are the same fact on every panel.
  it("says once, honestly, that stats are not final while the week is in progress", () => {
    const fixture = fixtureLeagueDeps({ ok: true, data: WEEK_BODY });
    renderInLeague(<LiveMatchupWeek leagueId="l1" body={WEEK_BODY} />, fixture.deps);
    expect(screen.getAllByText("These scores are live. They are not final until every game in the week ends.")).toHaveLength(1);
  });

  it("drops the not-final notice once a frame moves the week to final", async () => {
    const fixture = fixtureLeagueDeps({ ok: true, data: WEEK_BODY });
    renderInLeague(<LiveMatchupWeek leagueId="l1" body={WEEK_BODY} />, fixture.deps);

    act(() =>
      fixture.emit("score.update", {
        week: 5, status: "final", version: 5, gamesFinal: 8, gamesTotal: 8,
        scores: [{ teamId: "t1", points: 30 }, { teamId: "t2", points: 22 }],
      }),
    );
    await waitFor(() => expect(screen.getByText("Final")).toBeInTheDocument());
    expect(screen.queryByText(/They are not final/)).not.toBeInTheDocument();
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
    expect(screen.getByText("Live")).toBeInTheDocument();

    act(() =>
      fixture.emit("score.update", {
        week: 5, status: "final", version: 5, gamesFinal: 2, gamesTotal: 2,
        scores: [{ teamId: "t1", points: 30 }, { teamId: "t2", points: 22 }],
      }),
    );
    await waitFor(() => expect(screen.getByText("Final")).toBeInTheDocument());
    expect(screen.queryByText("Live")).not.toBeInTheDocument();
  });
});
