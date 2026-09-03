// THE WEEKLY CADENCE'S ORCHESTRATION LOGIC — everything `scripts/season-week.ts` (the thin CLI)
// and `src/jobs/defs/season-week-job.ts` (the durable job) both need, and the ONLY place besides
// the register's own two scripts that may import `src/projections/register` (`WALL_EXEMPT_FILES`,
// `src/projections/register/test-support.ts`). Moved here from `scripts/season-week-steps.ts` in
// the job-system round: the Vercel tick route has to reach these steps and `src/**` may not
// import `scripts/**` — the exemption moved with the file, same one file, new path.
//
// FIVE STEPS, EACH ISOLATED. `runSeasonWeek` wraps every step in `safely`, so a step that throws is
// reported as `status: "failed"` and the run continues to the next step rather than crashing the
// whole cadence — the brief's own example is the props snapshot: a dead ODDS_API_KEY or a network
// blip there must never stop the freeze that runs after it. The exit code is the one place all five
// outcomes are collapsed back into a single signal: nonzero if ANY step failed, whatever else
// succeeded.
//
// NETWORK IS INJECTED, THE REGISTER IS NOT. `ingestStats` and `snapshotProps` are functions on
// `SeasonWeekDeps` — the two places this cadence reaches an external HTTP API (nflverse, the odds
// API) — so a test can hand in a canned outcome and never touch a socket. The grade and freeze steps
// call `takeFreeze`/`gradeWeek`/`gradableWeeksFor`/`runningScoreboard` directly against `deps.db`,
// the same as `freeze.test.ts` and `grade.test.ts` already do against `createTestDb()`: that is a
// local Postgres, not the network this file's "no network in tests" promise is about.
import type { Db, ReadonlyDb } from "@/db/client";
import type { Clock } from "@/domain/timing";
import { formatCoverage, takeFreeze } from "@/projections/register/freeze";
import { formatScoreboard, gradableWeeksFor, gradeWeek, latestGradeRowsByWeek, runningScoreboard, type CumulativeScore } from "@/projections/register/grade";
import { freezeRowsAt, gradeRowsFor, latestFreezeFor } from "@/projections/register/store";
import { SERVED_BOARD_SOURCE } from "@/projections/register/sources";
import { kickoffInstantsByWeek } from "@/projections/team-store";

export type StepStatus = "ok" | "skipped" | "failed";

export interface StepResult {
  readonly step: string;
  readonly status: StepStatus;
  /** One line, always present — what an operator scanning the run would want to see first. */
  readonly summary: string;
  /** Extra lines, printed indented beneath the summary. Empty for a step with nothing more to say. */
  readonly detail: readonly string[];
}

/** The subset of `SeasonIngestReport` (`nflverse/ingest.ts`) this step reads. A structural subtype
 *  rather than an import of the whole interface, so this file does not have to know about every
 *  field a season's ingestion can report — only the four that decide found-vs-skipped. */
export interface StatsIngestOutcome {
  readonly observationsWritten: number;
  readonly statLines: number;
  readonly participationRows: number;
  readonly playerWeekUnavailable: boolean;
}

/** The subset of `SnapshotSummary` (`scripts/odds-props-snapshot.ts`) this step prints. Credits are
 *  strings, not numbers — `CreditStatus` (`@/projections/odds/http`) reads them straight off the
 *  `x-requests-remaining`/`x-requests-used` response headers and falls back to the literal
 *  `"unknown"` rather than a number that would misleadingly imply the header was actually read. */
export interface PropsSnapshotOutcome {
  readonly totalEvents: number;
  readonly selectedEvents: number;
  readonly totalWritten: number;
  readonly totalSkipped: number;
  readonly creditsRemaining: string;
  readonly creditsUsed: string;
}

export interface SeasonWeekDeps {
  readonly db: Db;
  readonly clock: Clock;
  /** Ingests whatever nflverse has published for `season` and reports what landed. Real
   *  implementation: `ingestPlayerUniverse` + `scheduleWeekAsOf` + `ingestSeason` (`season-week.ts`).
   *  A test hands in a function that returns a canned `StatsIngestOutcome` and touches no network. */
  readonly ingestStats: (season: number) => Promise<StatsIngestOutcome>;
  /** Runs one props snapshot. Real implementation: `runOddsSnapshot` (`odds-props-snapshot.ts`). A
   *  test hands in a function that resolves or rejects without ever calling the odds API. */
  readonly snapshotProps: () => Promise<PropsSnapshotOutcome>;
}

export interface SeasonWeekOptions {
  readonly season: number;
  /** Walk the steps and print what WOULD happen; no writes anywhere, including no network calls
   *  through `ingestStats` or `snapshotProps` — those are never invoked at all in a dry run. */
  readonly dryRun: boolean;
  /** Forces the freeze step to supersede an existing freeze rather than skip it. */
  readonly refreeze: boolean;
}

/** Runs one step, catching anything it throws so the cadence's later steps still run. The one place
 *  "wrapped so one failure reports and continues" is implemented, for all five steps uniformly. */
async function safely(step: string, fn: () => Promise<StepResult>): Promise<StepResult> {
  try {
    return await fn();
  } catch (error: unknown) {
    return { step, status: "failed", summary: error instanceof Error ? error.message : String(error), detail: [] };
  }
}

/**
 * STEP 1 — stats-ingest-if-published.
 *
 * `deps.ingestStats` is idempotent by construction (`ingestSeason`'s own `onConflictDoNothing`
 * writes), so this step's only job is to read what it reports and say, in English, whether there was
 * anything new: `playerWeekUnavailable` means nflverse has not published this season's weekly stats
 * file at all yet (the honest preseason case); `observationsWritten === 0` with the file present
 * means the store was already caught up.
 */
export async function statsIngestStep(deps: SeasonWeekDeps, options: SeasonWeekOptions): Promise<StepResult> {
  if (options.dryRun) {
    return {
      step: "stats-ingest",
      status: "skipped",
      summary: `[dry-run] would ingest published nflverse stats for season ${options.season}`,
      detail: [],
    };
  }
  const outcome = await deps.ingestStats(options.season);
  if (outcome.playerWeekUnavailable) {
    return {
      step: "stats-ingest",
      status: "skipped",
      summary: `nflverse has not published weekly stats for season ${options.season} yet (0 new observations)`,
      detail: [],
    };
  }
  if (outcome.observationsWritten === 0) {
    return {
      step: "stats-ingest",
      status: "skipped",
      summary: `season ${options.season} already up to date (0 new observations; ${outcome.statLines} stat lines, ${outcome.participationRows} participation rows on file)`,
      detail: [],
    };
  }
  return {
    step: "stats-ingest",
    status: "ok",
    summary: `ingested ${outcome.observationsWritten} new observation(s) for season ${options.season} (${outcome.statLines} stat lines, ${outcome.participationRows} participation rows)`,
    detail: [],
  };
}

/**
 * STEP 2 — the props snapshot. Never blocks anything downstream: `runSeasonWeek` runs this through
 * `safely` exactly like every other step, so a thrown `requireEnv("ODDS_API_KEY")` or a network
 * failure inside `deps.snapshotProps` becomes `status: "failed"` here and the freeze step still runs.
 */
export async function propsSnapshotStep(deps: SeasonWeekDeps, options: SeasonWeekOptions): Promise<StepResult> {
  if (options.dryRun) {
    return { step: "props-snapshot", status: "skipped", summary: "[dry-run] would run the odds props snapshot", detail: [] };
  }
  const outcome = await deps.snapshotProps();
  return {
    step: "props-snapshot",
    status: "ok",
    summary:
      `fetched ${outcome.totalEvents} event(s) (${outcome.selectedEvents} snapshotted), wrote ${outcome.totalWritten} observation(s) ` +
      `(${outcome.totalSkipped} single-sided line(s) skipped); credits remaining=${outcome.creditsRemaining} used=${outcome.creditsUsed}`,
    detail: [],
  };
}

/**
 * STEP 3 — grade every gradeable week the register has not graded yet.
 *
 * "Ungraded" is computed here, not left to `gradeWeek`'s own per-week refusal: a week already
 * carrying a grade row is skipped OUTRIGHT rather than re-graded, so a cadence run over a season
 * already fully graded through week 4 does not append four redundant `gradedAt` rows every single
 * week. (An operator who DOES want a re-grade — after a stat correction — still has
 * `npm run projections:register:grade -- --season=<S> --week=<W>`, which regrades unconditionally;
 * this step is the unattended weekly default, not the only way to grade.)
 */
export async function gradeStep(deps: SeasonWeekDeps, options: SeasonWeekOptions): Promise<StepResult> {
  const gradable = await gradableWeeksFor(deps.db, options.season);
  const alreadyGraded = new Set([...(await gradeRowsFor(deps.db, options.season))].map((row) => row.week));
  const ungraded = gradable.filter((week) => !alreadyGraded.has(week));

  if (options.dryRun) {
    return {
      step: "grade",
      status: "skipped",
      summary: `[dry-run] would attempt ${ungraded.length} ungraded week(s)`,
      detail: ungraded.length === 0 ? [] : [`weeks: ${ungraded.join(", ")}`],
    };
  }

  if (ungraded.length === 0) {
    return {
      step: "grade",
      status: "skipped",
      summary: `no ungraded weeks (${gradable.length} frozen week(s) frozen, all already graded)`,
      detail: [],
    };
  }

  const detail: string[] = [];
  let gradedCount = 0;
  for (const week of ungraded) {
    try {
      const grade = await gradeWeek(deps.db, { season: options.season, week }, deps.clock);
      gradedCount += 1;
      // Per BOARD, not one number: "graded 546 player(s)" over a dual-track freeze hides which of
      // the two boards that was, and a shadow that silently stopped grading would look like nothing.
      const boards = grade.boards.map((board) => `${board.boardSource}=${board.population}`).join(" ");
      const skipped = grade.skipped.map((board) => ` SKIPPED ${board.boardSource}`).join("");
      detail.push(`week ${week}: graded ${boards}${skipped}`);
    } catch (error: unknown) {
      detail.push(`week ${week}: SKIPPED (${error instanceof Error ? error.message : String(error)})`);
    }
  }
  return {
    step: "grade",
    status: gradedCount > 0 ? "ok" : "skipped",
    summary: `attempted ${ungraded.length} ungraded week(s), graded ${gradedCount}`,
    detail,
  };
}

/** The smallest week whose kickoff is still in the future — the "current week" a freeze is taken
 *  for. `null` when the store holds no kickoff after `now` (an un-ingested season, or a season whose
 *  every week has already kicked off). Pure: takes the kickoff map and the moment, decides nothing
 *  about what has or has not been frozen. */
export function pickWeekToFreeze(kickoffs: ReadonlyMap<number, Date>, now: Date): { readonly week: number; readonly kickoff: Date } | null {
  const upcoming = [...kickoffs.entries()].filter(([, kickoff]) => kickoff.getTime() > now.getTime()).sort((a, b) => a[0] - b[0]);
  const first = upcoming[0];
  return first === undefined ? null : { week: first[0], kickoff: first[1] };
}

/**
 * STEP 4 — freeze the current week if it is before kickoff.
 *
 * `takeFreeze` itself has no notion of "already frozen" — every call writes a fresh freeze row, by
 * design (a re-freeze after the board changed IS a new claim). This step is where the cadence's own
 * idempotency lives: a week that already carries a freeze is SKIPPED, citing the existing instant,
 * unless `--refreeze` was passed, because a same-week re-freeze is only worth taking when something
 * actually changed, and this step has no way to know that without an operator saying so.
 */
export async function freezeStep(deps: SeasonWeekDeps, options: SeasonWeekOptions): Promise<StepResult> {
  const kickoffs = await kickoffInstantsByWeek(deps.db, options.season);
  const now = new Date(deps.clock.now());
  const candidate = pickWeekToFreeze(kickoffs, now);
  if (candidate === null) {
    return {
      step: "freeze",
      status: "skipped",
      summary: `no upcoming week to freeze for season ${options.season} (no ingested kickoff after ${now.toISOString()})`,
      detail: [],
    };
  }

  const { week, kickoff } = candidate;
  const existing = await latestFreezeFor(deps.db, options.season, week);
  if (existing !== null && !options.refreeze) {
    // Row count, not just the instant: an operator reading a skip line wants to know what is
    // already sitting there, not only that something is.
    const existingRows = await freezeRowsAt(deps.db, { season: options.season, week, frozenAt: existing });
    return {
      step: "freeze",
      status: "skipped",
      summary:
        `week ${week} already frozen at ${existing.toISOString()} (${existingRows.length} rows); ` +
        "pass --refreeze to supersede",
      detail: [],
    };
  }

  if (options.dryRun) {
    return {
      step: "freeze",
      status: "skipped",
      summary: `[dry-run] would ${existing === null ? "take" : "supersede"} the week ${week} freeze (kickoff ${kickoff.toISOString()})`,
      detail: [],
    };
  }

  const result = await takeFreeze(deps.db, { season: options.season, week }, deps.clock);
  return {
    step: "freeze",
    status: "ok",
    summary:
      `${existing === null ? "froze" : "superseded"} week ${week} at ${result.frozenAt.toISOString()} ` +
      `(${result.rows.length} rows across ${result.boards.length} board(s))`,
    // One line per board, coverage and all: the summary carries the total because that is what an
    // operator scanning five step lines needs, and the detail carries which board said what.
    detail: result.boards.map(
      (board) => `${board.source} [${board.role}]: ${board.rows.length} rows, coverage ${formatCoverage(board.coverage)}`,
    ),
  };
}

/** Distinct players graded in each week's LATEST grading — the population line the brief asks the
 *  scoreboard step to print, read through `latestGradeRowsByWeek` so it can never disagree with the
 *  cumulative scoreboard about which grading of a week counts.
 *
 *  SCOPED TO THE SERVED BOARD. A dual-track grading writes one row set per board, so counting rows
 *  outright would report roughly double the players a week actually graded. "Population" here has
 *  always meant the product's own graded universe, and the shadow's own count is on the scoreboard
 *  beside its score. */
async function perWeekPopulation(db: ReadonlyDb, season: number): Promise<ReadonlyMap<number, number>> {
  const byWeek = latestGradeRowsByWeek(await gradeRowsFor(db, season));
  return new Map(
    [...byWeek.entries()].map(([week, rows]) => [week, rows.filter((row) => row.boardSource === SERVED_BOARD_SOURCE).length]),
  );
}

/** STEP 5 — the running scoreboard, read fresh (never mutates anything), so it reflects whatever
 *  the grade and freeze steps just did, whether they ran, skipped or failed. */
export async function scoreboardStep(deps: SeasonWeekDeps, options: SeasonWeekOptions): Promise<StepResult> {
  const [scores, population]: [readonly CumulativeScore[], ReadonlyMap<number, number>] = await Promise.all([
    runningScoreboard(deps.db, options.season),
    perWeekPopulation(deps.db, options.season),
  ]);
  const populationLine =
    [...population.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([week, n]) => `week ${week}=${n}`)
      .join("  ") || "(no graded weeks yet)";

  return {
    step: "scoreboard",
    status: "ok",
    summary: `season ${options.season} running scoreboard`,
    detail: [`per-week population: ${populationLine}`, "", ...formatScoreboard(scores).split("\n")],
  };
}

export interface SeasonWeekRun {
  readonly steps: readonly StepResult[];
  /** Nonzero when any step's `status` is `"failed"` — the one signal a cron entry's exit code has
   *  to carry all five steps' worth of outcome through. */
  readonly exitCode: number;
}

/** THE ORCHESTRATOR — runs all five steps, in order, each isolated by `safely`. */
export async function runSeasonWeek(deps: SeasonWeekDeps, options: SeasonWeekOptions): Promise<SeasonWeekRun> {
  const steps: StepResult[] = [];
  steps.push(await safely("stats-ingest", () => statsIngestStep(deps, options)));
  steps.push(await safely("props-snapshot", () => propsSnapshotStep(deps, options)));
  steps.push(await safely("grade", () => gradeStep(deps, options)));
  steps.push(await safely("freeze", () => freezeStep(deps, options)));
  steps.push(await safely("scoreboard", () => scoreboardStep(deps, options)));
  const exitCode = steps.some((step) => step.status === "failed") ? 1 : 0;
  return { steps, exitCode };
}

/** The NFL season a given moment falls in — the season that STARTED in the preceding September, not
 *  the calendar year. January and February still belong to the season that kicked off the previous
 *  autumn; March onward is early enough that the new season's own year is already the right guess. */
export function defaultSeason(now: Date): number {
  const month = now.getUTCMonth(); // 0 = January
  return month <= 1 ? now.getUTCFullYear() - 1 : now.getUTCFullYear();
}
