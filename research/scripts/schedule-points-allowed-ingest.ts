// Backfills the schedule's POINTS-ALLOWED metric (`SCHEDULE_METRICS.pointsAllowed`) into the team
// store for every season the store already carries schedule facts for.
// Run: npm run projections:schedule:points-allowed
//
// THE ONE INPUT A TEAM DEFENCE'S PROJECTION CANNOT GET ANYWHERE ELSE (the 2026-09-05 kicker and team
// defence round). The points-allowed tier tables are the largest single component of a fantasy
// defence's score, and until this metric existed the store held only each game's RESULT: the mapper
// has parsed `pointsFor`/`pointsAgainst` since the beginning and `scheduleObservations` wrote
// neither. `SCHEDULE_METRICS.gameResult`'s own docblock says so, and was right at the time that the
// scores were a bigger claim than any reader then needed.
//
// Writes ONLY the points-allowed rows, never the rest of `scheduleObservations` — the identical
// narrowing `schedule-results-ingest.ts` makes, and for the identical reason: re-running the full
// schedule ingestion to add one metric would also insert every row the upstream file has gained
// since the last real run, which is a data change nobody asked for.
import { createDb } from "@research/db/client";
import { ingestPointsAllowed } from "@research/projections/nflverse/ingest";
import { seasonsWithScheduleCoverage } from "./validate-win-totals";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`${name} is not set. Run this through \`npm run projections:schedule:points-allowed\`, which loads .env.local.`);
  }
  return value;
}

async function main(): Promise<void> {
  const db = createDb(requireEnv("DATABASE_URL"));

  const seasons = await seasonsWithScheduleCoverage(db);
  if (seasons.length === 0) {
    throw new Error("The store holds no schedule observations at all, so there is no season to backfill points allowed for.");
  }
  console.log(`Store schedule coverage: seasons ${seasons.join(", ")}.`);

  const written = await ingestPointsAllowed(db, seasons);
  console.log(`New points-allowed observations written: ${written} (a re-run reports 0 here).`);

  await db.$client.end();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
