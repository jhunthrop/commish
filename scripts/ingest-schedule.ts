// Ingests the NFL schedule exactly once and exits: one request per week, every fixture upserted
// into nfl_games with its published kickoff. Run: npm run stats:schedule
// (dotenv -e .env.local -- tsx scripts/ingest-schedule.ts)
//
// Re-running is the refresh: statuses and flexed kickoffs overwrite in place. With
// STATS_PROVIDER=tank01 this is a real-money read (18 requests for a full season), so the budget
// line prints last and always, the same discipline as scripts/ingest-adp.ts.
import { getDb } from "@research-ts/db/client";
import { getIngestionBudget, getStatsProvider } from "@/stats-pipeline";
import { ingestSchedule } from "@/stats-pipeline/schedule";

async function main(): Promise<void> {
  const budget = getIngestionBudget();
  const before = await budget.remaining();

  const result = await ingestSchedule(getDb(), getStatsProvider(), budget);
  console.log(`the schedule feed answered for ${result.weeks} week(s); ${result.games} fixtures are in nfl_games`);

  const remaining = await budget.remaining();
  const metered = getStatsProvider().requestCost === "metered";
  console.log(
    metered
      ? `this run debited ${before - remaining} requests; ingestion budget remaining today: ${remaining}`
      : `this run debited nothing: the configured provider answers locally and costs no upstream requests`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
