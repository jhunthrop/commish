import type { ReactElement } from "react";
import { render, type RenderResult } from "@testing-library/react";
import type { Player } from "@/domain/player";
import type { TeamCard } from "@/domain/league";
import type { DraftClockView, DraftStateView } from "@/draft-engine";
import type { MockRoomInfo, WaitingInfo } from "./contract";
import { DraftRoomDepsProvider, type DraftRoomDeps, type EventSourceLike } from "./hooks/deps";

export const PLAYERS: readonly Player[] = [
  // qb1 carries a headshot; the other three are null — one fixture set exercises both the
  // `Avatar` image branch and its initials fallback across every test that imports PLAYERS.
  { id: "qb1", name: "Jalen Croft", position: "QB", nflTeam: "KC", headshotUrl: "https://a.espncdn.com/i/headshots/nfl/players/full/qb1.png" },
  { id: "rb1", name: "Marcus Reed", position: "RB", nflTeam: "SF", headshotUrl: null },
  { id: "rb2", name: "Devon Marsh", position: "RB", nflTeam: "NYJ", headshotUrl: null },
  { id: "wr1", name: "Andre Salas", position: "WR", nflTeam: "DAL", headshotUrl: null },
];

export const LEAGUE_NAME = "Sunday Money";

export const TEAMS: readonly TeamCard[] = [
  { id: "t1", name: "Bay Bandits", ownerDisplayName: "Dana Whitfield", ownerAvatarUrl: null },
  { id: "t2", name: "Iron Owls", ownerDisplayName: "Rey Okafor", ownerAvatarUrl: null },
];

/** Task 8: the same two seats, one of them a bot — for every test that needs `TeamCard.isBot`
 *  actually set, rather than every caller redeclaring its own bot-flagged team literal. */
export const TEAMS_WITH_BOT: readonly TeamCard[] = [
  TEAMS[0]!,
  { id: "t2", name: "Turf Burners", ownerDisplayName: "Coach Parker", ownerAvatarUrl: null, isBot: true },
];

/** Task 8: `DraftSnapshotBody.mock` for an unstarted, non-link mock room — the shape most tests
 *  reach for; `share`/`results` are overridden per-case for the other two states. */
export const MOCK_ROOM: MockRoomInfo = {
  practiceBanner: "This is a mock draft. Nothing here counts, and this room clears itself after a day.",
  botMarkerLabel: "practice opponent",
  botBadge: "Bot",
  expectedBotPickSeconds: 6,
  share: null,
  results: null,
};

export const SNAKE_VIEW: DraftStateView = {
  phase: "in_progress",
  sequence: 1,
  pickNumber: 1,
  onClockTeamId: "t1",
  deadlineAt: "2026-09-01T00:02:05.000Z",
  clockSeconds: 28_800,
  nextTightening: { at: "2026-09-01T02:14:00.000Z", pickSeconds: 600 },
  upcoming: ["t1", "t2", "t2", "t1"],
  draftId: "d1",
  leagueId: "l1",
  format: "snake",
  slotConfig: [
    { slot: "QB", count: 1, eligiblePositions: ["QB"] },
    { slot: "RB", count: 2, eligiblePositions: ["RB"] },
  ],
  draftOrder: ["t1", "t2"],
  picks: [],
  rosters: { t1: [], t2: [] },
  budgets: {},
  auction: null,
  availablePlayerIds: ["qb1", "rb1", "rb2", "wr1"],
  minBid: null,
  maxBids: {},
};

export const AUCTION_VIEW: DraftStateView = {
  ...SNAKE_VIEW,
  format: "auction",
  onClockTeamId: "t1",
  budgets: { t1: 100, t2: 100 },
  minBid: 1,
  maxBids: { t1: 97, t2: 97 },
  auction: { nominatingTeamId: "t1", lot: null, minBid: 1 },
};

export function playersById(players: readonly Player[] = PLAYERS): ReadonlyMap<string, Player> {
  return new Map(players.map((player) => [player.id, player]));
}

/** The eight `DraftClockView` fields a view already carries — one shared clock literal
 *  instead of every test file hand-writing its own. */
export function clockOf(view: DraftStateView): DraftClockView {
  return {
    phase: view.phase,
    sequence: view.sequence,
    pickNumber: view.pickNumber,
    onClockTeamId: view.onClockTeamId,
    deadlineAt: view.deadlineAt,
    clockSeconds: view.clockSeconds,
    nextTightening: view.nextTightening,
    upcoming: view.upcoming,
  };
}

export class FakeEventSource implements EventSourceLike {
  closed = false;
  private readonly listeners = new Map<string, ((event: MessageEvent) => void)[]>();
  constructor(readonly url: string) {}
  addEventListener(type: string, listener: (event: MessageEvent) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  close(): void {
    this.closed = true;
  }
  emit(type: string, payload?: unknown): void {
    const data = payload === undefined ? "" : JSON.stringify({ id: "1-0", type, leagueId: "l1", timestamp: "2026-09-01T00:00:00.000Z", payload });
    for (const listener of this.listeners.get(type) ?? []) listener({ data } as unknown as MessageEvent);
  }
}

export interface FixtureDeps {
  /** Mutable: some cases swap in a failing `fetchJson` before mounting. */
  deps: DraftRoomDeps;
  readonly sources: FakeEventSource[];
  readonly calls: string[];
  /** Mutable: reassign before emitting an event to control what a resync refetch returns. */
  view: DraftStateView;
  teamId: string | null;
  postResponse: unknown;
  /** What the snapshot reports as the caller's own queue. */
  queue: readonly string[];
  /** What `POST /queue` answers with. */
  queueResponse: unknown;
  /** Task 8: what the snapshot reports for `DraftSnapshotBody.mock`. Defaults to `null` — every
   *  existing caller keeps testing a real league's own room unchanged. */
  mock: MockRoomInfo | null;
  /** R2: what the snapshot reports for `DraftSnapshotBody.waiting`. Defaults to `null` — the
   *  default `SNAKE_VIEW` is live, and a live room has no waiting story. */
  waiting: WaitingInfo | null;
}

/** Injected doubles for the whole room: no module mocks, no real network, no real EventSource. */
export function fixtureDeps(view: DraftStateView = SNAKE_VIEW): FixtureDeps {
  const fixture: FixtureDeps = {
    sources: [],
    calls: [],
    view,
    teamId: "t1",
    postResponse: { ok: true, data: { draft: view } },
    queue: [],
    queueResponse: { ok: true, data: { queue: [] } },
    mock: null,
    waiting: null,
    deps: {
      fetchJson: async (url, init) => {
        fixture.calls.push(`${init?.method ?? "GET"} ${url}`);
        const body = url.endsWith("/players")
          ? { ok: true, data: { players: PLAYERS } }
          : url.endsWith("/queue")
            ? init?.method === "POST"
              ? fixture.queueResponse
              : { ok: true, data: { queue: fixture.queue } }
            : init?.method === "POST"
              ? fixture.postResponse
              : {
              ok: true,
              data: {
                draft: fixture.view,
                leagueName: LEAGUE_NAME,
                teamId: fixture.teamId,
                isCommissioner: false,
                teams: TEAMS,
                queue: fixture.queue,
                mock: fixture.mock,
                waiting: fixture.waiting,
              },
            };
        return { json: async () => body } as unknown as Response;
      },
      openEventSource: (url) => {
        const source = new FakeEventSource(url);
        fixture.sources.push(source);
        return source;
      },
    },
  };
  return fixture;
}

export function renderInRoom(ui: ReactElement, deps: DraftRoomDeps): RenderResult {
  return render(<DraftRoomDepsProvider deps={deps}>{ui}</DraftRoomDepsProvider>);
}
