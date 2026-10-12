import type { WeeklyInjuryReport, WeeklyRosterStatus } from "./season-end";

/**
 * ONE RULE FOR WHAT A MISSED GAME IS, shared by the projection (`preseason/source.ts`) and the fact
 * sheet (`capsules/facts/availability.ts`) so the two can never disagree about a player's record.
 *
 * THE DEFECT THIS REPLACES (founder report, 2026-09-08): both layers defined a missed game as a game
 * he did not play, so a healthy backup, a healthy scratch and a rookie promoted mid-season were all
 * scored as injured. Tyler Shough dressed for 11 of 17 in 2025 as an active-roster quarterback with
 * no designation all season, and the board charged him six missed games and nine expected games.
 *
 * A GAME IS MISSED TO AVAILABILITY ONLY WHEN THE STORE SAYS HE WAS UNAVAILABLE: the injury report
 * listed him Out (or on injured reserve), or Doubtful and he did not play, or the weekly roster put
 * him on a reserve, PUP, non-football-injury or exempt list that week. A week he was rostered with
 * no such status and did not play is a DID-NOT-PLAY week: a role fact (backup, healthy scratch,
 * practice squad, released), never an availability fact.
 *
 * A SERVED SUSPENSION IS NOT AN INJURY (founder report, 2026-09-08, second round). Rashee Rice's
 * six-game 2025 suspension was counted the same as his 2024 knee, and the availability prior read
 * him at 13.3 expected games. A suspended week is its own class: the fact sheet reports it apart
 * ("6 missed to a suspension"), and the availability history drops it from both halves of the
 * record (`preseason/availability.ts`'s `availabilityEvidence`): it is neither a game he was
 * available for nor an absence that says anything about his body. The 2013-2020 files spell a
 * suspension with the coarse `SUS` code; from 2021 it sits under `RES` with the detail code saying
 * why (`SUSPENSION_STATUS_DETAILS`), which is why `nflverse_roster_weeks` archives the detail.
 *
 * A PLAYED WEEK OUTRANKS EVERY STATUS. Measured on the real 2013-2025 release (skill positions), 8%
 * of `RES` weeks carry a played snap row: the weekly file is stamped before a mid-week activation.
 * What he did on Sunday is the fact; the code is the club's paperwork about it. A SUSPENSION
 * OUTRANKS THE REPORT: eight of 750 `SUS` weeks also carry an Out or Doubtful row, and a suspended
 * man's health that week is moot.
 */

export const WEEK_CLASSES = ["played", "suspended", "unavailable", "did_not_play"] as const;
export type WeekClass = (typeof WEEK_CLASSES)[number];

/**
 * Report designations that alone make an unplayed week an absence. Measured on 2013-2025: an `Out`
 * week is played 0.1% of the time. "Injured Reserve" has never appeared in `report_status` across
 * the seasons checked (`season-end.ts`'s own note) and is carried for the same reason it is there.
 * Compared case-insensitively, trimmed.
 */
export const UNAVAILABLE_REPORT_STATUSES: ReadonlySet<string> = new Set(["Out", "Injured Reserve"]);

/** `Doubtful` counts only together with an unplayed week (0.9% of Doubtful weeks are played). A
 *  `Questionable` week is the league saying a return was live (61% played) and is never an absence. */
export const DOUBTFUL_REPORT_STATUS = "Doubtful";

/**
 * Roster codes that mean he could not have played that week for a reason that is not a suspension:
 * injured reserve (`RES`), physically unable to perform (`PUP`), reserve/non-football injury
 * (`NON`) and the commissioner-exempt list (`EXE`); the numbered exemptions (`E01`, `E14`, ...) are
 * matched by `isUnavailableRosterStatus` rather than listed. Every one measured at 0% played on
 * 2013-2025 except `RES` (8.3%, the activation case above).
 *
 * DELIBERATELY NOT HERE: `SUS` (a suspension, its own class below), `INA` (game-day inactive, 0%
 * played, but 4,448 of its 7,674 weeks carry no report row at all: the healthy scratch), `DEV`
 * (practice squad, a role), `CUT`/`RET` and the free-agent codes (off the roster, a role), the
 * trade codes `TRC`/`TRD`/`TRT` (about half played), `RSN` (21.5% played) and `NWT`/`RSR`. Where the
 * injury report says Out for an `INA` week, the report rule above catches it.
 */
export const UNAVAILABLE_ROSTER_STATUSES: ReadonlySet<string> = new Set(["RES", "PUP", "NON", "EXE"]);

/** The coarse roster code for a suspension, how the 2013-2020 files spell it (8.1% played: the
 *  same mid-week reinstatement `RES` shows, outranked by the played week). One row after 2020. */
export const SUSPENSION_ROSTER_STATUSES: ReadonlySet<string> = new Set(["SUS"]);

/**
 * The `status_description_abbr` codes that mean a suspension, how the files spell it from 2020 on,
 * under `RES` (and once under `INA`). Measured on the real 2013-2025 files, skill positions: `R40`
 * suspended by the commissioner for a stated term (105 weeks; Kamara 2023, Hopkins 2022, Watson
 * 2022, Rice 2025), `R30` suspended indefinitely (Gordon 2020, Ridley 2022), `R33` suspended by his
 * club (Diontae Johnson 2024, Doubs 2024). `R01`/`R48` are injured reserve, `R04` PUP, `R05`/`R06`/
 * `R27` non-football injury and illness, `R03` did not report, `R02` retired: none of them here.
 */
export const SUSPENSION_STATUS_DETAILS: ReadonlySet<string> = new Set(["R30", "R33", "R40"]);

const NUMBERED_EXEMPTION = /^E\d{2}$/;

function normalise(code: string): string {
  return code.trim().toUpperCase();
}

export function isUnavailableRosterStatus(status: string): boolean {
  const code = normalise(status);
  return UNAVAILABLE_ROSTER_STATUSES.has(code) || NUMBERED_EXEMPTION.test(code);
}

/** Whether the roster's code, or its detail, says he was serving a suspension that week. */
export function isSuspendedRosterWeek(status: string, statusDetail: string): boolean {
  return SUSPENSION_ROSTER_STATUSES.has(normalise(status)) || SUSPENSION_STATUS_DETAILS.has(normalise(statusDetail));
}

function isUnavailableReportStatus(status: string): boolean {
  const code = normalise(status);
  return [...UNAVAILABLE_REPORT_STATUSES].some((listed) => normalise(listed) === code);
}

function isDoubtful(status: string): boolean {
  return normalise(status) === normalise(DOUBTFUL_REPORT_STATUS);
}

/** One week the roster carried him, joined to that week's report and to whether he played. */
export interface RosteredWeek {
  readonly week: number;
  /** The weekly roster's own code ("ACT", "RES", ...). */
  readonly rosterStatus: string;
  /** The weekly roster's own detail code ("R01", "R40", ...), `""` where the file carries none. */
  readonly rosterStatusDetail: string;
  /** The report's own designation that week, or `null` when the report did not name him. */
  readonly reportStatus: string | null;
  readonly played: boolean;
}

/** The rule, for one week. */
export function classifyWeek(week: RosteredWeek): WeekClass {
  if (week.played) return "played";
  if (isSuspendedRosterWeek(week.rosterStatus, week.rosterStatusDetail)) return "suspended";
  const report = week.reportStatus ?? "";
  if (isUnavailableReportStatus(report) || isDoubtful(report)) return "unavailable";
  if (isUnavailableRosterStatus(week.rosterStatus)) return "unavailable";
  return "did_not_play";
}

/** One season's raw evidence for one player, as either layer reads it from the stores. */
export interface SeasonWeekInput {
  readonly rosterRows: readonly WeeklyRosterStatus[];
  readonly injuryRows: readonly WeeklyInjuryReport[];
  readonly gamesPlayedWeeks: readonly number[];
}

/** Every week of the season sorted into its class, ascending within each list. */
export interface SeasonWeekClasses {
  readonly playedWeeks: readonly number[];
  readonly unavailableWeeks: readonly number[];
  readonly suspendedWeeks: readonly number[];
  readonly didNotPlayWeeks: readonly number[];
}

/**
 * Classifies every week the roster carried him or he played in. A report row alone never creates a
 * week: the roster is the census, the report only describes weeks the census already holds.
 */
export function classifySeasonWeeks(input: SeasonWeekInput): SeasonWeekClasses {
  const played = new Set(input.gamesPlayedWeeks);
  const reportByWeek = new Map(input.injuryRows.map((row) => [row.week, row.reportStatus] as const));
  const rosterByWeek = new Map(input.rosterRows.map((row) => [row.week, row] as const));
  const weeks = [...new Set([...rosterByWeek.keys(), ...played])].sort((a, b) => a - b);

  const classes: Record<WeekClass, number[]> = { played: [], suspended: [], unavailable: [], did_not_play: [] };
  for (const week of weeks) {
    const roster = rosterByWeek.get(week);
    const weekClass = classifyWeek({
      week,
      rosterStatus: roster?.status ?? "",
      rosterStatusDetail: roster?.statusDetail ?? "",
      reportStatus: reportByWeek.get(week) ?? null,
      played: played.has(week),
    });
    classes[weekClass].push(week);
  }
  return { playedWeeks: classes.played, unavailableWeeks: classes.unavailable, suspendedWeeks: classes.suspended, didNotPlayWeeks: classes.did_not_play };
}
