// THE IN-SEASON ENTRY POINT: the two research jobs whose cadence the nightly run cannot carry,
// because what they record depends on WHEN they run (research-ts/JOBS.md has the whole inventory).
//
//   season-week       the prospective register's weekly pass: ingest the week's stats, snapshot the
//                     props, grade every gradeable week, freeze the coming week before its first
//                     kickoff, print the running score. Today's cadence: Tue 08:00, Wed 18:00 and
//                     Thu 14:00 America/New_York. The freeze must land before Thursday's kickoff
//                     with the props it was measured against, which a 05:00 UTC nightly cannot
//                     promise, and the record's method depends on that timing.
//   capture-harvest   the provider capture (injuries, news, depth charts, inactives, betting lines)
//                     into the append-only archive. Today's cadence: hourly 07:00-23:00 plus 02:00
//                     America/New_York. Game-day inactives and injury moves are only in the
//                     archive if something captures them within the hour.
//
// Each run is one pass; the scheduler owns the cadence. Exit code 1 when any step failed.
//
//   npm run inseason -w @commish/research-ts -- --task=season-week [--season=2026] [--dry-run]
//   npm run inseason -w @commish/research-ts -- --task=capture-harvest
import { createDb, type Db } from "@research-ts/db/client";
import type { Clock } from "@research-ts/domain/timing";
import { requireEnv } from "@research-ts/lib/env";
import { harvestCaptures } from "@research-ts/projections/harvest";
import { realIngestStats, realSnapshotProps } from "@research-ts/projections/season-week/deps";
import { defaultSeason, runSeasonWeek } from "@research-ts/projections/season-week/steps";

const TASKS = ["season-week", "capture-harvest"] as const;
type Task = (typeof TASKS)[number];

/** Seconds the pool is given to close; see the nightly entry point for why this is bounded. */
const POOL_CLOSE_TIMEOUT_SECONDS = 5;

function write(line: string): void {
  process.stdout.write(`${new Date().toISOString()} ${line}\n`);
}

function argument(argv: readonly string[], name: string): string | undefined {
  return argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
}

function taskOf(argv: readonly string[]): Task {
  const task = argument(argv, "task");
  if (task === undefined || !(TASKS as readonly string[]).includes(task)) throw new Error(`inseason: --task must be one of ${TASKS.join(", ")}, got ${JSON.stringify(task)}.`);
  return task as Task;
}

async function seasonWeek(db: Db, clock: Clock, argv: readonly string[]): Promise<boolean> {
  const seasonArg = argument(argv, "season");
  const season = seasonArg === undefined ? defaultSeason(new Date(clock.now())) : Number(seasonArg);
  if (!Number.isInteger(season)) throw new Error(`inseason: --season must be an integer, got "${seasonArg}".`);
  const run = await runSeasonWeek(
    { db, clock, ingestStats: (target) => realIngestStats(db, target), snapshotProps: () => realSnapshotProps(db) },
    { season, dryRun: argv.includes("--dry-run"), refreeze: false },
  );
  for (const step of run.steps) {
    write(`${step.step}: ${step.status}, ${step.summary}`);
    for (const line of step.detail) write(`  ${line}`);
  }
  return run.exitCode === 0;
}

/** A refused capture (`CaptureResult.reason`: no budget, no key, nothing the provider would serve)
 *  captured nothing, so it fails the run with its reason, as a failed feed does. */
async function captureHarvest(db: Db, clock: Clock): Promise<boolean> {
  const report = await harvestCaptures(db, clock, {});
  write(`${report.summary}. ${report.moved.length} player(s) moved`);
  for (const line of report.detail) write(`  ${line}`);
  if (report.result.reason !== undefined) {
    process.stderr.write(`inseason: capture-harvest REFUSED, ${report.result.reason}\n`);
    return false;
  }
  return report.result.feeds.every((feed) => feed.status !== "failed");
}

async function main(): Promise<void> {
  process.exitCode = 1;
  const argv = process.argv.slice(2);
  const task = taskOf(argv);
  const db = createDb(requireEnv("DATABASE_URL"));
  const clock: Clock = { now: () => new Date().toISOString() };
  try {
    const ok = task === "season-week" ? await seasonWeek(db, clock, argv) : await captureHarvest(db, clock);
    process.exitCode = ok ? 0 : 1;
  } finally {
    await db.$client.end({ timeout: POOL_CLOSE_TIMEOUT_SECONDS });
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`inseason: FAILED, ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
  process.exit(1);
});
