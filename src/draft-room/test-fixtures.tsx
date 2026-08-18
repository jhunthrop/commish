import type { ReactElement } from "react";
import { render, type RenderResult } from "@testing-library/react";
import type { Player } from "@/domain/player";
import type { TeamCard } from "@/domain/league";
import type { DraftClockView, DraftStateView } from "@/draft-engine";
import { DraftRoomDepsProvider, type DraftRoomDeps, type EventSourceLike } from "./hooks/deps";

export const PLAYERS: readonly Player[] = [
  { id: "qb1", name: "Jalen Croft", position: "QB", nflTeam: "KC" },
  { id: "rb1", name: "Marcus Reed", position: "RB", nflTeam: "SF" },
  { id: "rb2", name: "Devon Marsh", position: "RB", nflTeam: "NYJ" },
  { id: "wr1", name: "Andre Salas", position: "WR", nflTeam: "DAL" },
];

export const LEAGUE_NAME = "Sunday Money";

export const TEAMS: readonly TeamCard[] = [
  { id: "t1", name: "Bay Bandits", ownerDisplayName: "Dana Whitfield", ownerAvatarUrl: null },
  { id: "t2", name: "Iron Owls", ownerDisplayName: "Rey Okafor", ownerAvatarUrl: null },
];

export const SNAKE_VIEW: DraftStateView = {
  phase: "in_progress",
  sequence: 1,
  pickNumber: 1,
  onClockTeamId: "t1",
  deadlineAt: "2026-09-01T00:02:05.000Z",
  clockSeconds: 28_800,
  nextTightening: { at: "2026-09-01T02:14:00.000Z", pickSeconds: 600 },
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
  auction: { nominatingTeamId: "t1", lot: null },
};

export function playersById(players: readonly Player[] = PLAYERS): ReadonlyMap<string, Player> {
  return new Map(players.map((player) => [player.id, player]));
}

/** The seven `DraftClockView` fields a view already carries — one shared clock literal
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
              : { ok: true, data: { draft: fixture.view, leagueName: LEAGUE_NAME, teamId: fixture.teamId, isCommissioner: false, teams: TEAMS, queue: fixture.queue } };
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
