// Grades every frozen week the store now has outcomes for, and prints the running scoreboard.
//
// Run: npm run projections:register:grade -- --season=2026
//      npm run projections:register:grade -- --season=2026 --week=3
//
// SKIPS RATHER THAN FAILS on a week whose stats have not landed yet: this is meant to be run every
// Tuesday over the whole season, and a week 5 that is not ingested must not stop weeks 1 to 4 from
// being graded. Every skip is NAMED with its reason, because a week silently missing from a
// scoreboard reads as a week nobody predicted.
//
// RE-RUNNING IS SAFE AND MEANINGFUL. Grading appends: a second grading of the same week is a new
// `graded_at` beside the first, never an overwrite, so a re-run after a stat correction shows both
// what was scored before the correction and after it. The running scoreboard reads only the LATEST
// grading of each week, so a re-run does not double-count.
import { createDb } from "@research/db/client";
import type { Clock } from "@research/domain/timing";
import { requireEnv } from "@research/projections/odds/http";
import { formatScoreboard, gradableWeeksFor, gradeWeek, runningScoreboard } from "@research/projections/register/grade";

const systemClock: Clock = { now: () => new Date().toISOString() };

function numberArg(name: string): number | undefined {
  const raw = process.argv.slice(2).find((arg) => arg.startsWith(`--${name}=`));
  if (raw === undefined) return undefined;
  const value = Number(raw.slice(`--${name}=`.length));
  if (!Number.isInteger(value)) throw new Error(`register-grade: --${name} must be an integer, got "${raw}".`);
  return value;
}

function requireSeason(): number {
  const season = numberArg("season");
  if (season === undefined) throw new Error("register-grade: --season=<year> is required.");
  return season;
}

function show(value: number | null, digits: number): string {
  return value === null ? "n/a" : value.toFixed(digits);
}

async function main(): Promise<void> {
  const season = requireSeason();
  const only = numberArg("week");
  const db = createDb(requireEnv("DATABASE_URL"));

  try {
    const frozen = await gradableWeeksFor(db, season);
    const weeks = only === undefined ? frozen : frozen.filter((week) => week === only);
    if (weeks.length === 0) {
      console.log(`register-grade: the register holds no freeze to grade for ${season}${only === undefined ? "" : ` week ${only}`}.`);
      return;
    }

    for (const week of weeks) {
      try {
        const grade = await gradeWeek(db, { season, week }, systemClock);
        console.log(`week ${String(week).padStart(2)}  graded the ${grade.frozenAt.toISOString()} freeze at ${grade.gradedAt.toISOString()}`);
        for (const board of grade.boards) {
          const summary = board.scores.map((score) => `${score.column} ${show(score.spearman, 4)} (n=${score.graded})`).join("  ");
          console.log(`          ${board.boardSource.padEnd(26)} ${String(board.population).padStart(4)} players  ${summary}`);
        }
        for (const board of grade.skipped) {
          console.log(`          ${board.boardSource.padEnd(26)} SKIPPED: ${board.reason}`);
        }
      } catch (error: unknown) {
        console.log(`week ${String(week).padStart(2)}  SKIPPED: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    console.log("");
    console.log(`register-grade: ${season} running scoreboard, cumulative by board and column`);
    console.log(formatScoreboard(await runningScoreboard(db, season)));
  } finally {
    await db.$client.end();
  }
}

await main();
