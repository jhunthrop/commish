/**
 * THE TEMPLATE FLOOR — the deterministic sentences the advisor shows until the writer's own land
 * (spec 3.2 and 3.5: "the template stays the floor"). Every number is the turn's own: a value as
 * points over replacement, a drop as the board's own points, a rank as the board's own rank.
 * No em-dash, no semicolon, second person, plain.
 *
 * SHAPES, NOT ONE SHAPE (fix round 1): a card whose five rows all read "X is one of 1 RB left
 * before a drop" is a template the reader learns to skip. Each fact family carries five sentence
 * shapes, one per row the shortlist can hold, dealt in row order within the family, so no two
 * rows on a card share a shape id and adjacent rows never share one. The shape id travels on
 * the wire (`NowCandidate.templateShape`) so a test can check the structure, not just the words.
 * The row's odds cell prints the make-it-back count, so no shape restates it.
 */
import type { Position } from "@/domain/player";
import { pickLabel } from "@/domain/pick-label";
import type { RosterSlotType } from "@/domain/roster";
import type { PickReason } from "@/projections/decide/draft";
import type { DraftPlan, NowCandidate, OddsCell, PlanTarget, PlanTurn, RoomSignals } from "./view";

export interface TemplateContext {
  readonly names: Readonly<Record<string, string>>;
  readonly teamCount: number;
  /** Your next turn's pick number, or null when this is your last turn. */
  readonly nextPickNumber: number | null;
}

/** "92 of 200 runs" — the simulator's own frequency, never a percentage dressed as a fact. */
export function runsPhrase(odds: OddsCell): string {
  return `${Math.round(odds.survival * odds.runs)} of ${odds.runs} runs`;
}

type Cliff = Extract<PickReason, { code: "tier_cliff" }>;

function cliffReason(reasons: readonly PickReason[]): Cliff | undefined {
  return reasons.find((reason): reason is Cliff => reason.code === "tier_cliff");
}

function slotClause(slot: RosterSlotType | null): string {
  return slot === null ? "has no slot on your roster" : `fills your ${slot} slot`;
}

interface RowFacts {
  readonly name: string;
  readonly position: Position;
  readonly slot: string;
  readonly rank: number;
  readonly vor: string;
}

/** Five shapes for a row whose position sits at a real cliff. `count` includes him. */
const CLIFF_SHAPES: readonly ((row: RowFacts, drop: string, count: number) => string)[] = [
  (row, drop) => `Behind ${row.name} at ${row.position} the drop is ${drop} points, and he ${row.slot}.`,
  (row, drop, count) => `${row.name} ${row.slot}. The ${row.position} tier he sits in holds ${count} and falls ${drop} points once it is gone.`,
  (row, drop, count) => `Take ${row.name} for the ${row.position} tier: ${count} left in it, and the board loses ${drop} points after that.`,
  (row, drop) => `${row.name} ${row.slot} and holds the ${row.position} line, ${drop} points above what comes next.`,
  (row, drop, count) => `The ${row.position} tier is down to ${count} with ${row.name} in it, and ${drop} points go with it. He ${row.slot}.`,
];

/** Five shapes for a row argued on value alone. */
const VALUE_SHAPES: readonly ((row: RowFacts) => string)[] = [
  (row) => `${row.name} ranks No. ${row.rank} at ${row.position} and ${row.slot}, ${row.vor} points over replacement.`,
  (row) => `${row.vor} points over replacement is the case for ${row.name}, the No. ${row.rank} ${row.position}, and he ${row.slot}.`,
  (row) => `${row.name} ${row.slot}. At No. ${row.rank} among ${row.position} he is worth ${row.vor} points over replacement.`,
  (row) => `The No. ${row.rank} ${row.position} is ${row.name}, ${row.vor} points over replacement, and he ${row.slot}.`,
  (row) => `${row.name} is ${row.vor} points over replacement, No. ${row.rank} at ${row.position}, and ${row.slot}.`,
];

/** The row already prints the make-it-back count as its own number (the card's odds cell), so
 *  the sentence never restates it. The one odds fact worth a sentence is that there is no next
 *  turn at all. */
function lastTurnClause(nextPickNumber: number | null): string {
  return nextPickNumber === null ? " This is your last turn, so there is no next pick to wait for." : "";
}

export interface TemplateSentence {
  readonly text: string;
  /** `cliff:2`, `value:0`: the family and the shape dealt to this row. */
  readonly shape: string;
}

/**
 * One sentence for one now-card row, from that row's own facts. `variant` is the row's index
 * WITHIN its fact family on this card (the caller deals it), so shapes rotate without repeating.
 */
export function templateReason(candidate: Omit<NowCandidate, "templateReason" | "templateShape">, context: TemplateContext, variant: number): TemplateSentence {
  const row: RowFacts = {
    name: context.names[candidate.playerId] ?? candidate.playerId,
    position: candidate.position,
    slot: slotClause(candidate.fillsSlot),
    rank: candidate.positionRank,
    vor: candidate.valueOverReplacement.toFixed(1),
  };
  const cliff = cliffReason(candidate.reasons);
  const shapes = cliff === undefined ? VALUE_SHAPES : CLIFF_SHAPES;
  const index = variant % shapes.length;
  const lead = cliff === undefined ? VALUE_SHAPES[index]!(row) : CLIFF_SHAPES[index]!(row, cliff.dropToNextTier.toFixed(1), cliff.playersLeftInTier);
  return { text: `${lead}${lastTurnClause(context.nextPickNumber)}`, shape: `${cliff === undefined ? "value" : "cliff"}:${index}` };
}

/** The fact family a row falls in, so a caller can deal variants per family. */
export function templateFamily(reasons: readonly PickReason[]): "cliff" | "value" {
  return cliffReason(reasons) === undefined ? "value" : "cliff";
}

function positionWord(position: Position, plural: boolean): string {
  const words: Readonly<Record<Position, readonly [string, string]>> = {
    QB: ["quarterback", "quarterbacks"],
    RB: ["back", "backs"],
    WR: ["receiver", "receivers"],
    TE: ["tight end", "tight ends"],
    K: ["kicker", "kickers"],
    DEF: ["defense", "defenses"],
  };
  return words[position][plural ? 1 : 0];
}

function roomSentence(signals: RoomSignals): string | null {
  const lean = leadingLean(signals);
  if (signals.run !== null) {
    const run = `${positionWord(signals.run.position, true)} are going: ${signals.run.count} of the last ${signals.run.window} picks were ${signals.run.position}`;
    return lean === null ? `${capitalize(run)}.` : `${capitalize(run)}, and the seats ahead of you lean ${lean} in our runs.`;
  }
  if (lean !== null) return `The seats ahead of you lean ${lean} in our runs.`;
  return null;
}

/** The position the seats ahead took most often, counted across their own top reads. */
function leadingLean(signals: RoomSignals): string | null {
  const counts = new Map<Position, number>();
  for (const seat of signals.ahead) {
    if (seat.topPosition !== null) counts.set(seat.topPosition.position, (counts.get(seat.topPosition.position) ?? 0) + 1);
  }
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
  return top === undefined ? null : top[0];
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function targetClause(turn: PlanTurn, target: PlanTarget, context: TemplateContext): string {
  const odds = target.oddsByTurn[turn.turn - 1];
  const name = context.names[target.playerId] ?? target.playerId;
  const at = pickLabel(turn.pickNumber, context.teamCount);
  return odds === null || odds === undefined ? `${name} is the ${turn.position} to watch at ${at}` : `${name} is still there at ${at} in ${runsPhrase(odds)}`;
}

function planSentence(plan: DraftPlan, context: TemplateContext): string | null {
  const first = plan.turns[0];
  if (first === undefined) return null;
  const target = first.targets[0];
  const lead = `Aim for a ${positionWord(first.position, false)} at ${pickLabel(first.pickNumber, context.teamCount)}`;
  if (target === undefined) return `${lead}.`;
  const second = plan.turns[1];
  const tail = second === undefined ? "" : `, then a ${positionWord(second.position, false)} at ${pickLabel(second.pickNumber, context.teamCount)}`;
  return `${lead}: ${targetClause(first, target, context)}${tail}.`;
}

/** The strategy note's floor: at most two sentences, both from this turn's own facts. */
export function strategyTemplate(plan: DraftPlan, signals: RoomSignals, context: TemplateContext): string {
  const sentences = [roomSentence(signals), planSentence(plan, context)].filter((sentence): sentence is string => sentence !== null);
  return sentences.length === 0 ? "The board is quiet and your next turn is not on the clock yet." : sentences.join(" ");
}
