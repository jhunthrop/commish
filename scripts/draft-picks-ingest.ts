// One-shot: fetch the whole nflverse draft-pick history into `nfl_draft_picks` (filtered to the
// universe's known ids, see `ingestDraftPicks`). A re-run picks up whatever seasons are new.
// (dotenv -e .env.local -- tsx scripts/draft-picks-ingest.ts)
import { createDb } from "@research/db/client";
import { ingestDraftPicks } from "@research/projections/nflverse/draft-picks";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`${name} is not set. Run this through \`npm run projections:draft-picks\`, which loads .env.local.`);
  }
  return value;
}

async function main(): Promise<void> {
  const db = createDb(requireEnv("DATABASE_URL"));
  const report = await ingestDraftPicks(db);
  console.log(
    `Draft picks read: ${report.entriesRead}. New rows written: ${report.written} (a re-run reports 0 here). ` +
      `Skipped, not in the universe: ${report.unknownToUniverse}.`,
  );
  await db.$client.end();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
