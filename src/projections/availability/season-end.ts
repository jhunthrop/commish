/**
 * THE SEASON-ENDING-ABSENCE DERIVATION — turns a player's archived weekly injury rows
 * (`nflverse/injuries.ts`'s `nflverse_injuries`) plus the weeks he actually played into the sourced
 * claim a fact sheet can print: "his 2025 season ended after week 4 (knee, placed on injured
 * reserve)."
 *
 * A NEW HOME RATHER THAN `preseason/injury-history.ts`. That module computes MODEL FEATURES from
 * already-built `SeasonAvailability` summaries (games missed, career durability, prior workload) —
 * numbers a preseason fit weighs. This computes a NARRATIVE FACT about one past season, read from
 * raw weekly rows rather than a games-played tally, for a fact sheet rather than a fit. Different
 * input shape, different consumer, different question ("why did his season end" rather than "how
 * durable has he been") — folding it into the feature module would make one file answer two
 * questions that happen to share the word "injury."
 *
 * PURE BY DESIGN. Both inputs are supplied by the caller — the weekly injury rows for one player,
 * one season, and the weeks he is known to have played — so this function never reaches the
 * database or the network and is trivial to test against hand-built histories. Wiring it to
 * `nflverse/injuries.ts`'s `injuryRowsFor` and to however this product already knows a player's
 * games-played weeks is the fact-sheet integration this task deliberately leaves undone.
 */

/** One week's archived designation — the shape `nflverse/injuries.ts`'s `InjuryRow` already is,
 *  restated narrowly so this module depends on three fields rather than the whole ingestion type. */
export interface WeeklyInjuryReport {
  readonly week: number;
  /** Verbatim from the report ("Out", "Questionable", "Doubtful", "" for none). */
  readonly reportStatus: string;
  /** Verbatim from the report ("Knee"), or "" when none was published. */
  readonly primaryInjury: string;
}

/** The sourced fact: a player's season ended after `lastPlayedWeek`, and the report covering the
 *  first week he missed said why. */
export interface SeasonEndingAbsence {
  readonly lastPlayedWeek: number;
  readonly firstMissedWeek: number;
  /** The qualifying designation itself ("Out" or "Injured Reserve"), verbatim from the report that
   *  covers `firstMissedWeek` — never re-derived or upgraded past what that one row said. */
  readonly reportStatus: string;
  /** The report's own injury text for that same row, verbatim. NEVER upgraded to a more specific
   *  diagnosis than the source published — "Knee" stays "Knee", never becomes "ACL". */
  readonly primaryInjury: string;
}

/**
 * Designations strong enough to count as evidence a missed week was an injury absence, not a
 * coach's decision, a healthy scratch, or a bye.
 *
 * "Injured Reserve" is carried even though it has never once appeared in `report_status` across
 * six seasons of the real release checked while building this table (2009, 2015, 2018, 2020,
 * 2023-2025 all publish only "", "Probable", "Questionable", "Doubtful", "Out") — the literal
 * requirement names it, and including a value the source has never emitted costs nothing today
 * while costing nothing to keep matching if a future release, or a future source, ever does.
 * "Questionable" and "Doubtful" are deliberately excluded: both are the league saying a return was
 * live that week, which is the opposite of the claim this function makes.
 */
const SEASON_ENDING_STATUSES: ReadonlySet<string> = new Set(["Out", "Injured Reserve"]);

/**
 * Derives a season-ending absence, or `null` when the evidence does not support one.
 *
 * THE ANCHOR IS THE WEEK RIGHT AFTER HIS LAST GAME, not a scan of every remaining week of the
 * season — because this function is never told how long the season is. `lastPlayedWeek` is the
 * largest week in `gamesPlayedWeeks` (0 if he never played at all), which by construction makes
 * "he never plays again" trivially true; what remains to establish is WHY, and that requires a
 * qualifying report at `lastPlayedWeek + 1`. A gap there (no row at all) is read as "no evidence of
 * injury", never as evidence of one — the exact discipline the bye/rest-week test case exists to
 * enforce: absence of a report row is not itself a report of absence.
 *
 * A COMEBACK RESOLVES ITSELF FOR FREE. A player who misses weeks 5-6 (Out, Out) and then plays
 * again in week 7 has `gamesPlayedWeeks` reaching past week 6, so `lastPlayedWeek` lands on his
 * actual final game — the mid-season stretch is never examined as a candidate "ending" at all. If
 * he is hurt again later and never returns, THAT later last-played week becomes the anchor, and the
 * function reports the real, final absence rather than the first one it happened to see.
 *
 * ONLY THE ANCHOR WEEK IS REQUIRED TO QUALIFY, deliberately, rather than every remaining week of
 * the season. Real archived history shows why: once a player is actually done for the year (placed
 * on injured reserve or simply released from the active roster), teams routinely STOP filing a
 * weekly designation for him at all — measured against 2024's real file, players with a clear
 * season-ending week-5 or week-9 "Out" simply vanish from the report afterward rather than being
 * re-filed "Out" every week to the finale. Demanding contiguous coverage through a season length
 * this function is never given would silently refuse almost every real case; requiring only that
 * the transition itself — the week his availability changed — carries a qualifying, sourced
 * designation is what "injury-report rows covering the absence" can actually mean against real
 * data, without inventing coverage the source never filed.
 */
export function deriveSeasonEndingAbsence(
  injuryRows: readonly WeeklyInjuryReport[],
  gamesPlayedWeeks: readonly number[],
): SeasonEndingAbsence | null {
  const lastPlayedWeek = gamesPlayedWeeks.length === 0 ? 0 : Math.max(...gamesPlayedWeeks);
  const firstMissedWeek = lastPlayedWeek + 1;

  const anchor = injuryRows.find((row) => row.week === firstMissedWeek);
  if (anchor === undefined || !SEASON_ENDING_STATUSES.has(anchor.reportStatus)) return null;

  return {
    lastPlayedWeek,
    firstMissedWeek,
    reportStatus: anchor.reportStatus,
    primaryInjury: anchor.primaryInjury,
  };
}
