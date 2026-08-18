import type { ReactElement } from "react";
import { render, type RenderResult } from "@testing-library/react";
import type { LeagueSummary, LineupBody, MatchupDetail, MatchupSummary, TeamStandingsRow } from "./contract";
import { LeagueRoomDepsProvider, type LeagueRoomDeps } from "./hooks/deps";

export const LEAGUES: readonly LeagueSummary[] = [
  {
    id: "l1", name: "Sunday Money", format: "snake", teamCount: 12, filledTeams: 8,
    isCommissioner: true, myTeamId: "t1", draftId: "d1", draftStatus: "scheduled",
  },
  {
    id: "l2", name: "Auction Night", format: "auction", teamCount: 10, filledTeams: 10,
    isCommissioner: false, myTeamId: "t9", draftId: "d2", draftStatus: "complete",
  },
];

/** Server rank order (wins, then points for, then team id) — never re-derived in a test. */
export const STANDINGS: readonly TeamStandingsRow[] = [
  { teamId: "t1", teamName: "Bay Bandits", wins: 9, losses: 4, ties: 0, pointsFor: 1412.5, pointsAgainst: 1200, clinched: true },
  { teamId: "t2", teamName: "Iron Owls", wins: 7, losses: 6, ties: 0, pointsFor: 1300, pointsAgainst: 1500, clinched: false },
  { teamId: "t3", teamName: "Comet Crew", wins: 5, losses: 8, ties: 0, pointsFor: 1100, pointsAgainst: 1350, clinched: false },
];

/** Every row clinched, as `clinchedTeamIds` degenerately reports for `playoffTeams >= teamCount`. */
export const ALL_CLINCHED_STANDINGS: readonly TeamStandingsRow[] = STANDINGS.map((row) => ({ ...row, clinched: true }));

export const LINEUP: LineupBody = {
  weekNumber: 5,
  locked: false,
  starters: [
    { slot: "QB", slotIndex: 0, playerId: "qb1", playerName: "Josh Allen", position: "QB" },
    { slot: "RB", slotIndex: 0, playerId: "rb1", playerName: "Derrick Henry", position: "RB" },
  ],
  bench: [
    { slot: "BENCH", slotIndex: 0, playerId: "qb2", playerName: "Backup Quarterback", position: "QB" },
  ],
};

export const MATCHUP: MatchupDetail = {
  weekNumber: 5,
  final: true,
  home: {
    teamId: "t1",
    teamName: "Bay Bandits",
    score: 112.5,
    starters: [
      { slot: "QB", slotIndex: 0, playerId: "qb1", playerName: "Josh Allen", position: "QB", points: 24.5 },
      { slot: "RB", slotIndex: 0, playerId: "rb1", playerName: "Derrick Henry", position: "RB", points: 18 },
    ],
    bench: [{ slot: "BENCH", slotIndex: 0, playerId: "qb2", playerName: "Backup Quarterback", position: "QB", points: 0 }],
  },
  away: {
    teamId: "t2",
    teamName: "Iron Owls",
    score: 98.25,
    starters: [{ slot: "QB", slotIndex: 0, playerId: "qb3", playerName: "Marcus Reed", position: "QB", points: 19.25 }],
    bench: [],
  },
};

/** A final week `t1` wins. */
export const WON: MatchupSummary = {
  weekNumber: 3,
  homeTeamId: "t1",
  awayTeamId: "t2",
  homeTeamName: "Bay Bandits",
  awayTeamName: "Iron Owls",
  homeScore: 112.5,
  awayScore: 98.25,
  final: true,
};

/** The reverse of `WON` — same week, `t1` loses. */
export const LOST: MatchupSummary = { ...WON, homeScore: 90, awayScore: 105 };

export interface FixtureLeagueDeps {
  deps: LeagueRoomDeps;
  readonly calls: string[];
  /** Mutable: set the envelope the next POST/PUT should answer with. */
  response: unknown;
}

/** One injected `fetchJson` for every league component. No module mocks, no real network. */
export function fixtureLeagueDeps(response: unknown = { ok: true, data: {} }): FixtureLeagueDeps {
  const fixture: FixtureLeagueDeps = {
    calls: [],
    response,
    deps: {
      fetchJson: async (url, init) => {
        fixture.calls.push(`${init?.method ?? "GET"} ${url}`);
        return { json: async () => fixture.response } as unknown as Response;
      },
    },
  };
  return fixture;
}

export function renderInLeague(ui: ReactElement, deps: LeagueRoomDeps): RenderResult {
  return render(<LeagueRoomDepsProvider deps={deps}>{ui}</LeagueRoomDepsProvider>);
}
