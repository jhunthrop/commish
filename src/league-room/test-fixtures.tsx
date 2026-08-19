import type { ReactElement } from "react";
import { render, type RenderResult } from "@testing-library/react";
import type { TeamCard } from "@/domain/league";
import { STANDARD_ROSTER_SLOTS } from "@/domain/roster";
import type { PublicLeagueSummary } from "@/matchmaking/contract";
import type { LeagueHomeBody, LineupBody, MatchupDetail, MatchupSummary, TeamStandingsRow } from "./contract";
import { LeagueRoomDepsProvider, type LeagueRoomDeps } from "./hooks/deps";

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
  weekStatus: "final",
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
  weekStatus: "final",
};

/** The reverse of `WON` — same week, `t1` loses. */
export const LOST: MatchupSummary = { ...WON, homeScore: 90, awayScore: 105 };

/** The teams `listTeamCards` would hand back for the three `STANDINGS` rows. Module-private —
 *  only consumed here, by `HOME` below. */
const TEAMS: readonly TeamCard[] = [
  { id: "t1", name: "Bay Bandits", ownerDisplayName: "Alex Rivera", ownerAvatarUrl: null },
  { id: "t2", name: "Iron Owls", ownerDisplayName: "Jordan Lee", ownerAvatarUrl: null },
  { id: "t3", name: "Comet Crew", ownerDisplayName: "Sam Patel", ownerAvatarUrl: null },
];

/** Everything `LeagueHome` needs: a commissioner, mid-season, drafted, `t1` up this week. */
export const HOME: LeagueHomeBody = {
  leagueId: "l1",
  name: "Sunday Money",
  format: "snake",
  teamCount: 12,
  rosterSlots: STANDARD_ROSTER_SLOTS,
  isCommissioner: true,
  myTeamId: "t1",
  teams: TEAMS,
  standings: STANDINGS,
  currentWeek: 3,
  totalWeeks: 14,
  myMatchup: WON,
  weekStatus: "final",
  draftId: "d1",
  draftStatus: "complete",
};

/** Module-private: only the return type of `fixtureLeagueDeps` below. */
interface FixtureLeagueDeps {
  deps: LeagueRoomDeps;
  readonly calls: string[];
  /** Mutable: set the envelope the next POST/PUT should answer with. */
  response: unknown;
  /** Push a frame down the fake stream, exactly as the SSE route would. */
  emit: (type: string, payload: unknown) => void;
  /** Fire the stream's own lifecycle events. */
  fire: (type: "open" | "error") => void;
  /** How many `fetchJson` calls are still unresolved. Always 0 unless `deferred` was set. */
  pending: () => number;
  /** Resolve the Nth still-unresolved request (0-based, in call order) with a specific envelope —
   *  only meaningful in deferred mode, which is what lets a test choose the ORDER two concurrent
   *  requests (or a request racing an SSE frame) resolve in. Mirrors `fixtureChatDeps`'s `settle`. */
  settle: (index: number, response: unknown) => Promise<void>;
}

/** One injected `fetchJson` + one fake `EventSource` for every league component. No module
 *  mocks, no real network — mirrors `fixtureChatDeps` (`@/chat-room/test-fixtures`). */
export function fixtureLeagueDeps(
  response: unknown = { ok: true, data: {} },
  options: { readonly deferred?: boolean } = {},
): FixtureLeagueDeps {
  const listeners = new Map<string, ((event: MessageEvent) => void)[]>();
  const waiting: ((response: unknown) => void)[] = [];
  const fixture: FixtureLeagueDeps = {
    calls: [],
    response,
    emit: (type, payload) => {
      for (const listener of listeners.get(type) ?? []) {
        listener({ data: JSON.stringify({ type, leagueId: "l1", payload }) } as MessageEvent);
      }
    },
    fire: (type) => {
      for (const listener of listeners.get(type) ?? []) listener({ data: "" } as MessageEvent);
    },
    pending: () => waiting.filter((entry) => entry !== undefined).length,
    settle: async (index, response) => {
      const resolve = waiting[index];
      if (resolve === undefined) throw new Error(`no pending request at index ${index}`);
      delete waiting[index];
      resolve(response);
      // Let the caller's own `await response.json()` continuation run before the test asserts.
      await Promise.resolve();
      await Promise.resolve();
    },
    deps: {
      fetchJson: async (url, init) => {
        fixture.calls.push(`${init?.method ?? "GET"} ${url}`);
        if (options.deferred !== true) {
          return { json: async () => fixture.response } as unknown as Response;
        }
        const index = waiting.length;
        const body = await new Promise<unknown>((resolve) => {
          waiting[index] = resolve;
        });
        return { json: async () => body } as unknown as Response;
      },
      openEventSource: () => ({
        addEventListener: (type, listener) => {
          listeners.set(type, [...(listeners.get(type) ?? []), listener]);
        },
        close: () => listeners.clear(),
      }),
    },
  };
  return fixture;
}

export function renderInLeague(ui: ReactElement, deps: LeagueRoomDeps): RenderResult {
  return render(<LeagueRoomDepsProvider deps={deps}>{ui}</LeagueRoomDepsProvider>);
}

/** Open leagues as `listPublicLeagues` hands them back: one nearly empty, one nearly full. */
export const PUBLIC_LEAGUES: readonly PublicLeagueSummary[] = [
  { id: "p1", name: "Rookie Snake Room", format: "snake", experienceTier: "beginner", stakeTier: 0, teamCount: 12, filledTeams: 3 },
  { id: "p2", name: "Sharks Only Auction", format: "auction", experienceTier: "experienced", stakeTier: 3, teamCount: 10, filledTeams: 9 },
];
