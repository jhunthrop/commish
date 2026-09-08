import { deriveSeasonEnding, type WeeklyInjuryReport, type WeeklyRosterStatus } from "@/projections/availability/season-end";
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
 * THE DERIVATION ITSELF IS NOT REIMPLEMENTED HERE. `deriveSeasonEnding`
 * (`@/projections/availability/season-end`) already carries the whole rule — report anchor first
 * because it alone names a body part, roster status as the fallback, and a comeback resolving
 * itself for free — and was verified against the real 2025 release. This module only shapes its
 * answer into the fact-sheet type and drops the seasons it refused.
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

/** One season's roster and participation weeks for one player. */
export interface GamesMissedInput {
  readonly season: number;
  /** The team's own scheduled games that season, for an honest denominator. */
  readonly teamGames: number;
  /** Every week the weekly roster file carried a row for him, whatever the status. */
  readonly rosteredWeeks: readonly number[];
  /** Every week he actually has a played line for. */
  readonly gamesPlayedWeeks: readonly number[];
}

/**
 * How many games he missed, per season.
 *
 * COUNTED OVER THE WEEKS THE ROSTER ACTUALLY CARRIED HIM, never over the team's schedule. A player
 * who signed in week 8 did not "miss" weeks 1 to 7 for any reason a fact sheet should print, and a
 * player nobody rostered at all did not miss a season — he was not in the league. `teamGames` rides
 * along only so the sentence can state the denominator it is a share of, never as the subtrahend.
 *
 * A SEASON WITH NO ROSTER ROWS PRODUCES NO ENTRY, which is the whole point: the honest answer to
 * "how many games did he miss in a season this store holds nothing for" is silence, and a zero
 * there would read as a durable season he may never have played.
 */
export function gamesMissedFor(inputs: readonly GamesMissedInput[]): readonly PlayerFactsGamesMissed[] {
  const missed: PlayerFactsGamesMissed[] = [];
  for (const input of inputs) {
    if (input.rosteredWeeks.length === 0) continue;
    const played = new Set(input.gamesPlayedWeeks);
    const count = input.rosteredWeeks.filter((week) => !played.has(week)).length;
    missed.push({ season: input.season, missed: count, teamGames: input.teamGames });
  }
  return missed;
}
