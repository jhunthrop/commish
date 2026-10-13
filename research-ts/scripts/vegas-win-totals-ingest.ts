// Ingests data/win-totals/win-totals.csv into the team store: the posted win total, the over
// price, and the under price, one row each per team per season (Task 2 of the vegas-laws plan).
// Run: npm run projections:vegas:ingest
// (dotenv -e .env.local -- tsx scripts/vegas-win-totals-ingest.ts)
//
// Reads a committed file, not the network — run `npm run projections:win-totals:validate` first if
// the CSV itself has not been validated since it last changed; this script trusts it. The file read
// lives in `./lib/win-totals-csv.ts`, shared with the validator; nothing under `src/` reads the file.
import { createDb } from "@research-ts/db/client";
import { ingestWinTotalsCsv } from "./lib/win-totals-csv";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`${name} is not set. Run this through \`npm run projections:vegas:ingest\`, which loads .env.local.`);
  }
  return value;
}

async function main(): Promise<void> {
  const db = createDb(requireEnv("DATABASE_URL"));
  const report = await ingestWinTotalsCsv(db);

  console.log(`Read ${report.rowsRead} rows across ${report.seasons.length} seasons (${report.seasons[0]}-${report.seasons.at(-1)}).`);
  console.log("Rows per season:");
  for (const season of report.seasons) {
    console.log(`  ${season}: ${report.rowsPerSeason.get(season) ?? 0} rows`);
  }
  console.log(`New observations written: ${report.observationsWritten} (of ${report.rowsRead * 3} possible; a re-run reports 0 here).`);

  await db.$client.end();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
