/**
 * THE WEEK STORY — what the pulse stage's matchup seat says when the viewer has no matchup.
 *
 * "No matchup this week." explains nothing (founder defect, 2026-09-03: the week-17 manager
 * knocked out of the playoffs saw a dead-end sentence over a black void). Every state here is
 * derived from reads the page already loads — the current-week slate (`MatchupWeekBody`) and the
 * standings — and every branch is a flat early return, the `stage-priority.ts` ladder idiom.
 * Nothing is forecast and nothing is invented: a state this function cannot prove from stored
 * data collapses to the nearest one it can (`quiet-week`, then `none`).
 */
import type { MatchupDetail, MatchupWeekBody, TeamStandingsRow } from "../contract";

export interface WeekStoryInput {
  /** The whole current-week slate the room already loaded — null pre-draft or pre-schedule. */
  readonly week: MatchupWeekBody | null;
  /** The viewer's own matchup in that slate, already found by `room-shell.tsx`. */
  readonly hasMyMatchup: boolean;
  /** Regular-season standings rows (`LeagueHomeBody.standings`) — server-ranked. */
  readonly standings: readonly TeamStandingsRow[];
  /**
   * `LEAGUE_CONFIG.regularSeasonWeeks`, threaded down from the page exactly as `playoffTeams`
   * already is (`standings-table.tsx`'s own reasoning: `src/league-room/**` may not value-import
   * `@/league`, and a plain constant threaded as a prop is not new data). `null` (a caller that
   * does not know) makes no playoff claim at all — the story collapses to `quiet-week`.
   */
  readonly regularSeasonWeeks: number | null;
}

export type WeekStory =
  /** The viewer has a matchup — the existing next-matchup card, unchanged. */
  | { readonly kind: "matchup" }
  /**
   * Every matchup of the season's last scheduled week is settled — nothing left to play.
   * `champion` is the settled championship game's winner, or `null` when the league has no
   * provable bracket final (no playoff weeks, or a final week that is not a single game) —
   * the renderer then falls back to the standings leader with "finished first" language,
   * never championship language.
   */
  | { readonly kind: "season-over"; readonly champion: string | null; readonly finalWeek: number }
  /** A playoff week is on and the viewer is not in it: the live picture, real pairings only. */
  | { readonly kind: "playoffs-out"; readonly roundLabel: string; readonly weekNumber: number; readonly matchups: readonly MatchupDetail[] }
  /** No matchup for the viewer, but the week has real pairings to show (a regular-season bye,
   *  or a caller that cannot prove the playoff facts). */
  | { readonly kind: "quiet-week"; readonly weekNumber: number; readonly matchups: readonly MatchupDetail[] }
  /** Nothing provable at all — no slate loaded, or an empty one. */
  | { readonly kind: "none" };

/** The bracket's own round names — the same week arithmetic as `playoffRoundOf` (`@/league/playoffs`),
 *  restated across the client boundary the way `format.ts` restates `formatAbsoluteTime`. */
function roundLabelFor(weekNumber: number, regularSeasonWeeks: number): string {
  const offset = weekNumber - regularSeasonWeeks;
  if (offset === 1) return "First round";
  if (offset === 2) return "Semifinals";
  if (offset === 3) return "Championship";
  return "Playoffs";
}

/**
 * The championship winner, when the stored data can actually name one: the final week is a
 * playoff week AND a single settled game. A tied final goes to the better seed — the bracket
 * engine's own convention (`advancePlayoffsInTx`), and the better seed is the better
 * regular-season rank, which is exactly what `standings` carries.
 */
function championOf(
  week: MatchupWeekBody,
  standings: readonly TeamStandingsRow[],
  regularSeasonWeeks: number | null,
): string | null {
  if (regularSeasonWeeks === null || week.weekNumber <= regularSeasonWeeks) return null;
  if (week.matchups.length !== 1) return null;
  const game = week.matchups[0]!;
  if (game.home.score === null || game.away.score === null) return null;
  if (game.home.score > game.away.score) return game.home.teamName;
  if (game.away.score > game.home.score) return game.away.teamName;
  const rankOf = (teamId: string): number => standings.find((row) => row.teamId === teamId)?.rank ?? Number.POSITIVE_INFINITY;
  return rankOf(game.home.teamId) <= rankOf(game.away.teamId) ? game.home.teamName : game.away.teamName;
}

/** Precedence, first match wins: season-over > matchup > playoffs-out > quiet-week > none. */
export function weekStoryFor(input: WeekStoryInput): WeekStory {
  const { week, standings, regularSeasonWeeks } = input;
  if (week === null || week.matchups.length === 0) return input.hasMyMatchup ? { kind: "matchup" } : { kind: "none" };

  // Season over: the last scheduled week, fully settled. `currentWeekNumber` only ever lands on
  // an all-settled week when no unscored matchup exists anywhere in the season — a settled
  // bracket-generating week has already written the next round by then (`advancePlayoffsInTx`
  // runs before the season-complete stamp), so this cannot fire between playoff rounds.
  const allSettled = week.matchups.every((matchup) => matchup.final);
  if (allSettled && week.weekNumber === week.totalWeeks) {
    return { kind: "season-over", champion: championOf(week, standings, regularSeasonWeeks), finalWeek: week.weekNumber };
  }

  if (input.hasMyMatchup) return { kind: "matchup" };

  if (regularSeasonWeeks !== null && week.weekNumber > regularSeasonWeeks) {
    return {
      kind: "playoffs-out",
      roundLabel: roundLabelFor(week.weekNumber, regularSeasonWeeks),
      weekNumber: week.weekNumber,
      matchups: week.matchups,
    };
  }

  return { kind: "quiet-week", weekNumber: week.weekNumber, matchups: week.matchups };
}
