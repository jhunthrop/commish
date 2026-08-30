// Runs exactly one ephemeral-feed capture pass and exits, printing per-feed outcomes and cost.
// Run: npm run stats:capture (dotenv -e .env.local -- tsx scripts/capture-once.ts)
//
// The worker runs this same pass on its tick; this script exists so an operator can land a
// fresh snapshot (a new feed's first, an injury report before kickoff) without waiting out
// the poll interval. Same singletons, same ledger, same freshness keys.
import { getDb } from "@/db/client";
import { getCapture, getIngestionBudget } from "@/stats-pipeline";

async function main(): Promise<void> {
  const capture = getCapture(getDb());
  if (capture === undefined) {
    console.log("nothing to capture: the configured provider is not metered or no API key is set");
    return;
  }
  const budget = getIngestionBudget();
  const before = await budget.remaining();
  const result = await capture();
  if (result.reason !== undefined) console.log(`pass refused: ${result.reason}`);
  for (const feed of result.feeds) {
    console.log(`${feed.source}: ${feed.status} (${feed.requests} request${feed.requests === 1 ? "" : "s"})${feed.reason === undefined ? "" : ` — ${feed.reason}`}`);
  }
  const remaining = await budget.remaining();
  console.log(`this pass debited ${before - remaining} requests; ingestion budget remaining today: ${remaining}`);
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
