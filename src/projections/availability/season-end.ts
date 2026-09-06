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

/**
 * THE STATUS-BASED DERIVATION — closes the gap the report-based one cannot: a player placed on a
 * reserve list who then vanishes from the weekly injury report entirely (`nflverse/roster-weeks.ts`'s
 * own docblock; measured live against the real 2025 release, Malik Nabers, gsis_id `00-0039337`,
 * derives NOTHING from the injury report alone after his week-5 ACL tear — no anchor row exists —
 * while the weekly roster keeps stating `RES` for him every week from 5 through 18).
 *
 * One archived roster-status row per week, restated narrowly exactly as `WeeklyInjuryReport` is:
 * this module depends on two fields, not the whole `RosterWeekRow` ingestion shape.
 */
export interface WeeklyRosterStatus {
  readonly week: number;
  /** The league's own roster-status code, verbatim ("ACT", "RES", "INA", "CUT", "DEV", …). */
  readonly status: string;
}

/** The sourced fact a STATUS-based derivation can support: a reserve-list placement, with no body
 *  part to report (the roster never carries one) — never invented to fill the gap. */
export interface SeasonEndingReserve {
  readonly lastPlayedWeek: number;
  readonly firstMissedWeek: number;
  /** The roster's own status code at `firstMissedWeek`, verbatim ("RES") — never translated to a
   *  human phrase here; that is a presentation concern for whichever caller prints this. */
  readonly status: string;
}

/**
 * Which roster-status codes count as a reserve-list placement strong enough to anchor a
 * season-ending derivation, drawn from the REAL vocabulary `roster_weekly_2024.csv` and
 * `roster_weekly_2025.csv` publish (see `schema.ts`'s `nflverseRosterWeeks` docblock for the full
 * observed list: `ACT`, `INA`, `RES`, `DEV`, `CUT`, `RET`, `EXE`, `TRC`, `TRD`, `E01`).
 *
 * `RES` ONLY, DELIBERATELY NARROWER THAN `rosters.ts`'s OWN `rosterStatusOf`. That function's
 * default case folds RES together with EXE, the numbered exemptions, and anything else it has
 * never seen, because a week-1 cutdown-day board would rather over-count "will miss games" than
 * under-count it. This derivation makes a much stronger, NAMED claim — "he was placed on a reserve
 * list and it held for the rest of his season" — and `RES` is the only code in the observed
 * vocabulary that unambiguously means that. `EXE` (measured: `status_description_abbr` `E02`, both
 * seasons) is the commissioner-exempt list, granted for reasons that are not always an injury;
 * `CUT` and `RET` mean he left the roster outright, a different fact than "still rostered, marked
 * reserve"; `TRC`/`TRD` are transaction-window codes seen only a handful of times each season and
 * never observed to persist across weeks the way a real IR placement does. Widening this set is a
 * decision for whoever next measures one of those codes actually anchoring a real season-ender —
 * not a guess made here to look more complete.
 */
const RESERVE_CLASS_STATUSES: ReadonlySet<string> = new Set(["RES"]);

/**
 * Derives a season-ending reserve placement from archived roster-status rows, or `null` when the
 * evidence does not support one.
 *
 * MIRRORS `deriveSeasonEndingAbsence`'S OWN ANCHOR DISCIPLINE, on purpose: the roster is read as a
 * census (every man, every week) rather than an injury report (only the men currently on it), so
 * the risk this derivation actually guards against is different — a MISSING week is far rarer here
 * than in the injury report — but the anchor rule stays identical for the same reason: only the
 * week right after his last game (`firstMissedWeek`) needs to carry a qualifying status. Demanding
 * every remaining week reserve-class would refuse a real case where a late-season row is missing
 * for an unrelated reason (a bye week the roster file happens to skip, a late-season cut off a
 * reserve list that this function is never told about), when the anchor week alone already answers
 * the question this function exists to answer: was he placed on reserve the week he stopped
 * playing, and did that placement hold through the rows this season's file actually carries.
 *
 * "HELD THROUGH THE ROWS THIS FILE CARRIES" IS DELIBERATELY NOT "HELD THROUGH EVERY WEEK OF THE
 * SEASON". Every week from `firstMissedWeek` onward THAT THE FILE ACTUALLY LISTS must be
 * reserve-class; a listed week that reads back to `ACT` (or anything else) is evidence of a real
 * comeback and correctly refuses the derivation, exactly as `deriveSeasonEndingAbsence` refuses a
 * mid-season absence a player returned from. A week the file simply does not carry a row for at
 * all is not treated as evidence either way — the anchor week already carried the claim.
 */
export function deriveSeasonEndFromStatus(
  statusRows: readonly WeeklyRosterStatus[],
  gamesPlayedWeeks: readonly number[],
): SeasonEndingReserve | null {
  const lastPlayedWeek = gamesPlayedWeeks.length === 0 ? 0 : Math.max(...gamesPlayedWeeks);
  const firstMissedWeek = lastPlayedWeek + 1;

  const anchor = statusRows.find((row) => row.week === firstMissedWeek);
  if (anchor === undefined || !RESERVE_CLASS_STATUSES.has(anchor.status)) return null;

  const holds = statusRows.filter((row) => row.week >= firstMissedWeek).every((row) => RESERVE_CLASS_STATUSES.has(row.status));
  if (!holds) return null;

  return { lastPlayedWeek, firstMissedWeek, status: anchor.status };
}

/**
 * THE COMBINER — one sourced answer to "why did his season end", preferring the report anchor
 * (`deriveSeasonEndingAbsence`) when it can answer at all, because it alone carries `primaryInjury`
 * (a body part, from the league's own words). Falls back to the status-based derivation
 * (`deriveSeasonEndFromStatus`) only when the report is silent — the exact gap this whole module
 * was built to close (see this file's own docblock and `nflverse/roster-weeks.ts`'s).
 *
 * `source` NAMES WHICH INPUT ANSWERED, so a caller printing this never has to re-derive which path
 * fired from the shape of the result alone. `primaryInjury` is `null` on a `"status"`-sourced
 * result — NEVER a guessed or borrowed body part — because the roster file carries no such column
 * and inventing one would misattribute a specific injury the source never named.
 */
export type SeasonEnding =
  | ({ readonly source: "report" } & SeasonEndingAbsence)
  | {
      readonly source: "status";
      readonly lastPlayedWeek: number;
      readonly firstMissedWeek: number;
      readonly status: string;
      readonly primaryInjury: null;
    };

/**
 * Combines both derivations into one preference-ordered answer, or `null` when neither the report
 * nor the roster supports a season-ending claim.
 *
 * REPORT FIRST, ALWAYS — never a "most recent anchor wins" or "most weeks covered" comparison
 * between the two. A report anchor that qualifies is always the more specific, more sourced claim
 * (it names a body part), so there is nothing to adjudicate once one exists; the status-based
 * result is consulted only when `deriveSeasonEndingAbsence` itself returns `null`.
 */
export function deriveSeasonEnding(
  injuryRows: readonly WeeklyInjuryReport[],
  statusRows: readonly WeeklyRosterStatus[],
  gamesPlayedWeeks: readonly number[],
): SeasonEnding | null {
  const fromReport = deriveSeasonEndingAbsence(injuryRows, gamesPlayedWeeks);
  if (fromReport !== null) return { source: "report", ...fromReport };

  const fromStatus = deriveSeasonEndFromStatus(statusRows, gamesPlayedWeeks);
  if (fromStatus !== null) return { source: "status", ...fromStatus, primaryInjury: null };

  return null;
}
