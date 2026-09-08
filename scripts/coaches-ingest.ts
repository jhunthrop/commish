// Validates data/play-callers/play-callers.csv exactly as `npm run facts:play-callers` does, then
// upserts every row into the `coaches` table on its natural key. Idempotent: a re-run after an
// edit to the file updates the edited tenures in place and leaves the rest as they were.
// Run: npm run coaches:ingest   (loads .env.local; DATABASE_URL names the target)
//
// A warm server instance sees the new rows when its coaches memo expires (the board's hourly
// cadence) or when the next board write clears the board memo group, whichever comes first.
import { createDb } from "@/db/client";
import { envOrUndefined } from "@/lib/env";
import { ingestPlayCallersCsv, PLAY_CALLERS_CSV_PATH } from "./lib/play-callers-csv";

function requireDatabaseUrl(): string {
  const value = envOrUndefined("DATABASE_URL");
  if (value === undefined) {
    throw new Error("DATABASE_URL is not set. Run this through `npm run coaches:ingest`, which loads .env.local.");
  }
  return value;
}

async function main(): Promise<void> {
  const db = createDb(requireDatabaseUrl());
  try {
    const report = await ingestPlayCallersCsv(db, PLAY_CALLERS_CSV_PATH);
    console.log(`${PLAY_CALLERS_CSV_PATH}: ${report.rowsRead} rows read, ${report.rowsWritten} rows written to coaches.`);
  } finally {
    await db.$client.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
