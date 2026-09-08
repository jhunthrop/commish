import type { PlayerFactsPriorSeason, PlayerFactsVolatility } from "./types";

/**
 * THE BAD WEEKS, AND THE CAREER ARC (spec §4, facts 13 and 14; inventory rows 13 and 14).
 *
 * The sheet already shows his BEST week and how many weeks cleared the position's own median. Both
 * are upside reads. The floor a manager actually feels is the other half, and it was not on the
 * page at all: a back who scored four points in week two is a different draft pick from one whose
 * worst week was twelve, and the two rendered identically.
 *
 * THE THRESHOLD IS ON THE OBJECT AND IN THE SENTENCE. A "start-worthy week" is a convention, not a
 * measurement, so the number is printed rather than hidden behind the phrase. A reader who
 * disagrees with fifteen can see exactly what he is disagreeing with.
 *
 * THE CAREER ARC IS THE DIFFERENCE BETWEEN A DECLINE READ AND A BOUNCE-BACK READ, and last season
 * alone cannot tell them apart. A season the store holds no week for produces no entry, so a career
 * that starts in 2024 shows two seasons rather than a third one full of zeroes.
 */

/** The bar a week is counted against, named rather than written into a comparison. Fifteen points
 *  is the conventional "he won you the week at that slot" line in a points-per-reception league. */
export const START_WORTHY_POINTS = 15;

/** One played week, as `collect-depth.ts` reads it off the prior-season stat lines. */
export interface WeekScore {
  readonly week: number;
  readonly points: number;
}

/** How often he cleared the bar, and the week he did worst. `null` for a season with no played
 *  week at all, never a zero-of-zero. */
export function volatilityFor(season: number, weeks: readonly WeekScore[], threshold: number = START_WORTHY_POINTS): PlayerFactsVolatility | null {
  if (weeks.length === 0) return null;
  // Points ascending, then week, so two identically bad weeks always name the same one.
  const worstWeek = [...weeks].sort((a, b) => a.points - b.points || a.week - b.week)[0]!;
  return {
    season,
    weeksPlayed: weeks.length,
    weeksAboveThreshold: weeks.filter((week) => week.points > threshold).length,
    threshold,
    worstWeek,
  };
}

/** One season's headline for one player, as the collector assembles it per season. */
export interface SeasonHeadline {
  readonly season: number;
  readonly points: number;
  readonly gamesPlayed: number;
  readonly positionRank: number;
  readonly qualifierCount: number;
}

/** The seasons the store actually holds, newest first. A season with nothing behind it is simply
 *  not in the list, which is what keeps the line from reading as a career that started later or
 *  ended earlier than it did. */
export function priorSeasonsFor(headlines: readonly (SeasonHeadline | null)[]): readonly PlayerFactsPriorSeason[] {
  return headlines.filter((headline): headline is SeasonHeadline => headline !== null).sort((a, b) => b.season - a.season);
}
