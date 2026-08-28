// Backfills the TEAM-level context store: the schedule, and a season of play-by-play reduced to
// team-week facts. Run: npm run projections:context [firstSeason] [lastSeason]
// (dotenv -e .env.local -- tsx scripts/projection-context.ts 2020 2024)
//
// Separate from `projection-backfill.ts` because the costs are two orders of magnitude apart. A
// season of play-by-play is a hundred megabytes and every column of it; the participation backfill
// is a few megabytes. Bundling them would put a very long download on the path of anybody who
// wanted the player store rebuilt.
//
// Nothing here is held in memory: the client streams the file, the aggregator keeps one small
// record per team-week, and the plays are discarded as they arrive.
//
// nflverse is free, so this spends no upstream request budget.
import { createDb } from "@/db/client";
import { createNflverseClient } from "@/projections/nflverse/client";
import { ingestCoaches, ingestPlayByPlay, ingestSchedule } from "@/projections/nflverse/ingest";

const FIRST_SEASON = Number(process.argv[2] ?? 2020);
const LAST_SEASON = Number(process.argv[3] ?? 2024);

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`${name} is not set. Run this through \`npm run projections:context\`, which loads .env.local.`);
  }
  return value;
}

async function main(): Promise<void> {
  if (!Number.isInteger(FIRST_SEASON) || !Number.isInteger(LAST_SEASON) || FIRST_SEASON > LAST_SEASON) {
    throw new Error(`Seasons must be whole numbers with the first no later than the last; got ${FIRST_SEASON}..${LAST_SEASON}.`);
  }
  const db = createDb(requireEnv("DATABASE_URL"));
  const seasons = Array.from({ length: LAST_SEASON - FIRST_SEASON + 1 }, (_, index) => FIRST_SEASON + index);

  // One small file covers every season, so it is fetched once rather than once per season.
  const scheduleRows = await ingestSchedule(db, seasons);
  console.log(`schedule: ${scheduleRows} new team-week observations across ${seasons.join(", ")}`);

  const client = createNflverseClient();
  for (const season of seasons) {
    const started = Date.now();
    const report = await ingestPlayByPlay(db, client, season);
    console.log(
      `${season}: ${report.playsRead} plays -> ${report.teamWeeks} team-weeks, ` +
        `${report.observationsWritten} new observations in ${((Date.now() - started) / 1000).toFixed(0)}s`,
    );
  }

  // Last, because a coach's prior pace can only be computed once the seasons he coached are in the
  // store. Running it before the play-by-play would silently produce a table of nulls.
  const coachRows = await ingestCoaches(db, seasons);
  console.log(`coaches: ${coachRows} new team-week observations`);

  await db.$client.end();
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
