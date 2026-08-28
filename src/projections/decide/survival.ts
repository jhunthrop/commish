import type { Position } from "@/domain/player";
import { normalCdf } from "./normal";

/**
 * WHO WILL NOT LAST UNTIL YOUR NEXT TURN.
 *
 * Value over replacement says what a player is worth. It does not say whether waiting costs you
 * anything, and in a snake draft the whole cost of a decision is the twenty-two picks between
 * this turn and the next one. Two players of equal value are not an equal choice when one of
 * them will still be sitting there and the other will not.
 *
 * THE MODEL. A player's place in the queue of upcoming selections is drawn from a bell curve
 * centred on where he sits on THE BOARD RIGHT NOW, conditioned on the fact he has not gone yet.
 * Board position rather than raw average draft position is the load-bearing choice: a man priced
 * at pick 40 whose thirty-five superiors have already come off is the best player available and
 * behaves like one, and a model reading his printed price would say he is safe for three more
 * rounds.
 *
 * Why closed form rather than simulated picks. A Monte Carlo over the intervening picks would
 * make the one property that has to hold - probability falls as the gap widens - true only in
 * expectation, and would need a seeded stream to be reproducible at all. The conditional normal
 * is monotone by construction and gives the same answer twice.
 *
 * THE PRIVACY LINE, AND IT IS POLICY RATHER THAN PREFERENCE. In-league recall is permitted: you
 * sat in those drafts, so this room's own past behaviour may inform this room's advice.
 * Cross-league behaviour stays aggregate and anonymous. `RoomTendency` is the enforcement, not a
 * comment about it - it carries four numbers and a count, has no field capable of naming a
 * person or a team, and a named cross-league dossier therefore cannot be assembled out of this
 * module's inputs or its outputs.
 */

/** One undrafted player and what the market says he costs. */
export interface BoardEntry {
  readonly playerId: string;
  readonly position: Position;
  /** The market's average draft position. Any consistent market will do; ours is the house's own. */
  readonly averageDraftPosition: number;
}

/**
 * How this room drafts, in picks earlier than the market, per position. Positive means the room
 * reaches for the position; negative means it lets the position fall.
 *
 * NO IDENTITY FIELD EXISTS AND NONE MAY BE ADDED. See this module's docblock.
 */
export interface RoomTendency {
  readonly picksEarlyByPosition: Readonly<Partial<Record<Position, number>>>;
  /** How many of this room's own drafts the drift was measured over. */
  readonly draftsObserved: number;
}

/** One pick from one of the room's own past drafts, with what the market said it cost. */
export interface RoomPickRecord {
  readonly pickNumber: number;
  readonly position: Position;
  readonly averageDraftPosition: number;
}

export interface RoomDraftRecord {
  readonly picks: readonly RoomPickRecord[];
}

export interface SurvivalQuery {
  /** Every player still undrafted. A board carrying drafted players overstates everyone's queue place. */
  readonly board: readonly BoardEntry[];
  /** The pick you are on now. */
  readonly fromPick: number;
  /** Your next turn. */
  readonly toPick: number;
  readonly room?: RoomTendency;
}

/**
 * One draft is an anecdote and two is a coincidence. Below this, a room's measured drift is
 * discarded outright rather than shrunk, because a half-believed tendency in a draft-day
 * recommendation is worse than none: the manager cannot tell which half was believed.
 */
export const MIN_DRAFTS_FOR_ROOM_TENDENCY = 3;

/**
 * How far a room strays from the market, in picks, as a function of how deep the board is.
 *
 * Real average draft position data spreads roughly in proportion to the price itself: the
 * consensus first pick goes within a pick or two of first, and a man priced at 150 routinely
 * goes anywhere in a thirty-pick window. A floor plus a slope reproduces that shape with two
 * numbers a reviewer can argue with.
 *
 * THESE ARE HONEST GUESSES, NOT MEASUREMENTS. Nothing in this repository yet holds enough real
 * draft logs to fit them, and pretending otherwise by quoting more decimal places would be the
 * dishonesty this engine exists to avoid. Fitting them against the house's own completed drafts
 * is the first thing to do when there are enough of them.
 */
export const DRAFT_NOISE_FLOOR_PICKS = 1;
export const DRAFT_NOISE_SLOPE = 0.25;

function assertQuery({ fromPick, toPick }: SurvivalQuery): void {
  if (!Number.isInteger(fromPick) || fromPick < 1) {
    throw new Error(`A survival question starts at a whole pick number; got ${fromPick}.`);
  }
  if (!Number.isInteger(toPick) || toPick <= fromPick) {
    throw new Error(`Your next turn must come after pick ${fromPick}; got ${toPick}.`);
  }
}

function driftFor(position: Position, room: RoomTendency | undefined): number {
  if (room === undefined || room.draftsObserved < MIN_DRAFTS_FOR_ROOM_TENDENCY) return 0;
  return room.picksEarlyByPosition[position] ?? 0;
}

/**
 * The board in the order the room is expected to work through it: cheapest market price first,
 * pulled forward by however many picks this room habitually reaches for that position.
 *
 * Clamped above zero so a large drift cannot fold the ordering back on itself.
 */
function queueOrder(query: SurvivalQuery): readonly string[] {
  return [...query.board]
    .map((entry) => ({
      playerId: entry.playerId,
      price: Math.max(0.5, entry.averageDraftPosition - driftFor(entry.position, query.room)),
    }))
    .sort((a, b) => a.price - b.price || a.playerId.localeCompare(b.playerId))
    .map((entry) => entry.playerId);
}

/**
 * `P(queue place > n | queue place > 0)`.
 *
 * The conditioning is what makes the answer exactly 1 when nobody picks in between, which an
 * unconditioned bell curve gets wrong: it leaks mass below zero and would report the consensus
 * best available as already gone before anyone had picked.
 */
function survivalOf(queuePlace: number, interveningPicks: number): number {
  if (interveningPicks <= 0) return 1;
  const spread = DRAFT_NOISE_FLOOR_PICKS + DRAFT_NOISE_SLOPE * queuePlace;
  const alreadyHere = normalCdf(queuePlace / spread);
  const stillHere = 1 - normalCdf((interveningPicks - queuePlace) / spread);
  return stillHere / alreadyHere;
}

/** Every undrafted player's chance of lasting, in one pass. */
export function survivalProbabilities(query: SurvivalQuery): ReadonlyMap<string, number> {
  assertQuery(query);
  const interveningPicks = query.toPick - query.fromPick - 1;
  const order = queueOrder(query);
  return new Map(order.map((playerId, index) => [playerId, survivalOf(index + 1, interveningPicks)]));
}

/**
 * THROWS for a player who is not on the board. A drafted player's chance of surviving is not
 * zero, it is a question that should not have been asked, and answering zero would let a caller
 * quietly recommend a man who is already on somebody's roster.
 */
export function survivalProbability(playerId: string, query: SurvivalQuery): number {
  const survival = survivalProbabilities(query).get(playerId);
  if (survival === undefined) {
    throw new Error(`${playerId} is not on this board, so there is nothing for him to survive.`);
  }
  return survival;
}

/**
 * How many picks early this room takes each position, averaged over its own completed drafts.
 *
 * Deliberately coarse: a per-position mean over whole drafts, not a per-player or per-manager
 * anything. The coarseness is the privacy design as much as it is the statistics - a mean over
 * every seat in the room cannot be read back to a seat.
 */
export function roomTendency(drafts: readonly RoomDraftRecord[]): RoomTendency {
  const totals = new Map<Position, { drift: number; picks: number }>();
  for (const draft of drafts) {
    for (const pick of draft.picks) {
      const running = totals.get(pick.position) ?? { drift: 0, picks: 0 };
      totals.set(pick.position, {
        drift: running.drift + (pick.averageDraftPosition - pick.pickNumber),
        picks: running.picks + 1,
      });
    }
  }
  const picksEarlyByPosition: Partial<Record<Position, number>> = {};
  for (const [position, { drift, picks }] of totals) picksEarlyByPosition[position] = drift / picks;
  return { picksEarlyByPosition, draftsObserved: drafts.length };
}
