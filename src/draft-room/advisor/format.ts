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

/** The now row's odds line, with a verb: what the runs say about him at your next turn. */
export function oddsLineText(odds: OddsCell, nextPickNumber: number, teamCount: number): string {
  const at = pickLabel(nextPickNumber, teamCount);
  const survived = Math.round(odds.survival * odds.runs);
  if (survived === 0) return `Gone before ${at} in every run.`;
  if (survived === odds.runs) return `Still there at ${at} in every run.`;
  return `Still there at ${at} in ${survived} of ${odds.runs} runs.`;
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

/** "RB 1, RB 2 and RB 3" */
function listNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * The changed-since lines, in the manager's words: departures consolidated into one line,
 * then the biggest moves, at most `changedSinceMaxLines` names on the whole strip, the rest a
 * count folded onto the last line ("and 6 more changes"), so a room that turned over the plan
 * reads as a headline rather than a ledger.
 */
export function changedSinceLines(changes: readonly PlanChange[], name: (playerId: string) => string, teamCount: number, turnPick: (turn: number) => number | null): readonly string[] {
  const ordered = [...changes].sort((a, b) => changeWeight(b) - changeWeight(a));
  const named = ordered.slice(0, ADVISOR_ROOM_CONFIG.changedSinceMaxLines);
  const departed = named.filter((change) => change.kind === "left_plan").map((change) => name(change.playerId));
  const departures = departed.length === 0 ? [] : [`${listNames(departed)} ${departed.length === 1 ? "came" : "came"} off the plan`];
  const moves = named.flatMap((change) => {
    if (change.kind !== "odds_moved") return [];
    const pick = turnPick(change.turn);
    const at = pick === null ? `turn ${change.turn}` : pickLabel(pick, teamCount);
    return [`${name(change.playerId)} at ${at} moved ${change.to > change.from ? "up" : "down"}, ${percentText(change.from)} to ${percentText(change.to)}`];
  });
  const lines = [...departures, ...moves];
  const rest = ordered.length - named.length;
  if (lines.length === 0) return [];
  const last = lines[lines.length - 1]!;
  const tail = rest > 0 ? `${last}, and ${rest} more ${rest === 1 ? "change" : "changes"}.` : `${last}.`;
  return [...lines.slice(0, -1).map((line) => `${line}.`), tail];
}
