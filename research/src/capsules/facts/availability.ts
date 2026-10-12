import { deriveSeasonEnding, type WeeklyInjuryReport, type WeeklyRosterStatus } from "@research/projections/availability/season-end";
import { classifySeasonWeeks } from "@research/projections/availability/week-classification";
import type { PlayerFactsGamesMissed, PlayerFactsSeasonEnding } from "./types";

/**
 * WHY A PRIOR SEASON ENDED, AND HOW MANY GAMES IT COST (spec `2026-09-07-fact-sheet-depth-design.md`
 * §4, facts 1 and 2, inventory rows 1 and 2).
 *
 * PURE, AND DELIBERATELY SO. Both functions take rows a caller has already read and return facts;
 * `collect-depth.ts` does every database read. That is what lets the anchor discipline below be
 * tested against hand-built histories rather than against whatever a seeded database happens to
 * contain.
 *
 * THE DERIVATIONS THEMSELVES ARE NOT REIMPLEMENTED HERE. `deriveSeasonEnding`
 * (`@research/projections/availability/season-end`) already carries the season-ending rule, and
 * `classifySeasonWeeks` (`@research/projections/availability/week-classification`) carries the one rule for
 * what a missed game is, shared with the projection so the sheet and the board can never disagree
 * about a player's record. This module only shapes their answers into the fact-sheet types.
 */

/** One season's raw evidence for one player, as `collect-depth.ts` reads it. */
export interface SeasonEndingInput {
  readonly season: number;
  readonly injuryRows: readonly WeeklyInjuryReport[];
  readonly statusRows: readonly WeeklyRosterStatus[];
  readonly gamesPlayedWeeks: readonly number[];
}

/**
 * Every season the evidence supports a season-ending claim for, in the order the caller supplied.
 *
 * A SEASON THE DERIVATION REFUSED IS SIMPLY ABSENT — never an entry saying "he finished the year",
 * which is a claim this store cannot make: a season with no injury rows and no roster rows is a
 * season we know nothing about, not a season he was healthy through.
 */
export function seasonEndingsFor(inputs: readonly SeasonEndingInput[]): readonly PlayerFactsSeasonEnding[] {
  const endings: PlayerFactsSeasonEnding[] = [];
  for (const input of inputs) {
    const ending = deriveSeasonEnding(input.injuryRows, input.statusRows, input.gamesPlayedWeeks);
    if (ending === null) continue;
    const shared = { season: input.season, lastPlayedWeek: ending.lastPlayedWeek, firstMissedWeek: ending.firstMissedWeek } as const;
    endings.push(
      ending.source === "report"
        ? { ...shared, source: "report", reportStatus: ending.reportStatus, rosterStatus: null, primaryInjury: ending.primaryInjury === "" ? null : ending.primaryInjury }
        : { ...shared, source: "status", reportStatus: null, rosterStatus: ending.status, primaryInjury: null },
    );
  }
  return endings;
}

/** One season's roster, report and participation weeks for one player. */
export interface GamesMissedInput {
  readonly season: number;
  /** The team's own scheduled games that season, for an honest denominator. */
  readonly teamGames: number;
  /** Whether BOTH designation archives hold rows for this season (`availabilityStoreCoverage`). */
  readonly covered: boolean;
  /** Every week the weekly roster file carried a row for him, whatever the status. */
  readonly rosterRows: readonly WeeklyRosterStatus[];
  /** Every week the injury report named him. */
  readonly injuryRows: readonly WeeklyInjuryReport[];
  /** Every week he actually has a played line for. */
  readonly gamesPlayedWeeks: readonly number[];
}

/**
 * What each season's record says: games played, when he first appeared, which weeks the archives
 * say he was unavailable, and how many rostered weeks he was healthy and did not play.
 *
 * A MISSED GAME IS A GAME HE WAS UNAVAILABLE FOR (founder report 2026-09-08). The first version of
 * this counted rostered weeks minus played weeks, which printed "missed 6 of a possible 17" for a
 * healthy backup who was simply not the starter yet. The healthy did-not-play weeks are still
 * counted, and printed, as what they are: a role fact. A SERVED SUSPENSION IS ITS OWN FACT (the
 * same report, second round): the weeks are carried apart in `suspendedWeeks`, so the sheet can say
 * "6 missed to a suspension" and never fold them into the injury count the projection reads.
 *
 * A SEASON NEITHER STORE KNOWS HIM IN PRODUCES NO ENTRY. A season the archives do not cover at all
 * still carries his played games and his first appearance, with the unavailable weeks and the
 * scratch count ABSENT (`null`): without designations the two kinds of unplayed week are the same
 * row, and a zero would read as a clean season the store never observed.
 */
export function gamesMissedFor(inputs: readonly GamesMissedInput[]): readonly PlayerFactsGamesMissed[] {
  const missed: PlayerFactsGamesMissed[] = [];
  for (const input of inputs) {
    if (input.rosterRows.length === 0 && input.gamesPlayedWeeks.length === 0) continue;
    const playedWeeks = [...new Set(input.gamesPlayedWeeks)].sort((a, b) => a - b);
    const classes = input.covered ? classifySeasonWeeks(input) : null;
    missed.push({
      season: input.season,
      teamGames: input.teamGames,
      gamesPlayed: playedWeeks.length,
      firstPlayedWeek: playedWeeks[0] ?? null,
      unavailableWeeks: classes === null ? null : classes.unavailableWeeks,
      suspendedWeeks: classes === null ? null : classes.suspendedWeeks,
      healthyDidNotPlay: classes === null ? null : classes.didNotPlayWeeks.length,
    });
  }
  return missed;
}
