/**
 * THE ADVISOR'S OWN WORDS FOR ITS NUMBERS — pure formatters shared by the room's card, the pool
 * rows and the Draft HQ demo, so the three never drift. Every sentence names its basis: a
 * survival is "92 of 200 runs", never a percentage dressed as a fact, and the percentage a pool
 * row prints carries the runs in its tooltip. No em-dash, no semicolon, second person, plain.
 */
import { pickLabel } from "@/domain/pick-label";
import { positionWord } from "@research/domain/position-words";
import type { AdvisorView, OddsCell, TierCollapse } from "@/draft-service/assistant/view";
import type { PositionRun } from "@research/advisor/why";

export { pickLabel };

/** "57 of 200": a survived count over the runs it is out of. */
export function runsOverRuns(survived: number, runs: number): string {
  return `${survived} of ${runs}`;
}

/** "92 of 200 runs". */
export function runsText(odds: OddsCell): string {
  return `${runsOverRuns(Math.round(odds.survival * odds.runs), odds.runs)} runs`;
}

/** "46%" for a row's own glance; the runs text stays the number the decision rests on. */
export function percentText(survival: number): string {
  return `${Math.round(survival * 100)}%`;
}

/** The card's big number, as runs over runs: "92 of 200". */
export function bigOddsText(odds: OddsCell): string {
  return runsOverRuns(Math.round(odds.survival * odds.runs), odds.runs);
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** The strip's run chip: "Backs are going, 3 of the last 4 picks". */
export function runText(run: PositionRun): string {
  return `${capitalize(positionWord(run.position, true))} are going, ${run.count} of the last ${run.window} picks`;
}

/** The strip's collapse chip: "2 receivers left before a 14.3 point drop", "Last back before a 20.6 point drop". */
export function collapseText(row: TierCollapse): string {
  const drop = `before a ${row.dropToNextTier.toFixed(1)} point drop`;
  if (row.playersLeftInTier === 1) return `Last ${positionWord(row.position, false)} ${drop}`;
  return `${row.playersLeftInTier} ${positionWord(row.position, true)} left ${drop}`;
}

/**
 * A SURVIVAL FIGURE IS A WHOLE PERCENTAGE (founder ruling 2026-09-12: "157 of 200" did not explain
 * itself). "79%" on every row and call, with the basis "still there at 2.01" beneath it; the replay
 * count leaves the rows and lives only in the why and the sheet's one basis line. `null` when
 * there are no runs yet, which prints as a dash.
 */
export function sharePercent(survived: number | null, runs: number | null): string | null {
  return survived === null || runs === null || runs === 0 ? null : percentText(survived / runs);
}

/** The basis under a figure: the pick he is still there at, or why there is no figure yet. */
export function stillThereAt(nextPickLabel: string | null): string {
  return nextPickLabel === null ? "no runs yet" : `still there at ${nextPickLabel}`;
}

/** The sheet's one basis line, the only place a row's surface names the replays. */
export function oddsBasis(runs: number | null, nextPickLabel: string | null): string {
  return runs === null || nextPickLabel === null ? "no runs yet" : `share of ${runs} replays with him still there at ${nextPickLabel}`;
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
