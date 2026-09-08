/**
 * ODDS ACROSS TURNS — draft advisor round, spec 3.1a: "stop at the asking seat's Nth upcoming
 * turn (N = 1, 2, 3), and one run tallies survival for every target at every horizon it passes
 * through." Built on `continueDraft`'s horizon exactly the way `make-it-back.ts` is built on its
 * single horizon: many seeded continuations of the SAME live state, aggregated.
 *
 * The same run also answers "what will the seats ahead of me take?" — the spec's own ruling that
 * the "ahead of you" read comes from these runs and never from a separate heuristic. For every
 * pick between now and the asking seat's first upcoming turn, the position and the player that
 * pick landed on most often across the runs, with the share.
 *
 * `excludeFromAskingSeat` is every target (ruling R-3, unchanged): the asking seat never answers
 * its own question by taking one of the very players the odds are measured for.
 */
import type { Position } from "@/domain/player";
import { snakeTeamForPick, totalPickCount, type DraftState } from "@/draft-engine";
import { continueDraft, type PlayedPick } from "./continue";
import type { SeatDrivers } from "./seat-model";

export const HORIZON_ODDS_RUNS = 200;

export interface HorizonOddsInput {
  readonly state: DraftState;
  readonly askingTeamId: string;
  readonly targetIds: readonly string[];
  readonly seed: number;
  readonly runs?: number;
  readonly horizon?: number;
  readonly drivers?: SeatDrivers;
}

export interface TurnOdds {
  /** 1 for the asking seat's next turn, 2 for the one after, and so on. */
  readonly turn: number;
  readonly pickNumber: number;
  /** Runs in which this turn was reached before the draft ended — the fraction's denominator. */
  readonly runsReached: number;
  /** Target id -> fraction of `runsReached` in which he was still undrafted at this turn. */
  readonly survival: ReadonlyMap<string, number>;
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

export interface HorizonOddsResult {
  readonly runs: number;
  readonly turns: readonly TurnOdds[];
  /** The picks between now and the asking seat's first upcoming turn, in pick order. */
  readonly seatsAhead: readonly SeatTendency[];
}

/** The asking seat's next `count` pick numbers AFTER its current pick (if it is on the clock),
 *  in snake order. Shorter when the draft ends first. */
export function upcomingTurnsFor(state: DraftState, askingTeamId: string, count: number): readonly number[] {
  const lastPick = totalPickCount(state);
  const startAt = snakeTeamForPick(state.draftOrder, state.pickNumber) === askingTeamId ? state.pickNumber + 1 : state.pickNumber;
  const turns: number[] = [];
  for (let pick = startAt; pick <= lastPick && turns.length < count; pick += 1) {
    if (snakeTeamForPick(state.draftOrder, pick) === askingTeamId) turns.push(pick);
  }
  return turns;
}

function topShare<T>(counts: ReadonlyMap<T, number>, runs: number, order: (a: T, b: T) => number): SeatTendencyShare<T> | null {
  if (runs === 0) return null;
  const entries = [...counts.entries()].sort((a, b) => b[1] - a[1] || order(a[0], b[0]));
  const best = entries[0];
  return best === undefined ? null : { value: best[0], share: best[1] / runs };
}

class SeatTally {
  private runs = 0;
  private readonly positions = new Map<Position, number>();
  private readonly players = new Map<string, number>();

  record(playerId: string, position: Position): void {
    this.runs += 1;
    this.positions.set(position, (this.positions.get(position) ?? 0) + 1);
    this.players.set(playerId, (this.players.get(playerId) ?? 0) + 1);
  }

  tendency(teamId: string, pickNumber: number): SeatTendency {
    return {
      teamId,
      pickNumber,
      runs: this.runs,
      topPosition: topShare(this.positions, this.runs, (a, b) => a.localeCompare(b)),
      topPlayer: topShare(this.players, this.runs, (a, b) => a.localeCompare(b)),
    };
  }
}

function pickNumbersAhead(state: DraftState, askingTeamId: string, firstTurn: number): readonly number[] {
  const from = snakeTeamForPick(state.draftOrder, state.pickNumber) === askingTeamId ? state.pickNumber + 1 : state.pickNumber;
  return Array.from({ length: Math.max(0, firstTurn - from) }, (_, i) => from + i);
}

/**
 * `runs` seeded continuations (seeds `seed + runIndex`) of `state` through `horizon` of the asking
 * seat's upcoming turns. Survival at a turn is the fraction of runs that REACHED that turn; the
 * seats ahead are tallied from every run's own played picks.
 */
export function horizonOdds(input: HorizonOddsInput): HorizonOddsResult {
  const { state, askingTeamId, targetIds, seed, drivers } = input;
  const runs = input.runs ?? HORIZON_ODDS_RUNS;
  const horizon = input.horizon ?? 1;
  const turnPicks = upcomingTurnsFor(state, askingTeamId, horizon);
  if (turnPicks.length === 0) return { runs, turns: [], seatsAhead: [] };

  const exclude: ReadonlySet<string> = new Set(targetIds);
  const positionOf = new Map(state.pool.map((entry) => [entry.playerId, entry.position] as const));
  const ahead = pickNumbersAhead(state, askingTeamId, turnPicks[0]!);
  const tallies = new Map(ahead.map((pickNumber) => [pickNumber, new SeatTally()] as const));
  const reached = turnPicks.map(() => 0);
  const survived = turnPicks.map(() => new Map<string, number>(targetIds.map((id) => [id, 0])));

  for (let runIndex = 0; runIndex < runs; runIndex += 1) {
    const result = continueDraft({ state, askingTeamId, excludeFromAskingSeat: exclude, seed: seed + runIndex, horizon, drivers });
    result.undraftedAtTurn.forEach((undrafted, turnIndex) => {
      reached[turnIndex] += 1;
      for (const id of targetIds) if (undrafted.has(id)) survived[turnIndex]!.set(id, survived[turnIndex]!.get(id)! + 1);
    });
    recordAhead(result.played, tallies, positionOf);
  }

  const turns: TurnOdds[] = turnPicks.flatMap((pickNumber, turnIndex) => {
    const runsReached = reached[turnIndex]!;
    if (runsReached === 0) return [];
    const survival = new Map(targetIds.map((id) => [id, survived[turnIndex]!.get(id)! / runsReached] as const));
    return [{ turn: turnIndex + 1, pickNumber, runsReached, survival }];
  });
  const seatsAhead = ahead.map((pickNumber) => tallies.get(pickNumber)!.tendency(snakeTeamForPick(state.draftOrder, pickNumber), pickNumber));
  return { runs, turns, seatsAhead };
}

function recordAhead(played: readonly PlayedPick[], tallies: ReadonlyMap<number, SeatTally>, positionOf: ReadonlyMap<string, Position>): void {
  for (const pick of played) {
    const tally = tallies.get(pick.pickNumber);
    const position = positionOf.get(pick.playerId);
    if (tally !== undefined && position !== undefined) tally.record(pick.playerId, position);
  }
}
