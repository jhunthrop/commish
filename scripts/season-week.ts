// THE WEEKLY CADENCE — one command that takes the register through everything a week needs, in
// order: ingest published stats if any landed, snapshot props, grade every ungraded gradeable
// week, freeze the current week if it is still before kickoff, and print the running scoreboard.
//
// Run: npm run season:week
//      npm run season:week -- --dry-run          (walks the steps, prints what WOULD happen, writes nothing)
//      npm run season:week -- --refreeze         (supersedes the current week's freeze even if one exists)
//      npm run season:week -- --season=2026      (overrides the season; defaults from today's date)
//      npm run season:week -- --help
//
// THIN ON PURPOSE. Every step's actual logic lives in `scripts/season-week-steps.ts` — the one
// other file besides `register-freeze.ts` and `register-grade.ts` the register's own quarantine
// wall (`src/projections/register/wall.source.test.ts`) allows to import it, and the file
// `scripts/season-week.test.ts` exercises directly against a real test database with a fake
// network. This script's only jobs are: wire real dependencies (a real db connection, a real
// nflverse client, the real odds snapshot), parse argv, print the report, and set the exit code.
import { createDb, type Db } from "@/db/client";
import { requireEnv } from "@/projections/odds/http";
import { createNflverseClient } from "@/projections/nflverse/client";
import { ingestPlayerUniverse, ingestSeason, scheduleWeekAsOf } from "@/projections/nflverse/ingest";
import { runOddsSnapshot } from "./odds-props-snapshot";
import {
  defaultSeason,
  runSeasonWeek,
  type PropsSnapshotOutcome,
  type SeasonWeekDeps,
  type SeasonWeekOptions,
  type StatsIngestOutcome,
  type StepResult,
} from "./season-week-steps";

/**
 * THE STATS-INGEST CHOICE (Task 2 brief: "pick the one that ingests a completed week's published
 * stats and document the choice").
 *
 * NOT `npm run stats:ingest` (`scripts/ingest-once.ts`, `getIngestionWorker().tick()`). That is
 * the Tank01-backed LIVE SCORING pipeline: it settles real leagues' real matchups from a paid,
 * metered API, and writes to `player_stat_lines`, a table `src/projections/lines.ts` explicitly
 * refuses to read FROM (see its own top-of-file comment: no season, no `as_of`, final-and-corrected
 * numbers a backtest reading them would leak). The register's `gradeWeek` reads outcomes through
 * `statLinesAsOf`, whose default source is nflverse's own published weekly file
 * (`STAT_LINE_SOURCE`) — a completely different pipe than Tank01's live scoring.
 *
 * NOT `npm run projections:backfill` (`scripts/projection-backfill.ts`) run for one season either,
 * even though it is built on the exact same primitive this step uses (`ingestSeason`). That script
 * is sized for an ANNUAL history walk: it validates gap-season derivation against a fixed 2018
 * control season, enforces a 95% resolution bar across the WHOLE requested range and exits
 * non-zero below it, and derives play-by-play stat lines for `STAT_LINE_GAPS` seasons — all of
 * which is the right behaviour once a year, when the season list changes, and the wrong behaviour
 * weekly: a resolution bar tuned for a multi-season backfill has no business gating a Tuesday
 * morning run over whether last week's stats happened to resolve to 94.8%, and the gap-season
 * derivation only ever needs running once per gap season, not every week of it.
 *
 * This step therefore calls the same underlying primitive both of those scripts share directly —
 * `ingestPlayerUniverse` + `scheduleWeekAsOf` + `ingestSeason` (`@/projections/nflverse/ingest`) —
 * for exactly the ONE season the cadence cares about, with none of the annual-backfill machinery
 * wrapped around it. It is idempotent (`ingestSeason`'s writes are `onConflictDoNothing`), so a run
 * that finds nothing new published costs one small CSV fetch and reports zero new observations
 * rather than failing.
 */
async function realIngestStats(db: Db, season: number): Promise<StatsIngestOutcome> {
  const client = createNflverseClient();
  const universe = await ingestPlayerUniverse(db, client);
  const scheduleAsOf = (await scheduleWeekAsOf([season])).get(season);
  const report = await ingestSeason(db, client, universe, season, scheduleAsOf);
  return {
    observationsWritten: report.observationsWritten,
    statLines: report.statLines,
    participationRows: report.participationRows,
    playerWeekUnavailable: report.playerWeekUnavailable,
  };
}

async function realSnapshotProps(db: Db): Promise<PropsSnapshotOutcome> {
  const apiKey = requireEnv("ODDS_API_KEY");
  const summary = await runOddsSnapshot(db, apiKey);
  return {
    totalEvents: summary.totalEvents,
    selectedEvents: summary.selectedEvents,
    totalWritten: summary.totalWritten,
    totalSkipped: summary.totalSkipped,
    creditsRemaining: summary.credits.remaining,
    creditsUsed: summary.credits.used,
  };
}

interface Args {
  readonly season: number;
  readonly dryRun: boolean;
  readonly refreeze: boolean;
  readonly help: boolean;
}

function parseArgs(argv: readonly string[], now: Date): Args {
  const seasonArg = argv.find((arg) => arg.startsWith("--season="));
  const season = seasonArg === undefined ? defaultSeason(now) : Number(seasonArg.slice("--season=".length));
  if (!Number.isInteger(season)) {
    throw new Error(`season-week: --season must be an integer, got "${seasonArg}".`);
  }
  return {
    season,
    dryRun: argv.includes("--dry-run"),
    refreeze: argv.includes("--refreeze"),
    help: argv.includes("--help") || argv.includes("-h"),
  };
}

const HELP_TEXT = `season-week -- one command runs the season's weekly cadence.

USAGE
  npm run season:week
  npm run season:week -- --dry-run
  npm run season:week -- --refreeze
  npm run season:week -- --season=2026
  npm run season:week -- --help

STEPS, IN ORDER
  1. stats-ingest   ingests whatever nflverse has published for the season (idempotent; skips with
                     a reason when nothing new has landed, never fails a week that has not been
                     played yet).
  2. props-snapshot  runs one odds-props snapshot (the same work as
                     \`npm run projections:odds:snapshot\`) and prints the credits it spent. A
                     failure here (a missing ODDS_API_KEY, a network error) is reported and does
                     NOT block the freeze step below.
  3. grade           grades every gradeable week the register has not graded yet (a week already
                     carrying a grade is skipped, not re-graded -- see \`--week\` on
                     \`projections:register:grade\` for an explicit re-grade after a correction).
  4. freeze          freezes the current week (the soonest week whose kickoff has not happened yet)
                     if it is still strictly before that kickoff. EVERY tracked board is recorded at
                     the one instant -- the served one and each shadow -- and the step prints a line
                     per board. A week already frozen this run SKIPS, citing the existing freeze's
                     instant, unless --refreeze is passed, in which case a new freeze is taken (a
                     supersede, never an overwrite).
  5. scoreboard      prints the season's running scoreboard, one line per board and column, plus
                     each graded week's population.

FLAGS
  --dry-run          walks all five steps and prints what WOULD happen; makes no network calls and
                     writes nothing to the database.
  --refreeze         forces step 4 to take a new freeze for the current week even if one already
                     exists for it.
  --season=<year>    overrides the season (default: the season implied by today's date -- January
                     and February still belong to the season that kicked off the previous autumn).

EXIT CODE
  Nonzero if any step's status is "failed". A "skipped" step is not a failure -- it is the honest,
  expected outcome for a week that has not been played, graded or reached kickoff yet.

THE CRON SCHEDULE (installed by scripts/install-season-cron.sh)
  Tuesday   08:00 ET   data pass    -- catches the week just played (stats + grading).
  Wednesday 18:00 ET   data pass    -- a mid-week props refresh, lines firmer than at week-open.
  Thursday  14:00 ET   freeze pass  -- hours of margin before this season's Thursday-evening
                                       kickoffs; whichever of the three passes gets there first
                                       takes the week's freeze, the other two skip citing it.
  All three run the identical \`npm run season:week\` -- every step is idempotent-or-skip, so
  running it three times a week costs nothing extra beyond the one real freeze it eventually takes.
  See scripts/install-season-cron.sh's own header for the full reasoning and the DST/timezone
  caveat, and docs/ops/season-runbook.md for the installed entries themselves.

OTHER ONE-LINERS THIS CADENCE DOES NOT COVER
  Kickoff-eve depth ingest (run once, the evening before week 1's own kickoff):
    npm run projections:preseason:ingest 2026 2026

  Historical props backfill for a season already played (spends real, metered historical-odds
  credits; the default budget is 9000 credits per run, pass --budget=<n> to cap it lower, and a
  budget-truncated run resumes cleanly on the next call -- already-archived events are skipped):
    npm run projections:odds:backfill -- --seasons=2025 --budget=9000

WHEN A STEP REPORTS "failed"
  stats-ingest   Check DATABASE_URL is set and reachable, and that nflverse's release host is not
                 down (an \`upstream\` NflverseError, not the ordinary \`not_found\` a preseason week
                 prints as a skip). Re-run \`npm run season:week\` once the cause is fixed -- the
                 step is idempotent, nothing is lost by retrying.
  props-snapshot Check ODDS_API_KEY is set. If the credits line printed \`remaining=0\`, the
                 month's budget is spent; wait for the reset rather than retrying. Otherwise check
                 the odds API is reachable. A failed props step never blocks freeze or grade.
  grade          A per-week SKIPPED line inside this step (printed in its detail, not a "failed"
                 status) means that week's stats have not landed -- not an error. A step-level
                 "failed" means the database itself could not be reached; check DATABASE_URL.
  freeze         "already frozen at <instant>" is the expected skip on every pass after the first
                 that reaches a given week -- not a failure. A "failed" status here means the
                 refusal fired for cause: either the week's kickoff has already passed (nothing to
                 do until next week) or the SERVED board is empty -- an empty shadow is reported in
                 the step's detail lines and never a failure (check
                 \`npm run projections:preseason:persist\` has been run for this season).
  scoreboard     A read-only step; a failure here means the database connection itself dropped
                 mid-run. Re-run once it is back.
`;

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2), new Date());
  if (args.help) {
    console.log(HELP_TEXT);
    return;
  }

  const options: SeasonWeekOptions = { season: args.season, dryRun: args.dryRun, refreeze: args.refreeze };
  const db = createDb(requireEnv("DATABASE_URL"));
  const systemClock = { now: () => new Date().toISOString() };

  try {
    const deps: SeasonWeekDeps = {
      db,
      clock: systemClock,
      ingestStats: (season) => realIngestStats(db, season),
      snapshotProps: () => realSnapshotProps(db),
    };

    console.log(`season-week: season ${args.season}${args.dryRun ? " (dry run)" : ""}${args.refreeze ? " (refreeze)" : ""}`);
    console.log("");

    const { steps, exitCode } = await runSeasonWeek(deps, options);
    for (const step of steps) printStep(step);

    process.exitCode = exitCode;
  } finally {
    await db.$client.end();
  }
}

function printStep(step: StepResult): void {
  const badge = step.status === "ok" ? "OK" : step.status === "skipped" ? "SKIP" : "FAILED";
  console.log(`[${badge}] ${step.step}: ${step.summary}`);
  for (const line of step.detail) console.log(`    ${line}`);
  console.log("");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
