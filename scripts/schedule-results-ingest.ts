// Backfills the schedule's game-RESULT metric (`SCHEDULE_METRICS.gameResult`) into the team store
// for every season the store already carries schedule facts for (Task 3 of the vegas-laws plan).
// Run: npm run projections:schedule:results
// (dotenv -e .env.local -- tsx scripts/schedule-results-ingest.ts)
//
// A team's regular-season RECORD was the one schedule fact the store could not answer: the mapper
// has always carried each game's points for and against, but nothing wrote them anywhere, so the
// only way to a season's wins was to re-fetch and re-derive the raw file. `incomingTeamWinTotalDelta`
// (`laws/discovery-facts.ts`) needs that record through the ordinary as-of-gated read every other
// fact uses, which means it has to be IN the store.
//
// Writes ONLY the result rows, never the rest of `scheduleObservations` — see `ingestGameResults`'s
// own docblock for why re-running the full schedule ingestion to add one metric would be a data
// change nobody asked for.
import { createDb } from "@/db/client";
import { ingestGameResults } from "@/projections/nflverse/ingest";
import { seasonsWithScheduleCoverage } from "./validate-win-totals";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`${name} is not set. Run this through \`npm run projections:schedule:results\`, which loads .env.local.`);
  }
  return value;
}

async function main(): Promise<void> {
  const db = createDb(requireEnv("DATABASE_URL"));

  const seasons = await seasonsWithScheduleCoverage(db);
  if (seasons.length === 0) {
    throw new Error("The store holds no schedule observations at all, so there is no season to backfill results for.");
  }
  console.log(`Store schedule coverage: seasons ${seasons.join(", ")}.`);

  const written = await ingestGameResults(db, seasons);
  console.log(`New game-result observations written: ${written} (a re-run reports 0 here).`);

  await db.$client.end();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
