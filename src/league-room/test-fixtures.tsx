import type { ReactElement } from "react";
import { render, type RenderResult } from "@testing-library/react";
import { STANDARD_ROSTER_SLOTS } from "@/domain/roster";
import type { LeagueTerms } from "@/league";
import { MATCHMAKING_CONFIG } from "@/matchmaking/config";
import type { PublicLeagueSummary } from "@/matchmaking/contract";
import type { DraftScheduleBody, LeagueHomeBody, LeagueMemberCard, LineupBody, MatchupDetail, MatchupSummary, RoomData, TeamStandingsRow } from "./contract";
import { LeagueRoomDepsProvider, type LeagueRoomDeps } from "./hooks/deps";

/** Server rank order (wins, then points for, then team id) — never re-derived in a test. */
export const STANDINGS: readonly TeamStandingsRow[] = [
  { teamId: "t1", teamName: "Bay Bandits", wins: 9, losses: 4, ties: 0, pointsFor: 1412.5, pointsAgainst: 1200, clinched: true, ownerDisplayName: "Alex Rivera", ownerAvatar: null, rank: 1, previousRank: 2, streak: "W3" },
  { teamId: "t2", teamName: "Iron Owls", wins: 7, losses: 6, ties: 0, pointsFor: 1300, pointsAgainst: 1500, clinched: false, ownerDisplayName: "Jordan Lee", ownerAvatar: null, rank: 2, previousRank: 1, streak: "L1" },
  { teamId: "t3", teamName: "Comet Crew", wins: 5, losses: 8, ties: 0, pointsFor: 1100, pointsAgainst: 1350, clinched: false, ownerDisplayName: "Sam Patel", ownerAvatar: null, rank: 3, previousRank: 3, streak: "L2" },
];

/** Every row clinched, as `clinchedTeamIds` degenerately reports for `playoffTeams >= teamCount`. */
export const ALL_CLINCHED_STANDINGS: readonly TeamStandingsRow[] = STANDINGS.map((row) => ({ ...row, clinched: true }));

export const LINEUP: LineupBody = {
  weekNumber: 5,
  locked: false,
  lockedPlayerIds: [],
  injuredReserve: [],
  starters: [
    { slot: "QB", slotIndex: 0, playerId: "qb1", playerName: "Josh Allen", position: "QB", nflTeam: "BUF", headshotUrl: null, adp: null },
    { slot: "RB", slotIndex: 0, playerId: "rb1", playerName: "Derrick Henry", position: "RB", nflTeam: "BUF", headshotUrl: null, adp: null },
  ],
  bench: [
    { slot: "BENCH", slotIndex: 0, playerId: "qb2", playerName: "Backup Quarterback", position: "QB", nflTeam: "BUF", headshotUrl: null, adp: null },
  ],
};

export const MATCHUP: MatchupDetail = {
  weekNumber: 5,
  final: true,
  weekStatus: "final",
  median: null,
  home: {
    teamId: "t1",
    teamName: "Bay Bandits",
    score: 112.5,
    starters: [
      { slot: "QB", slotIndex: 0, playerId: "qb1", playerName: "Josh Allen", position: "QB", nflTeam: "BUF", headshotUrl: null, adp: null, points: 24.5 },
      { slot: "RB", slotIndex: 0, playerId: "rb1", playerName: "Derrick Henry", position: "RB", nflTeam: "BUF", headshotUrl: null, adp: null, points: 18 },
    ],
    bench: [{ slot: "BENCH", slotIndex: 0, playerId: "qb2", playerName: "Backup Quarterback", position: "QB", nflTeam: "BUF", headshotUrl: null, adp: null, points: 0 }],
  },
  away: {
    teamId: "t2",
    teamName: "Iron Owls",
    score: 98.25,
    starters: [{ slot: "QB", slotIndex: 0, playerId: "qb3", playerName: "Marcus Reed", position: "QB", nflTeam: "BUF", headshotUrl: null, adp: null, points: 19.25 }],
    bench: [],
  },
};

/** `MATCHUP`, but a median league whose week has settled: `t1` (home, 112.5) beat the 104.2
 *  median, `t2` (away, 98.25) missed it — a win and a loss against the SAME median score, so a
 *  test asserting both sentences at once proves the panel reads `homeResult`/`awayResult`
 *  independently rather than copying one side's result onto the other. */
export const MATCHUP_WITH_MEDIAN: MatchupDetail = {
  ...MATCHUP,
  median: { score: 104.2, homeResult: "win", awayResult: "loss" },
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

/** The members `leagueHome` would hand back for the three `STANDINGS` rows: `t1`'s owner is
 *  also the league's commissioner. Module-private — only consumed here, by `HOME` below. */
const TEAMS: readonly LeagueMemberCard[] = [
  { id: "t1", name: "Bay Bandits", ownerDisplayName: "Alex Rivera", ownerAvatarUrl: null, ownerUserId: "u1" },
  { id: "t2", name: "Iron Owls", ownerDisplayName: "Jordan Lee", ownerAvatarUrl: null, ownerUserId: "u2" },
  { id: "t3", name: "Comet Crew", ownerDisplayName: "Sam Patel", ownerAvatarUrl: null, ownerUserId: "u3" },
];

/** What `leagueTerms` (`@/league`) would assemble for this exact league — built here by hand
 *  rather than by calling the real function, since `src/league-room/**` may not value-import
 *  `@/league` at all (see "The client boundary", `docs/league.md`); only its type is imported
 *  above. The values mirror `HOME`'s own fields (`t1`'s owner, `u1`, is the commissioner) so a
 *  test comparing this fixture against a rendered `LeagueTermsPanel` sees consistent facts. */
export const TERMS: LeagueTerms = {
  name: "Sunday Money",
  format: "snake",
  teamCount: 12,
  filledTeams: TEAMS.length,
  scoringLabel: "PPR",
  rosterLine: "1 QB, 2 RB, 2 WR, 1 TE, 1 FLEX, 1 K, 1 DEF, 6 bench",
  stakeLabel: "Friendly",
  stakeDisclosure: MATCHMAKING_CONFIG.stakeDisclosure,
  entryFeeCents: 0,
  commissionerName: "Alex Rivera",
  commissionerAvatar: null,
  draftAt: "Saturday 12 September, 7:00 PM UTC (in 3 days)",
  formatNotes: [],
};

/** `DraftSchedulePanel`'s entire initial read, as `leagueHome` (`@/league-service/read.ts`)
 *  assembles it — matches `HOME.draftId`/`draftStatus` below exactly, since the two are built
 *  from the same draft row in production. */
/**
 * A week out from whenever the suite actually runs, not a pinned fake clock — the same "read the
 * real clock on both sides" reasoning `draft-schedule-panel.test.tsx`'s own `SCHEDULED` fixture
 * states. A fixed near-term literal here (previously a single hardcoded date) drifted into the
 * past against the real advancing clock the moment "now" caught up to it, which is exactly the
 * calendar-drift class of bug this plan's own `Clock` discipline exists to prevent.
 */
const DRAFT_SCHEDULE_KICKOFF = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

export const DRAFT_SCHEDULE: DraftScheduleBody = {
  draftId: "d1",
  leagueId: "l1",
  status: "complete",
  kickoffAt: DRAFT_SCHEDULE_KICKOFF,
  isPublicMatchmade: false,
  startTrigger: "scheduled",
  kickoffRolls: 0,
  filledTeams: TEAMS.length,
  // Task 6, Phase 3.5: NFFC's Kentucky Derby System. `t1` ranked slot 3 first and got it.
  slotPreference: { slotCount: 12, ranking: [3, 1], assignedSlot: 3, canEdit: false },
  // Task 9: `HOME.myTeamId` ("t1") did not miss anything in this base fixture — a test that wants
  // the missed-draft state builds its own league from `WaitingRoomLeague`, not this one.
  missedDraft: false,
};

/** Everything the room reads off one league: a commissioner, mid-season, drafted, `t1` up this week. */
export const HOME: LeagueHomeBody = {
  leagueId: "l1",
  name: "Sunday Money",
  format: "snake",
  teamCount: 12,
  rosterSlots: STANDARD_ROSTER_SLOTS,
  isCommissioner: true,
  authority: { kind: "member", userId: "u1" },
  myTeamId: "t1",
  teams: TEAMS,
  standings: STANDINGS,
  medianGame: false,
  terms: TERMS,
  currentWeek: 3,
  totalWeeks: 14,
  myMatchup: WON,
  weekStatus: "final",
  draftId: "d1",
  draftStatus: "complete",
  draftSchedule: DRAFT_SCHEDULE,
  justSeated: false,
  compositionCategory: "open",
};

/** Everything `RoomShell` needs, built from the fixtures above: mid-season, drafted, the week
 *  final (the resting room), one bench quarterback, no open trades and no filed claims. A test
 *  that wants another stage overrides `home.weekStatus`/`trades`/the lineup. */
export const ROOM_DATA: RoomData = {
  home: HOME,
  lineup: LINEUP,
  week: {
    leagueId: "l1",
    weekNumber: 3,
    totalWeeks: 14,
    myTeamId: "t1",
    matchups: [MATCHUP],
    weekStatus: "final",
    gamesFinal: 16,
    gamesTotal: 16,
  },
  projectionsByPlayerId: new Map([
    ["qb1", 21.4],
    ["rb1", 15.8],
    ["qb2", 9.1],
  ]),
  fixturesByNflTeam: new Map([["BUF", { opp: "vs MIA", when: "Sun 1:00p", status: "scheduled" }]]),
  byeWeeksByNflTeam: new Map([["BUF", 12]]),
  trades: null,
  pendingClaims: [],
  activityRows: [],
  activityNextBefore: null,
  activityNotices: [],
  tradeContext: {
    weekNumber: 3,
    myTeamId: "t1",
    counterparties: [{ teamId: "t2", teamName: "Iron Owls" }],
    rostersByTeamId: {},
    leagueName: "Sunday Money",
  },
  helpLevel: "standard",
};

/** Three managers, an open seat implied by `teamCount`, and `t1`'s owner running the league —
 *  the fixture `LeagueMembersPanel`'s own tests build on (`components/league-members-panel.test.tsx`). */
export const THREE_TEAMS: readonly LeagueMemberCard[] = TEAMS;

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

/** Open leagues as `listPublicLeagues` hands them back: one nearly empty, one nearly full — and
 *  one all-newcomer composition, one veteran-leaning composition, so a consumer's rendering of
 *  BOTH `TIER_COMPOSITION_LABEL` buckets it is likely to show has real fixture data to render. */
export const PUBLIC_LEAGUES: readonly PublicLeagueSummary[] = [
  { id: "p1", name: "Rookie Snake Room", format: "snake", experienceTier: "beginner", stakeTier: 0, entryFeeCents: 0, teamCount: 12, filledTeams: 3, scoringLabel: "Standard", compositionCategory: "all_newcomers", draftAt: "Saturday 12 September, 7:00 PM UTC (in 3 days)", medianGame: false, startTrigger: "scheduled", houseRung: null, heldSeats: 0, rosterSummary: "15 slots, 1 flex", playoffWeeks: [15, 16, 17], kickoffRolls: 0 },
  { id: "p2", name: "Sharks Only Auction", format: "auction", experienceTier: "experienced", stakeTier: 3, entryFeeCents: 0, teamCount: 10, filledTeams: 9, scoringLabel: "PPR", compositionCategory: "open", draftAt: "Sunday 13 September, 1:00 PM UTC (in 4 days)", medianGame: false, startTrigger: "scheduled", houseRung: null, heldSeats: 0, rosterSummary: "15 slots, 1 flex", playoffWeeks: [15, 16, 17], kickoffRolls: 0 },
];
