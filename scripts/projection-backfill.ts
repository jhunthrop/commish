// Backfills the historical player universe and N seasons of nflverse participation and outcomes
// into the point-in-time store. Run: npm run projections:backfill [firstSeason] [lastSeason]
// (dotenv -e .env.local -- tsx scripts/projection-backfill.ts 2020 2024)
//
// Separate from `projection-report.ts` because the two answer different questions and take very
// different amounts of time. The report ingests the two seasons it needs and prints a scoreboard;
// this walks every season a model will ever be fitted on, which is minutes of downloads and roughly
// a million observations, and is run when the seasons change rather than when a model does.
//
// It prints PER-SEASON RESOLUTION and stops if any season falls below the bar. That is the whole
// reason it reports at all: a player the universe cannot place is silently absent from the store,
// and an absent player is indistinguishable from one who did not play, so a backfill that quietly
// lost eight percent of receivers would look like a lot of healthy scratches. Phase 1 measured a
// name join against today's roster degrading from 98.1% (2024) to 87.1% (2023); this is the number
// that says whether the id join fixed it.
//
// nflverse is free, so unlike `ingest-once.ts` this spends no upstream request budget.
import { createDb } from "@/db/client";
import { createNflverseClient } from "@/projections/nflverse/client";
import { ingestPlayerUniverse, ingestSeason } from "@/projections/nflverse/ingest";

const FIRST_SEASON = Number(process.argv[2] ?? 2020);
const LAST_SEASON = Number(process.argv[3] ?? 2024);

/**
 * The resolution a season must clear to be usable, from the Phase 2 plan's own stop condition.
 * Below this the backfill reports and exits non-zero rather than proceeding quietly, because the
 * cost of a thin season is not visible in any number downstream.
 */
const MINIMUM_RESOLUTION = 0.95;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`${name} is not set. Run this through \`npm run projections:backfill\`, which loads .env.local.`);
  }
  return value;
}

function percent(value: number | null): string {
  return value === null ? "  n/a " : `${(value * 100).toFixed(1)}%`;
}

async function main(): Promise<void> {
  if (!Number.isInteger(FIRST_SEASON) || !Number.isInteger(LAST_SEASON) || FIRST_SEASON > LAST_SEASON) {
    throw new Error(`Seasons must be whole numbers with the first no later than the last; got ${FIRST_SEASON}..${LAST_SEASON}.`);
  }
  const db = createDb(requireEnv("DATABASE_URL"));
  const client = createNflverseClient();

  const universe = await ingestPlayerUniverse(db, client);
  console.log("historical player universe ingested\n");

  let thin = false;
  let observations = 0;
  for (let season = FIRST_SEASON; season <= LAST_SEASON; season += 1) {
    const report = await ingestSeason(db, client, universe, season);
    observations += report.observationsWritten;
    const worst = Math.min(report.participationResolution ?? 0, report.statLineResolution ?? 0);
    if (worst < MINIMUM_RESOLUTION) thin = true;
    console.log(
      `${season}: ${report.participationRows} participation rows, ${report.statLines} stat lines, ` +
        `${report.observationsWritten} new observations | universe ${percent(report.participationResolution)} participation, ` +
        `${percent(report.statLineResolution)} weekly stats${worst < MINIMUM_RESOLUTION ? "  <-- BELOW THE BAR" : ""}`,
    );
    for (const unresolved of [...report.unresolved].sort((a, b) => b.occurrences - a.occurrences).slice(0, 5)) {
      console.log(`    unresolved: ${unresolved.name} (${unresolved.id}) x${unresolved.occurrences}`);
    }
  }
  console.log(`\n${observations} new observations across ${LAST_SEASON - FIRST_SEASON + 1} seasons`);

  await db.$client.end();
  if (thin) {
    console.error(`\nAt least one season resolved below ${(MINIMUM_RESOLUTION * 100).toFixed(0)}%. Do not fit a model on it without saying so.`);
    process.exit(2);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
