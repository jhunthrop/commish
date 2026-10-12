// Operator path for a stat revision the ingestion worker's own three-day correction sweep can no
// longer reach — Phase 2 Plan B's own residual (docs/decisions/live-scoring-pipeline.md §10),
// closed by Task 10's `correctSettledWeek`. This script is only the caller that decision doc said
// was missing: recompute-and-overwrite through the exact same machinery the worker uses
// (`persistTick`, `finalizeWeek`), for an operator-chosen week with no hard limit.
//
// Run: npm run stats:correct -- --week <weekNumber> --by <operatorUserId>
//
// Confirmed-destructive, `scripts/remove-review.ts`'s own idiom: a preflight print, an explicit
// y/N confirmation, and nothing written until it is given. The budget line prints last and
// always, mirroring `scripts/ingest-once.ts` — the first thing an operator sees is what running
// this actually cost.
import { createInterface } from "node:readline/promises";
import { eq } from "drizzle-orm";
import { getDb } from "@research/db/client";
import { leagues, matchups, teams } from "@/db/schema";
import { renderNotice } from "@/integrity/notices";
import { getIngestionBudget, getStatsProvider } from "@/stats-pipeline";
import { correctSettledWeek } from "@/stats-pipeline/correction";

interface Args {
  readonly week: number;
  readonly by: string;
}

const USAGE = "Usage: npm run stats:correct -- --week <weekNumber> --by <operatorUserId>";

function parseArgs(argv: readonly string[]): Args {
  const flags = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === undefined || !arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) throw new Error(`--${key} needs a value.\n${USAGE}`);
    flags.set(key, value);
    i += 1;
  }
  const weekRaw = flags.get("week");
  const by = flags.get("by");
  if (weekRaw === undefined || by === undefined) {
    throw new Error(`--week and --by are both required.\n${USAGE}`);
  }
  const week = Number(weekRaw);
  if (!Number.isInteger(week) || week < 1) {
    throw new Error(`--week must be a positive whole number.\n${USAGE}`);
  }
  return { week, by };
}

async function confirm(prompt: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(`${prompt} [y/N] `);
    return answer.trim().toLowerCase() === "y";
  } finally {
    rl.close();
  }
}

interface NoticeSample {
  readonly leagueName: string;
  readonly teamName: string;
  readonly points: number;
}

interface Preview {
  readonly leagueIds: readonly string[];
  readonly sample: NoticeSample | null;
}

/**
 * Every league fielding this week today, and — for one real team in one of them — enough to
 * render a real notice through `renderNotice` without spending a second, uncounted round of
 * provider requests. The correction itself is the only place this script reads the provider, and
 * it runs only after confirmation, so this preview is built from what `matchups` already stores:
 * TODAY'S points and a neutral outcome clause, not the corrected ones — the exact points and
 * whether the result itself moves are decided by the correction, once the provider's revised
 * numbers are known. The preview shows the notice's SHAPE against a real league, team and score,
 * not a preview of the answer.
 */
async function previewFor(week: number): Promise<Preview> {
  const db = getDb();
  const rows = await db
    .select({ leagueId: matchups.leagueId, homeTeamId: matchups.homeTeamId, homeScore: matchups.homeScore })
    .from(matchups)
    .where(eq(matchups.weekNumber, week));
  const leagueIds = [...new Set(rows.map((row) => row.leagueId))].sort();

  const first = rows[0];
  if (first === undefined) return { leagueIds, sample: null };

  const [league] = await db.select({ name: leagues.name }).from(leagues).where(eq(leagues.id, first.leagueId));
  const [team] = await db.select({ name: teams.name }).from(teams).where(eq(teams.id, first.homeTeamId));
  return {
    leagueIds,
    sample: { leagueName: league?.name ?? first.leagueId, teamName: team?.name ?? first.homeTeamId, points: first.homeScore ?? 0 },
  };
}

async function printBudgetDelta(before: number): Promise<void> {
  const budget = getIngestionBudget();
  const remaining = await budget.remaining();
  const metered = getStatsProvider().requestCost === "metered";
  console.log(
    metered
      ? `this run debited ${before - remaining} requests; ingestion budget remaining this month: ${remaining}`
      : `this run debited nothing: the configured provider answers locally and costs no upstream requests`,
  );
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const db = getDb();
  const budget = getIngestionBudget();
  const before = await budget.remaining();

  const { leagueIds, sample } = await previewFor(args.week);
  if (leagueIds.length === 0) {
    console.error(`No league fields week ${args.week}. Nothing to correct.`);
    await printBudgetDelta(before);
    process.exit(1);
  }

  console.log(`About to correct week ${args.week}, run by operator ${args.by}:`);
  console.log(`  leagues that will re-settle: ${leagueIds.join(", ")}`);
  if (sample !== null) {
    const notice = renderNotice("stat_week_corrected", {
      leagueName: sample.leagueName,
      week: args.week,
      points: sample.points,
      outcome: "your matchup result stays the same",
    });
    console.log(`  a manager whose points move (for example ${sample.teamName} in ${sample.leagueName}) reads a notice shaped like:`);
    console.log(`    ${notice.title}`);
    console.log(`    ${notice.body}`);
    console.log("  (today's points and a neutral outcome, not the real ones; the correction decides those)");
  }

  const proceed = await confirm("Correct this week?");
  if (!proceed) {
    console.log("Cancelled. Nothing was written.");
    await printBudgetDelta(before);
    process.exit(0);
  }

  const result = await correctSettledWeek(db, { week: args.week, by: args.by });
  if (!result.ok) {
    console.error(result.reason);
    await printBudgetDelta(before);
    process.exit(1);
  }

  console.log(JSON.stringify(result));

  // A partial failure is still ok:true — correctSettledWeek reports it as a non-empty
  // leaguesFailed rather than refusing the whole run, because each league commits independently.
  // The script has to notice that, not just result.ok, or an operator watching only the exit
  // code sees a partial run as a clean one.
  if (result.leaguesFailed.length > 0) {
    console.error(`${result.leaguesFailed.length} league(s) did not commit:`);
    for (const failure of result.leaguesFailed) {
      console.error(`  ${failure.leagueId}: ${failure.reason}`);
    }
    console.error("Re-run this same command. The correction is idempotent, so re-running only touches the leagues that did not commit.");
    await printBudgetDelta(before);
    process.exit(1);
  }

  await printBudgetDelta(before);
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
