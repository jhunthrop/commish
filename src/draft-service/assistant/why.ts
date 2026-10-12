/**
 * THE WHY — the card's two sentences, built from measured facts and nothing written by a model
 * (spec section 7). Sentence one is about him: the tier he closes and the drop behind him when
 * the board has one, his rank on our board otherwise, and the slot he fills either way. Sentence
 * two is the room: a run in progress at his position, and what the seats between now and your
 * next pick took most often in our runs.
 *
 * SHAPES, NOT ONE SHAPE (fix round 1, kept): each fact family carries three sentence shapes,
 * dealt by the pick the card was computed at, so consecutive turns do not read alike. Plain
 * words: "the last back before a 20.6 point drop", never a tier letter, never the model's own
 * vocabulary for how a seat was read. Every number names its basis. No em-dash, no semicolon,
 * second person.
 */
import { mustPickLine } from "@/domain/must-pick";
import type { Position } from "@research/domain/player";
import { positionWord } from "@research/domain/position-words";
import { BENCH_SLOT, type RosterSlotType } from "@research/domain/roster";
import type { PickReason } from "@research/projections/decide/draft";
import { shipsProjectedRows } from "@research/projections/preseason/kdef-decision";
import type { SeatTendency } from "../sim/room-odds";
import type { PositionRun } from "./view";

export interface WhyFacts {
  readonly position: Position;
  readonly positionRank: number;
  readonly fillsSlot: RosterSlotType | null;
  readonly reasons: readonly PickReason[];
  readonly run: PositionRun | null;
  /** The picks between now and your next turn, read from the room's runs. */
  readonly ahead: readonly SeatTendency[];
  /** Continuations behind the seats-ahead read. */
  readonly runs: number;
  /** The positions the roster can still take once its bench is full (`restrictedPositions`),
   *  `null` while any position fits. Non-empty, it is the whole first sentence. */
  readonly mustPick: readonly Position[] | null;
}

export interface WhySentence {
  readonly text: string;
  /** `cliff:1`, `value:0`: the family and the shape dealt this turn. */
  readonly shape: string;
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function slotClause(slot: RosterSlotType | null): string {
  if (slot === null) return "has no open slot on your roster";
  if (slot === BENCH_SLOT) return "takes a bench spot";
  return `fills your ${slot} slot`;
}

type Cliff = Extract<PickReason, { code: "tier_cliff" }>;

/**
 * A market-order position (the kicker and team defence decision) never argues a drop: a number
 * for it would be one nobody measured. Nor does a man who would SIT (the 2026-09-12 round, founder
 * report 2): the drop behind a bench body is a fact about the board, not a reason to take him,
 * and a card that led with it read as a tier chasing the pick. The tier argument is bounded to a
 * pick that fills a starting slot; a bench body is argued by his rank and the spot he takes.
 */
function cliffOf(position: Position, fillsSlot: RosterSlotType | null, reasons: readonly PickReason[]): Cliff | undefined {
  if (!shipsProjectedRows(position) || fillsSlot === null || fillsSlot === BENCH_SLOT) return undefined;
  return reasons.find((reason): reason is Cliff => reason.code === "tier_cliff");
}

interface HimFacts {
  readonly one: string;
  readonly many: string;
  readonly slot: string;
  readonly rank: number;
}

function tierClause(him: HimFacts, cliff: Cliff): string {
  const drop = cliff.dropToNextTier.toFixed(1);
  return cliff.playersLeftInTier === 1 ? `the last ${him.one} before a ${drop} point drop` : `one of ${cliff.playersLeftInTier} ${him.many} left before a ${drop} point drop`;
}

const CLIFF_SHAPES: readonly ((him: HimFacts, cliff: Cliff) => string)[] = [
  (him, cliff) => `He is ${tierClause(him, cliff)}, and he ${him.slot}.`,
  (him, cliff) => `The ${him.many} fall ${cliff.dropToNextTier.toFixed(1)} points after ${cliff.playersLeftInTier === 1 ? "him" : `the ${cliff.playersLeftInTier} left in his group`}, and he ${him.slot}.`,
  (him, cliff) => `He ${him.slot}, and behind ${cliff.playersLeftInTier === 1 ? "him" : `these ${cliff.playersLeftInTier} ${him.many}`} the ${him.one} board drops ${cliff.dropToNextTier.toFixed(1)} points.`,
];

function rankClause(him: HimFacts): string {
  return him.rank === 1 ? `the best ${him.one} on our board` : `the No. ${him.rank} ${him.one} on our board`;
}

const VALUE_SHAPES: readonly ((him: HimFacts) => string)[] = [
  (him) => `He is ${rankClause(him)}, and he ${him.slot}.`,
  (him) => `He ${him.slot}, and he is ${rankClause(him)}.`,
  (him) => `${capitalize(rankClause(him))}: he ${him.slot}.`,
];

/** How many of the seats ahead took his position most often, in plain words with the basis.
 *  "Take a back most often", never "lean back": the persona pass read the short form as posture. */
function leanClause(facts: WhyFacts, one: string): string {
  const n = facts.ahead.length;
  const k = facts.ahead.filter((seat) => seat.topPosition?.value === facts.position).length;
  const basis = `in our ${facts.runs} runs`;
  if (n === 1) return k === 1 ? `the seat before you takes a ${one} most often ${basis}` : `the seat before you most often takes something other than a ${one} ${basis}`;
  if (k === 0) return `none of the ${n} seats before you takes a ${one} most often ${basis}`;
  if (k === n) return `all ${n} seats before you take a ${one} most often ${basis}`;
  return `${k} of the ${n} seats before you take a ${one} most often ${basis}`;
}

/** The room sentence: the run at his position when there is one, then the seats ahead. */
function roomSentence(facts: WhyFacts): string {
  const one = positionWord(facts.position, false);
  if (facts.ahead.length === 0) return "Nobody picks between now and your next turn.";
  const lean = leanClause(facts, one);
  const run = facts.run;
  if (run === null || run.position !== facts.position) return `${capitalize(lean)}.`;
  return `${capitalize(positionWord(run.position, true))} are going, ${run.count} of the last ${run.window} picks, and ${lean}.`;
}

/** Two sentences at most. `variant` is the pick the card was computed at, so shapes rotate. With
 *  the bench full, sentence one is the league's own line about what the roster still owes. */
export function buildWhy(facts: WhyFacts, variant: number): WhySentence {
  if (facts.mustPick !== null && facts.mustPick.length > 0) {
    return { text: `${mustPickLine(facts.mustPick)} ${roomSentence(facts)}`, shape: "must:0" };
  }
  const him: HimFacts = { one: positionWord(facts.position, false), many: positionWord(facts.position, true), slot: slotClause(facts.fillsSlot), rank: facts.positionRank };
  const cliff = cliffOf(facts.position, facts.fillsSlot, facts.reasons);
  const shapes = cliff === undefined ? VALUE_SHAPES : CLIFF_SHAPES;
  const index = ((variant % shapes.length) + shapes.length) % shapes.length;
  const first = cliff === undefined ? VALUE_SHAPES[index]!(him) : CLIFF_SHAPES[index]!(him, cliff);
  return { text: `${first} ${roomSentence(facts)}`, shape: `${cliff === undefined ? "value" : "cliff"}:${index}` };
}
