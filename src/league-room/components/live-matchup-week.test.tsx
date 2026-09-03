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
    // "Live" appears both as the hero's status marker and in the lower third's Week cell —
    // the point here is that the live state is on screen at all before any frame arrives.
    expect(screen.getAllByText("Live").length).toBeGreaterThan(0);
  });

  // E1(a)+(c), as law 6 rehomed them: the margin is a signed delta in the lower third's "Your
  // margin" cell (the prose sentence "You are up 1.75." is gone), and the games-final count is a
  // WEEK-WIDE fact stated once in the strip's "Games final" cell, never per panel.
  it("prints the margin as a delta and the games-final count once, in the lower third", () => {
    const fixture = fixtureLeagueDeps({ ok: true, data: WEEK_BODY });
    renderInLeague(<LiveMatchupWeek leagueId="l1" body={WEEK_BODY} />, fixture.deps);
    expect(screen.getByText("Your margin")).toBeInTheDocument();
    expect(screen.getByText("+1.75")).toBeInTheDocument();
    expect(screen.getAllByText("Games final")).toHaveLength(1);
    expect(screen.getAllByText("3/8")).toHaveLength(1);
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
    await waitFor(() => expect(screen.getAllByText("Final").length).toBeGreaterThan(0));
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
    expect(screen.getAllByText("Live").length).toBeGreaterThan(0);

    act(() =>
      fixture.emit("score.update", {
        week: 5, status: "final", version: 5, gamesFinal: 2, gamesTotal: 2,
        scores: [{ teamId: "t1", points: 30 }, { teamId: "t2", points: 22 }],
      }),
    );
    await waitFor(() => expect(screen.getAllByText("Final").length).toBeGreaterThan(0));
    expect(screen.queryByText("Live")).not.toBeInTheDocument();
  });
});
