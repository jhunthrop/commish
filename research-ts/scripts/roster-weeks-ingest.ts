// One-shot: archive the nflverse weekly roster file for one or more seasons into
// `nflverse_roster_weeks` (the cutdown and week-by-week status codes the roster-status gate and
// the availability classifier read). The projection-context script does this too, but only
// alongside a full season's play-by-play; the current season needs the roster file on its own.
// (dotenv -e .env.local -- tsx scripts/roster-weeks-ingest.ts 2026 [lastSeason])
import { createDb } from "@research-ts/db/client";
import { createNflverseClient } from "@research-ts/projections/nflverse/client";
import { ingestRosterWeeks } from "@research-ts/projections/nflverse/roster-weeks";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`${name} is not set. Run this through \`npm run projections:roster-weeks\`, which loads .env.local.`);
  }
  return value;
}

function seasonsArg(): readonly number[] {
  const first = Number(process.argv[2]);
  const last = Number(process.argv[3] ?? process.argv[2]);
  if (!Number.isInteger(first) || !Number.isInteger(last) || last < first) {
    throw new Error("usage: roster-weeks-ingest.ts <firstSeason> [lastSeason]");
  }
  return Array.from({ length: last - first + 1 }, (_, index) => first + index);
}

async function main(): Promise<void> {
  const db = createDb(requireEnv("DATABASE_URL"));
  const reports = await ingestRosterWeeks(db, createNflverseClient(), seasonsArg());
  for (const report of reports) console.log(JSON.stringify(report));
  await db.$client.end();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
