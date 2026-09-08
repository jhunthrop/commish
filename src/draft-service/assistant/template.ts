/**
 * THE TEMPLATE FLOOR — the deterministic sentences the advisor shows until the writer's own land
 * (spec 3.2 and 3.5: "the template stays the floor"). Every number is the turn's own: a survival
 * is stated as runs over runs, a value as points over replacement, a drop as the board's own
 * points. No em-dash, no semicolon, second person, plain.
 *
 * Two candidates never read alike because each sentence is built from that candidate's own
 * rank, slot, value and odds; the writer, not this file, is what makes them sound like a person.
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

function pointsPhrase(points: number): string {
  return `${points.toFixed(1)} points`;
}

function cliffReason(reasons: readonly PickReason[]): Extract<PickReason, { code: "tier_cliff" }> | undefined {
  return reasons.find((reason): reason is Extract<PickReason, { code: "tier_cliff" }> => reason.code === "tier_cliff");
}

function slotClause(slot: RosterSlotType | null): string {
  return slot === null ? "has no slot on your roster" : `fills your ${slot} slot`;
}

function oddsClause(makeItBack: OddsCell | null, nextPickNumber: number | null, teamCount: number): string {
  if (nextPickNumber === null) return "This is your last turn, so there is no next pick to wait for.";
  if (makeItBack === null) return "";
  return `${runsPhrase(makeItBack)} still have him at ${pickLabel(nextPickNumber, teamCount)}.`;
}

/** One sentence pair for one now-card row, from that row's own facts. */
export function templateReason(candidate: Omit<NowCandidate, "templateReason">, context: TemplateContext): string {
  const name = context.names[candidate.playerId] ?? candidate.playerId;
  const cliff = cliffReason(candidate.reasons);
  const lead =
    cliff === undefined
      ? `${name} ranks No. ${candidate.positionRank} at ${candidate.position} and ${slotClause(candidate.fillsSlot)}, ${pointsPhrase(candidate.valueOverReplacement)} over replacement.`
      : `${name} is one of ${cliff.playersLeftInTier} ${cliff.position} left before a ${pointsPhrase(cliff.dropToNextTier)} drop, and he ${slotClause(candidate.fillsSlot)}.`;
  const odds = oddsClause(candidate.makeItBack, context.nextPickNumber, context.teamCount);
  return odds === "" ? lead : `${lead} ${odds}`;
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
