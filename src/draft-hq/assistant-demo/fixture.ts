/**
 * THE ADVISOR DEMO'S OWN FIXTURE. A headless, deterministic 10-team draft (`runOneDraft`,
 * `@/draft-service/sim/run`, the same real engine every mock room and Simulator run rides),
 * replayed pick by pick, with a REAL `AdvisorView` (`advisorCore`, `@/draft-service/assistant/
 * advisor`, over the room's own odds table from `simulateRoomOdds`) precomputed at every step for
 * the demo's own point-of-view seat. No database, no network: every player, projection and NFL
 * team code below is synthetic (labelled as such — `"RB 4"`, never a real athlete's name), but
 * every NUMBER the fixture hands the page is the real output of the real decision layer running
 * over that synthetic board — the odds are the simulator's own runs, the tiers are the board's
 * own. Nothing here invents a number; the fixture only invents the PLAYERS the real math then
 * runs over.
 *
 * COMPUTED ONCE, AT MODULE SCOPE, as plain JSON-safe data so it can cross the server-to-client
 * boundary as an ordinary prop. `DEMO_RUNS` continuations per step keep that one-time build
 * to a couple of seconds; the card states the count it was computed over.
 */
import type { DraftPoolEntry, MakePickAction, StartDraftAction } from "@/domain/draft";
import { DRAFT_ACTION_VERSION } from "@/domain/draft";
import type { Position } from "@/domain/player";
import { STANDARD_ROSTER_SLOTS } from "@/domain/roster";
import { initialDraftState, type DraftConfig, type DraftState } from "@/draft-engine";
import { advisorCore, seedFor } from "@/draft-service/assistant/advisor";
import { onClockShortlist, type ValuedEntry } from "@/draft-service/assistant/recommend";
import { tierCollapses } from "@/draft-service/assistant/signals";
import { tierStandings } from "@/draft-service/assistant/tiers";
import type { AdvisorView } from "@/draft-service/assistant/view";
import { simulateRoomOdds } from "@/draft-service/sim/room-odds";
import { runOneDraft, submit, SIM_INSTANT } from "@/draft-service/sim/run";
import { inferSeatDrivers } from "@/draft-service/sim/seat-model";
import { valueBoardIndexed, type LeagueShape } from "@/projections/decide/replacement";

/** Ten teams, four rounds — enough to show a run, a tier closing, a bye and this seat's own
 *  turns without a full 15-round draft to click through. */
export const DEMO_TEAM_COUNT = 10;
export const DEMO_ROUNDS = 4;
/** One fixed literal, never `Date.now()` — this IS the "seeded and reproducible" claim. */
export const DEMO_SEED = 20260905;
/** Continuations behind every odds number on the demo. Stated on the card. */
export const DEMO_RUNS = 100;

const DEMO_SEED_NAMESPACE = "assistant-demo";

const TEAM_IDS: readonly string[] = Array.from({ length: DEMO_TEAM_COUNT }, (_, i) => `team_${i + 1}`);
/** Seat 4 of 10 — neither first nor last, so the demo shows an ordinary snake turn. */
export const DEMO_POV_TEAM_ID = TEAM_IDS[3]!;

function demoTeamLabel(teamId: string): string {
  return teamId === DEMO_POV_TEAM_ID ? "You" : `Team ${TEAM_IDS.indexOf(teamId) + 1}`;
}

const POSITION_PLAN: readonly (readonly [Position, number])[] = [
  ["QB", 24],
  ["RB", 50],
  ["WR", 60],
  ["TE", 24],
  ["K", 12],
  ["DEF", 12],
];

const DEMO_NFL_TEAM_CODES: readonly string[] = Array.from({ length: 16 }, (_, i) => `DEMO${i + 1}`);
const DEMO_BYE_WEEKS: readonly (readonly [string, number])[] = DEMO_NFL_TEAM_CODES.map((code, i) => [code, 6 + (i % 9)] as const);

/** A believable, purely synthetic points curve: each position peaks at a different level and
 *  decays exponentially with rank, which is what produces the occasional real tier break. */
const PEAK_POINTS: Readonly<Record<Position, number>> = { QB: 380, RB: 340, WR: 320, TE: 250, K: 150, DEF: 155 };
const DECAY_SCALE: Readonly<Record<Position, number>> = { QB: 10, RB: 16, WR: 18, TE: 8, K: 6, DEF: 6 };

export interface DemoPlayer {
  readonly playerId: string;
  /** `"RB 4"` — position and within-position rank, never a name resembling a real athlete's. */
  readonly displayName: string;
  readonly position: Position;
  readonly nflTeam: string;
}

interface DemoPoolEntry extends DemoPlayer {
  readonly projectedPoints: number;
}

function buildPool(): readonly DemoPoolEntry[] {
  let nflTeamCursor = 0;
  const buckets = POSITION_PLAN.map(([position, count]) =>
    Array.from({ length: count }, (_, i): DemoPoolEntry => {
      const rank = i + 1;
      const points = PEAK_POINTS[position] * Math.exp(-i / DECAY_SCALE[position]);
      const nflTeam = DEMO_NFL_TEAM_CODES[nflTeamCursor % DEMO_NFL_TEAM_CODES.length]!;
      nflTeamCursor += 1;
      return { playerId: `${position.toLowerCase()}${rank}`, displayName: `${position} ${rank}`, position, nflTeam, projectedPoints: Math.round(points * 10) / 10 };
    }),
  );
  const ranked = buckets.flatMap((bucket, bucketIndex) => bucket.map((entry, i) => ({ entry, rank: (i + 0.5) / bucket.length, bucketIndex })));
  ranked.sort((a, b) => a.rank - b.rank || a.bucketIndex - b.bucketIndex);
  return ranked.map((r) => r.entry);
}

function evidenceRanks(pool: readonly DemoPoolEntry[]): ReadonlyMap<string, number> {
  const sorted = [...pool].sort((a, b) => b.projectedPoints - a.projectedPoints || a.playerId.localeCompare(b.playerId));
  return new Map(sorted.map((entry, index) => [entry.playerId, index + 1] as const));
}

export interface DemoPick {
  readonly pickNumber: number;
  readonly round: number;
  readonly teamId: string;
  readonly teamLabel: string;
  readonly playerId: string;
}

export interface AssistantDemoFixture {
  readonly povTeamId: string;
  readonly povLabel: string;
  readonly povSeatNumber: number;
  readonly teamCount: number;
  readonly rounds: number;
  readonly seed: number;
  readonly runs: number;
  readonly players: readonly DemoPlayer[];
  /** Every player id, best first by value over replacement: the order the demo's list reads in. */
  readonly boardOrder: readonly string[];
  readonly byeWeeksByTeam: readonly (readonly [string, number])[];
  /** In pick-number order, length `teamCount * rounds`. */
  readonly picks: readonly DemoPick[];
  /** The POV seat's own real `AdvisorView`, one per step — `advisor[k]` is the advisor as it
   *  stood after exactly `k` picks landed. Length `picks.length + 1`. */
  readonly advisor: readonly AdvisorView[];
}

function buildDraftConfig(): DraftConfig {
  return { draftId: `assistant_demo_${DEMO_SEED}`, leagueId: "assistant_demo", format: "snake", kickoffAt: SIM_INSTANT, auctionBudget: null, slotConfig: STANDARD_ROSTER_SLOTS, clockSchedule: [] };
}

function advisorAt(state: DraftState, valued: ReadonlyMap<string, ValuedEntry>, shape: LeagueShape, previous: AdvisorView | null): AdvisorView {
  const table = simulateRoomOdds({ state, seed: seedFor(DEMO_SEED_NAMESPACE, state.sequence), runs: DEMO_RUNS, drivers: inferSeatDrivers(state), excludeFromOnClockSeat: onClockShortlist(state, valued, shape) });
  const view = advisorCore({ state, askingTeamId: DEMO_POV_TEAM_ID, valued, shape, table, tiers: tierStandings(state, valued), collapses: tierCollapses(state, valued) });
  if (view !== null) return view;
  // Defensive only: an in-progress snake draft always owes every seat one more pick while
  // `DEMO_ROUNDS < totalRosterSlots`. Should it ever not, the last honest view stands.
  if (previous === null) throw new Error("assistant demo: the point-of-view seat has no turn to advise at all");
  return previous;
}

function buildFixture(): AssistantDemoFixture {
  const pool = buildPool();
  const draftPool: readonly DraftPoolEntry[] = pool.map((entry) => ({ playerId: entry.playerId, position: entry.position }));
  const shape: LeagueShape = { teamCount: DEMO_TEAM_COUNT, rosterSlots: STANDARD_ROSTER_SLOTS };
  const { sorted, byPlayerId } = valueBoardIndexed(pool.map((entry) => ({ playerId: entry.playerId, position: entry.position, projectedPoints: entry.projectedPoints })), shape);
  const adpByPlayerId = evidenceRanks(pool);
  const valued: ReadonlyMap<string, ValuedEntry> = new Map([...byPlayerId].map(([playerId, entry]) => [playerId, { ...entry, averageDraftPosition: adpByPlayerId.get(playerId)! }] as const));

  const runResult = runOneDraft({ teamIds: TEAM_IDS, board: draftPool, rosterSlots: STANDARD_ROSTER_SLOTS, rounds: DEMO_ROUNDS, seed: DEMO_SEED });
  const start: StartDraftAction = { v: DRAFT_ACTION_VERSION, type: "START_DRAFT", timestamp: SIM_INSTANT, draftOrder: TEAM_IDS, pool: draftPool, minBid: 1 };
  const states: DraftState[] = [submit(initialDraftState(buildDraftConfig()), start)];
  for (const pick of runResult.picks) {
    const action: MakePickAction = { v: DRAFT_ACTION_VERSION, type: "MAKE_PICK", timestamp: SIM_INSTANT, teamId: pick.teamId, playerId: pick.playerId };
    states.push(submit(states[states.length - 1]!, action));
  }

  const advisor = states.reduce<AdvisorView[]>((views, state) => [...views, advisorAt(state, valued, shape, views[views.length - 1] ?? null)], []);
  const picks: readonly DemoPick[] = runResult.picks.map((pick) => ({ pickNumber: pick.pickNumber, round: pick.round, teamId: pick.teamId, teamLabel: demoTeamLabel(pick.teamId), playerId: pick.playerId }));

  return {
    povTeamId: DEMO_POV_TEAM_ID,
    povLabel: "You",
    povSeatNumber: TEAM_IDS.indexOf(DEMO_POV_TEAM_ID) + 1,
    teamCount: DEMO_TEAM_COUNT,
    rounds: DEMO_ROUNDS,
    seed: DEMO_SEED,
    runs: DEMO_RUNS,
    players: pool.map(({ playerId, displayName, position, nflTeam }) => ({ playerId, displayName, position, nflTeam })),
    boardOrder: sorted.map((entry) => entry.playerId),
    byeWeeksByTeam: DEMO_BYE_WEEKS,
    picks,
    advisor,
  };
}

/** Built once, at module scope — see the module docblock. */
export const ASSISTANT_DEMO_FIXTURE: AssistantDemoFixture = buildFixture();
