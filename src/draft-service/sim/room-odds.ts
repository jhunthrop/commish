/**
 * THE ROOM'S ODDS TABLE — one simulation per room state, serving every seat (the founder's cost
 * ruling, simplification round). Survival before a seat's next turn depends only on the picks
 * made before that turn, so `runs` seeded continuations of the SAME live state, each played
 * through the furthest "next turn" any seat in the room has, record every pick they made, and a
 * viewer's numbers are a slice of that record:
 *
 * - SURVIVAL for seat S at its next pick N: the fraction of runs that reached N in which the
 *   player had not been taken before N by ANOTHER seat. A pick by S itself before N (only the
 *   on-clock seat's own current pick can be one) never counts as gone, because the question the
 *   card asks is "if you pass on him now".
 * - SEATS AHEAD for seat S: every pick between now and N, tallied from the same runs — the
 *   position and the player that pick landed on most often, with the share.
 *
 * The furthest next turn in a snake is under two rounds away (a seat at the turn boundary), so
 * a run is at most `2 * teamCount - 1` picks. Nothing here estimates survival any other way.
 */
import type { Position } from "@research/domain/player";
import { availablePool, snakeTeamForPick, teamOnClock, totalPickCount, type DraftState } from "@/draft-engine";
import { continueRoom, type PlayedPick } from "./continue";
import type { SeatDrivers } from "./seat-model";

export const ROOM_ODDS_RUNS = 200;

export interface RoomOddsInput {
  readonly state: DraftState;
  readonly seed: number;
  readonly runs?: number;
  readonly drivers?: SeatDrivers;
  /** The on-clock seat's own shortlist, held on the board for its current pick (ruling R-3). */
  readonly excludeFromOnClockSeat: ReadonlySet<string>;
}

export interface RoomOddsTable {
  readonly runs: number;
  /** The pick the runs started from: the room's current pick. */
  readonly fromPick: number;
  /** The last pick number the runs played, or `fromPick - 1` when no seat has a next turn. */
  readonly throughPick: number;
  /** One entry per run: every pick that run made, in pick order. */
  readonly played: readonly (readonly PlayedPick[])[];
}

export interface SeatTendencyShare<T> {
  readonly value: T;
  readonly share: number;
}

export interface SeatTendency {
  readonly teamId: string;
  readonly pickNumber: number;
  /** Runs in which this pick was played. */
  readonly runs: number;
  readonly topPosition: SeatTendencyShare<Position> | null;
  readonly topPlayer: SeatTendencyShare<string> | null;
}

export interface SeatSurvival {
  /** The seat's next pick number, the turn the odds are measured at. */
  readonly pickNumber: number;
  /** Runs that reached that turn before the draft ended — the fraction's denominator. */
  readonly runsReached: number;
  /** Every undrafted player id -> runs (of `runsReached`) in which he was still there. */
  readonly survived: ReadonlyMap<string, number>;
}

/** The seat's next pick number AFTER its current pick (if it is on the clock), in snake order;
 *  `null` when the draft ends first. */
export function nextTurnFor(state: DraftState, teamId: string): number | null {
  const lastPick = totalPickCount(state);
  const startAt = teamOnClock(state) === teamId ? state.pickNumber + 1 : state.pickNumber;
  for (let pick = startAt; pick <= lastPick; pick += 1) {
    if (snakeTeamForPick(state.draftOrder, pick) === teamId) return pick;
  }
  return null;
}

/** The furthest next turn any seat holds — how far one run has to play to serve everyone. */
export function furthestNextTurn(state: DraftState): number | null {
  const turns = state.draftOrder.map((teamId) => nextTurnFor(state, teamId)).filter((turn): turn is number => turn !== null);
  return turns.length === 0 ? null : Math.max(...turns);
}

/**
 * `runs` seeded continuations (seeds `seed + runIndex`) of `state`, each played through the pick
 * before the furthest next turn. THE sim entry point of the advisor: the service memoises its
 * result per room state, so a second viewer of the same state never calls this again.
 */
export function simulateRoomOdds(input: RoomOddsInput): RoomOddsTable {
  const { state, seed, drivers, excludeFromOnClockSeat } = input;
  const runs = input.runs ?? ROOM_ODDS_RUNS;
  const furthest = furthestNextTurn(state);
  const throughPick = furthest === null ? state.pickNumber - 1 : furthest - 1;
  const played = furthest === null ? Array.from({ length: runs }, (): readonly PlayedPick[] => []) : Array.from({ length: runs }, (_, runIndex) => continueRoom({ state, seed: seed + runIndex, throughPick, excludeFromOnClockSeat, drivers }).played);
  return { runs, fromPick: state.pickNumber, throughPick, played };
}

export interface ChunkedSimulationOptions {
  /** Runs per chunk; the event loop gets a turn between chunks. */
  readonly chunkRuns: number;
  /** Test seam over the yield itself. Defaults to one macrotask (`setImmediate`). */
  readonly yieldToEventLoop?: () => Promise<void>;
}

const nextMacrotask = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

/**
 * THE SAME TABLE, IN CHUNKS (draft-room performance round, item 1). A 12-team room's 200 runs are
 * 600 to 900 ms of CPU (Phase 1 ledger); held in one synchronous stretch they block every timer
 * and every other request on the invocation that computes them. Each run is seeded by its own
 * index (`seed + runIndex`) and shares nothing with its neighbours, so playing them a chunk at a
 * time and yielding one macrotask between chunks changes no run and no number: `room-odds.test.ts`
 * pins the two entry points equal for the same input. The chunk size is the caller's
 * (`ADVISOR_CONFIG.simChunkRuns` in the service), so the longest stretch the loop is held is one
 * chunk's worth of runs.
 */
export async function simulateRoomOddsInChunks(input: RoomOddsInput, options: ChunkedSimulationOptions): Promise<RoomOddsTable> {
  const { state, seed, drivers, excludeFromOnClockSeat } = input;
  const runs = input.runs ?? ROOM_ODDS_RUNS;
  const furthest = furthestNextTurn(state);
  const throughPick = furthest === null ? state.pickNumber - 1 : furthest - 1;
  if (furthest === null) return { runs, fromPick: state.pickNumber, throughPick, played: Array.from({ length: runs }, (): readonly PlayedPick[] => []) };
  const yieldToEventLoop = options.yieldToEventLoop ?? nextMacrotask;
  const chunkRuns = Math.max(1, options.chunkRuns);
  const played: (readonly PlayedPick[])[] = [];
  for (let runIndex = 0; runIndex < runs; runIndex += 1) {
    if (runIndex > 0 && runIndex % chunkRuns === 0) await yieldToEventLoop();
    played.push(continueRoom({ state, seed: seed + runIndex, throughPick, excludeFromOnClockSeat, drivers }).played);
  }
  return { runs, fromPick: state.pickNumber, throughPick, played };
}

/** Whether one run played every pick before `pickNumber` (or the draft owed none). */
function reached(run: readonly PlayedPick[], fromPick: number, pickNumber: number): boolean {
  const needed = pickNumber - fromPick;
  return needed <= 0 || (run.length >= needed && run[needed - 1]!.pickNumber === pickNumber - 1);
}

/** See the module docblock: the viewer's own picks never count as gone. */
export function survivalFor(table: RoomOddsTable, state: DraftState, teamId: string): SeatSurvival | null {
  const pickNumber = nextTurnFor(state, teamId);
  if (pickNumber === null) return null;
  const taken = new Map<string, number>();
  let runsReached = 0;
  for (const run of table.played) {
    if (!reached(run, table.fromPick, pickNumber)) continue;
    runsReached += 1;
    for (const pick of run) {
      if (pick.pickNumber >= pickNumber) break;
      if (pick.teamId !== teamId) taken.set(pick.playerId, (taken.get(pick.playerId) ?? 0) + 1);
    }
  }
  const survived = new Map(availablePool(state).map((entry) => [entry.playerId, runsReached - (taken.get(entry.playerId) ?? 0)] as const));
  return { pickNumber, runsReached, survived };
}

function topShare<T>(counts: ReadonlyMap<T, number>, runs: number, order: (a: T, b: T) => number): SeatTendencyShare<T> | null {
  if (runs === 0) return null;
  const best = [...counts.entries()].sort((a, b) => b[1] - a[1] || order(a[0], b[0]))[0];
  return best === undefined ? null : { value: best[0], share: best[1] / runs };
}

interface Tally {
  readonly runs: number;
  readonly positions: ReadonlyMap<Position, number>;
  readonly players: ReadonlyMap<string, number>;
}

const EMPTY_TALLY: Tally = { runs: 0, positions: new Map(), players: new Map() };

function bump<K>(counts: ReadonlyMap<K, number>, key: K): ReadonlyMap<K, number> {
  return new Map([...counts, [key, (counts.get(key) ?? 0) + 1]]);
}

/** The picks between now and the viewer's next turn, excluding the viewer's own current pick. */
function picksAhead(state: DraftState, teamId: string, nextTurn: number): readonly number[] {
  const from = teamOnClock(state) === teamId ? state.pickNumber + 1 : state.pickNumber;
  return Array.from({ length: Math.max(0, nextTurn - from) }, (_, i) => from + i);
}

/** What each seat between now and the viewer's next turn took most often across the runs. */
export function seatsAheadFor(table: RoomOddsTable, state: DraftState, teamId: string): readonly SeatTendency[] {
  const nextTurn = nextTurnFor(state, teamId);
  if (nextTurn === null) return [];
  const positionOf = new Map(state.pool.map((entry) => [entry.playerId, entry.position] as const));
  const ahead = picksAhead(state, teamId, nextTurn);
  const tallies = new Map<number, Tally>(ahead.map((pickNumber) => [pickNumber, EMPTY_TALLY]));
  for (const run of table.played) {
    for (const pick of run) {
      const tally = tallies.get(pick.pickNumber);
      const position = positionOf.get(pick.playerId);
      if (tally === undefined || position === undefined) continue;
      tallies.set(pick.pickNumber, { runs: tally.runs + 1, positions: bump(tally.positions, position), players: bump(tally.players, pick.playerId) });
    }
  }
  return ahead.map((pickNumber) => {
    const tally = tallies.get(pickNumber)!;
    return {
      teamId: snakeTeamForPick(state.draftOrder, pickNumber),
      pickNumber,
      runs: tally.runs,
      topPosition: topShare(tally.positions, tally.runs, (a, b) => a.localeCompare(b)),
      topPlayer: topShare(tally.players, tally.runs, (a, b) => a.localeCompare(b)),
    };
  });
}
