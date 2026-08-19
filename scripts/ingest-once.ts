// Runs exactly one stats-ingestion tick and exits, printing what it found and what it cost.
// Run: npm run stats:ingest (dotenv -e .env.local -- tsx scripts/ingest-once.ts)
//
// This is what a developer runs to see the live-scoring pipeline work without waiting on
// STATS_INGESTION_CONFIG.pollIntervalMs (30 minutes), and what the founder will run first with
// a real TANK01_API_KEY — the budget line prints last and always, so the first thing anyone
// sees with a real key is what a tick cost, not a surprise invoice at the end of the month.
//
// Reuses `getIngestionWorker()` (`@/stats-pipeline`) rather than building a second wiring: the
// same singleton `src/instrumentation.ts` starts on every server process, ticked once by hand.
import { getIngestionBudget, getIngestionWorker, getStatsProvider } from "@/stats-pipeline";
import type { TickOutcome } from "@/stats-pipeline/worker";

function describeOutcome(outcome: TickOutcome): string {
  const league = outcome.leagueId === undefined ? "" : ` (league ${outcome.leagueId})`;
  const result = outcome.applied ? "applied" : `not applied — ${outcome.reason ?? "no reason given"}`;
  return `week ${outcome.week}${league}: ${result}`;
}

async function main(): Promise<void> {
  const budget = getIngestionBudget();
  const before = await budget.remaining();

  const outcomes = await getIngestionWorker().tick();
  if (outcomes.length === 0) {
    console.log("nothing to ingest — every examined week is already final");
  } else {
    for (const outcome of outcomes) console.log(describeOutcome(outcome));
  }

  // What THIS tick cost, not only what is left. The two-phase reservation means the debit is the
  // tick's actual upstream request count, so this line is the one place that property is visible
  // outside the test suite — and it is the first thing anyone runs with a real key.
  const remaining = await budget.remaining();
  const metered = getStatsProvider().requestCost === "metered";
  console.log(
    metered
      ? `this tick debited ${before - remaining} requests; ingestion budget remaining this month: ${remaining}`
      : `this tick debited nothing: the configured provider answers locally and costs no upstream requests`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
