/**
 * THE ADVISOR TAB'S OWN WORDS FOR ITS NUMBERS — pure formatters shared by the quilt tab, the
 * phone tab and the Draft HQ demo, so the three never drift. Every sentence names its basis: a
 * survival is "92 of 200 runs", a tendency is "took a RB in 108 of 200 runs", a tier collapse is
 * the board's own drop. No em-dash, no semicolon, second person, plain.
 */
import type { Position } from "@/domain/player";
import { pickLabel } from "@/domain/pick-label";
import type { OddsCell, PlanTarget, SeatAhead, TierCollapse } from "@/draft-service/assistant/view";
import { ADVISOR_ROOM_CONFIG } from "./config";
import type { PlanChange } from "./plan-delta";

export { pickLabel };

/** "92 of 200 runs". */
export function runsText(odds: OddsCell): string {
  return `${Math.round(odds.survival * odds.runs)} of ${odds.runs} runs`;
}

/** "46%" for a meter's own label; the runs text stays the number the decision rests on. */
export function percentText(survival: number): string {
  return `${Math.round(survival * 100)}%`;
}

/** Whether waiting until `turn` for this target is a reach: his odds there sit under the floor. */
export function isReachAt(target: PlanTarget, turn: number): boolean {
  return target.reachFromTurn !== null && turn >= target.reachFromTurn;
}

export function collapseText(row: TierCollapse): string {
  const left = row.playersLeftInTier === 1 ? `One ${row.position} left` : `${row.playersLeftInTier} ${row.position} left`;
  return `${left} in tier ${row.tierLabel}, then a ${row.dropToNextTier.toFixed(1)} point drop.`;
}

export function runText(position: Position, count: number, window: number): string {
  return `${count} of the last ${window} picks were ${position}.`;
}

/** What the runs say a seat ahead will do, and where that read comes from. */
export function seatAheadText(seat: SeatAhead, name: (playerId: string) => string): { readonly read: string; readonly basis: string } {
  const read =
    seat.topPosition === null
      ? "No read yet."
      : `Took a ${seat.topPosition.position} in ${Math.round(seat.topPosition.share * seat.runs)} of ${seat.runs} runs${seat.topPlayer === null ? "" : `, most often ${name(seat.topPlayer.playerId)}`}.`;
  const basis =
    seat.driver.kind === "autopick"
      ? "On autopick, so the clock's own policy."
      : seat.driver.basis === "prior"
        ? `The neutral prior: ${seat.driver.picksObserved === 0 ? "no picks yet" : `only ${seat.driver.picksObserved} pick${seat.driver.picksObserved === 1 ? "" : "s"} so far`}.`
        : `Read from their own ${seat.driver.picksObserved} picks so far.`;
  return { read, basis };
}

function changeWeight(change: PlanChange): number {
  return change.kind === "left_plan" ? Number.POSITIVE_INFINITY : Math.abs(change.to - change.from);
}

/** The changed-since lines, in the manager's words: departures first, then the biggest moves,
 *  capped so a room that turned over the whole plan reads as a headline and a count rather
 *  than a ledger. */
export function changedSinceLines(changes: readonly PlanChange[], name: (playerId: string) => string, teamCount: number, turnPick: (turn: number) => number | null): readonly string[] {
  const ordered = [...changes].sort((a, b) => changeWeight(b) - changeWeight(a));
  const shown = ordered.slice(0, ADVISOR_ROOM_CONFIG.changedSinceMaxLines);
  const lines = shown.map((change) => {
    const pick = turnPick(change.turn);
    const at = pick === null ? `turn ${change.turn}` : pickLabel(pick, teamCount);
    if (change.kind === "left_plan") return `${name(change.playerId)} is off the plan.`;
    const direction = change.to > change.from ? "up" : "down";
    return `${name(change.playerId)} at ${at} moved ${direction}, ${percentText(change.from)} to ${percentText(change.to)}.`;
  });
  const rest = ordered.length - shown.length;
  return rest > 0 ? [...lines, `${rest} more ${rest === 1 ? "change" : "changes"} on the plan.`] : lines;
}
