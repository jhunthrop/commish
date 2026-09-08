/**
 * THE ADVISOR'S OWN WORDS FOR ITS NUMBERS — pure formatters shared by the room's card, the pool
 * rows and the Draft HQ demo, so the three never drift. Every sentence names its basis: a
 * survival is "92 of 200 runs", never a percentage dressed as a fact, and the percentage a pool
 * row prints carries the runs in its tooltip. No em-dash, no semicolon, second person, plain.
 */
import { pickLabel } from "@/domain/pick-label";
import type { AdvisorView, OddsCell } from "@/draft-service/assistant/view";

export { pickLabel };

/** "92 of 200 runs". */
export function runsText(odds: OddsCell): string {
  return `${Math.round(odds.survival * odds.runs)} of ${odds.runs} runs`;
}

/** "46%" for a row's own glance; the runs text stays the number the decision rests on. */
export function percentText(survival: number): string {
  return `${Math.round(survival * 100)}%`;
}

/** The card's big number, as runs over runs: "92 of 200". */
export function bigOddsText(odds: OddsCell): string {
  return `${Math.round(odds.survival * odds.runs)} of ${odds.runs}`;
}

/** The pool row's tooltip and screen-reader line. */
export function oddsTooltipText(survived: number, runs: number): string {
  return `still there at your next pick, ${survived} of ${runs} runs`;
}

/** The card's header line, in the coordinator's words. */
export function headerLine(view: AdvisorView): string {
  if (view.onTheClock) return "You're on the clock";
  const away = view.picksUntilYourTurn === 1 ? "1 pick away" : `${view.picksUntilYourTurn} picks away`;
  return `Your next pick is ${pickLabel(view.pickNumber, view.teamCount)}, ${away}`;
}

/** "WR 4, DET, bye 6" under the name. */
export function factsLine(position: string, positionRank: number, nflTeam: string, byeWeek: number | null): string {
  const base = `${position} ${positionRank}, ${nflTeam}`;
  return byeWeek === null ? base : `${base}, bye ${byeWeek}`;
}

/** "As of 1.04 · 200 runs", small. */
export function stampText(view: AdvisorView): string {
  return `As of ${pickLabel(view.stamp.computedAtPick, view.teamCount)} · ${view.runs} runs`;
}
