// Runs the ADP enrichment exactly once and exits, printing what the feed supplied, what landed,
// and what it cost. Run: npm run stats:adp (dotenv -e .env.local -- tsx scripts/ingest-adp.ts)
//
// This is what an operator runs after `npm run seed` so the draft pool ranks by the market's
// Average Draft Position instead of by projections alone — with STATS_PROVIDER=tank01 that is a
// real-money read (3 requests: the memoized player list's 2 + the ADP feed's 1), so the budget
// line prints last and always, the same discipline as `scripts/ingest-once.ts`.
//
// Reuses the process-wide singletons (`@/stats-pipeline`) rather than building a second wiring:
// the same provider instance, the same ledger, the same shared dev database `getDb()` serves.
import { getDb } from "@/db/client";
import { getIngestionBudget, getStatsProvider } from "@/stats-pipeline";
import { ingestAdp } from "@/stats-pipeline/adp";

async function main(): Promise<void> {
  const budget = getIngestionBudget();
  const before = await budget.remaining();

  const result = await ingestAdp(getDb(), getStatsProvider(), budget);
  console.log(`the ADP feed ranked ${result.adpEntries} players; ${result.playersUpdated} players rows took a value`);
  if (result.playersUpdated < result.adpEntries) {
    console.log(
      `${result.adpEntries - result.playersUpdated} ranked player(s) have no players row yet; run \`npm run seed\` first if that number looks large`,
    );
  }

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
