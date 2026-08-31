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
//
// THE GAP-SEASON BRANCH. `ingestSeason`'s published weekly stats file does not exist for any season
// named in `STAT_LINE_GAPS` (today, only 2019 — a deterministic 404, not a transient one). For every
// such season inside the requested range, this ALSO derives stat lines from that season's own
// play-by-play (`ingestDerivedStatLines`, `nflverse/derived-stat-lines.ts`) and writes them under the
// second source id `DERIVED_STAT_LINE_SOURCE` — never mixed with the published rows, and admitted by
// a measurement read only for a gap season (`statLinesAsOfForMeasurement`, wired into
// `laws/populations.ts`). Derived rows never render on a product surface.
//
// THE VALIDATION BAR. Deriving from play-by-play is only trustworthy if it can be shown to agree
// with a season nflverse DID publish. Whenever a gap season falls in the requested range, this also
// derives the fixed control season 2018 the identical way and compares its season points against
// 2018's own published line: `seasonPointsAgreement` (a pure, unit-tested function) computes the
// rank correlation across players with at least eight games. The spec's bar is 0.99 — below that,
// the honest outcome is to say so and leave 2019 as a hole rather than ship a derivation nobody
// checked.
import { createDb } from "@/db/client";
import type { Db } from "@/db/client";
import { allPositions } from "@/projections/backtest";
import { statLinesAsOf } from "@/projections/lines";
import { createNflverseClient } from "@/projections/nflverse/client";
import { seasonPointsAgreement } from "@/projections/nflverse/derived-stat-lines";
import { ingestDerivedStatLines, ingestPlayerUniverse, ingestSeason } from "@/projections/nflverse/ingest";
import { STAT_LINE_GAPS } from "@/projections/nflverse/stat-lines";
import { LAST_POSSIBLE_WEEK } from "@/projections/store";
import type { NflverseClient } from "@/projections/nflverse/client";

const FIRST_SEASON = Number(process.argv[2] ?? 2020);
const LAST_SEASON = Number(process.argv[3] ?? 2024);

/**
 * The resolution a season must clear to be usable, from the Phase 2 plan's own stop condition.
 * Below this the backfill reports and exits non-zero rather than proceeding quietly, because the
 * cost of a thin season is not visible in any number downstream.
 */
const MINIMUM_RESOLUTION = 0.95;

/** The fixed, non-gap control season the spec names for the validation bar. Never a parameter —
 *  the comparison is only meaningful measured against the one season the spec chose. */
const STAT_LINE_VALIDATION_SEASON = 2018;

/** The bar `seasonPointsAgreement`'s rank correlation must clear before a gap season's derivation
 *  is trustworthy. Below this, the honest outcome is to report why, not to ship it. */
const MINIMUM_AGREEMENT = 0.99;

/** A season nothing has ever corrected past — the same "ungated, final" moment `laws/populations.ts`
 *  reads published actuals at. */
const FINAL_OUTCOME = new Date("9999-12-31T00:00:00.000Z");

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

/**
 * Derives and writes stat lines for every requested season nflverse never published — the gap-season
 * branch. Idempotent, like every ingestion here: a re-run of a season already landed writes 0 new
 * observations.
 */
async function deriveGapSeasons(db: Db, client: NflverseClient, seasons: readonly number[]): Promise<void> {
  for (const season of seasons.filter((year) => STAT_LINE_GAPS.includes(year))) {
    const report = await ingestDerivedStatLines(db, client, season);
    console.log(
      `${season}: GAP SEASON, no published weekly stats upstream. Derived from play-by-play: ` +
        `${report.playsRead} plays -> ${report.statLines} stat lines, ${report.observationsWritten} new observations` +
        (report.unknownPlayers === 0 ? "" : `, ${report.unknownPlayers} stat-takers the universe does not project`),
    );
  }
}

/**
 * THE VALIDATION RUN. Derives `STAT_LINE_VALIDATION_SEASON` (2018) from its own play-by-play the
 * identical way a gap season is derived, reads that same season's PUBLISHED line back out of the
 * store, and prints the measured agreement. Runs only when a gap season is actually in the requested
 * range — there is no reason to pay for this download on a backfill that never touches 2019.
 */
async function validateAgainstPublished(db: Db, client: NflverseClient, seasons: readonly number[]): Promise<void> {
  if (!seasons.some((year) => STAT_LINE_GAPS.includes(year))) return;

  console.log(`\nvalidating the derivation against ${STAT_LINE_VALIDATION_SEASON} (published, not a gap season):`);
  const derivedReport = await ingestDerivedStatLines(db, client, STAT_LINE_VALIDATION_SEASON);
  const published = await statLinesAsOf(db, {
    season: STAT_LINE_VALIDATION_SEASON,
    week: { from: 1, to: LAST_POSSIBLE_WEEK },
    asOf: FINAL_OUTCOME,
  });
  if (published.length === 0) {
    console.log(
      `  ${STAT_LINE_VALIDATION_SEASON} has no published stat lines in this store; run projections:backfill for ` +
        `${STAT_LINE_VALIDATION_SEASON} first, then re-run this validation.`,
    );
    return;
  }

  const positions = await allPositions(db);
  const agreement = seasonPointsAgreement(derivedReport.derivedLines, published, positions);
  const passed = agreement.rankCorrelation !== null && agreement.rankCorrelation >= MINIMUM_AGREEMENT;
  console.log(
    `  season-points rank correlation: ${agreement.rankCorrelation === null ? "n/a" : agreement.rankCorrelation.toFixed(4)} ` +
      `across ${agreement.sampleSize} players with >= 8 games (bar is ${MINIMUM_AGREEMENT.toFixed(2)})`,
  );
  if (!passed) {
    console.error(
      `\nThe derivation did not clear the validation bar. Do not treat the gap season's derived stat ` +
        `lines as trustworthy without investigating where the disagreement concentrates.`,
    );
    process.exit(3);
  }
  console.log("  bar cleared; the gap season's derivation is trusted.");
}

async function main(): Promise<void> {
  if (!Number.isInteger(FIRST_SEASON) || !Number.isInteger(LAST_SEASON) || FIRST_SEASON > LAST_SEASON) {
    throw new Error(`Seasons must be whole numbers with the first no later than the last; got ${FIRST_SEASON}..${LAST_SEASON}.`);
  }
  const db = createDb(requireEnv("DATABASE_URL"));
  const client = createNflverseClient();

  const universe = await ingestPlayerUniverse(db, client);
  console.log("historical player universe ingested\n");

  const seasons = Array.from({ length: LAST_SEASON - FIRST_SEASON + 1 }, (_, index) => FIRST_SEASON + index);

  let thin = false;
  let observations = 0;
  for (const season of seasons) {
    const report = await ingestSeason(db, client, universe, season);
    observations += report.observationsWritten;
    const worst = Math.min(report.participationResolution ?? 0, report.statLineResolution ?? 0);
    // A gap season is EXPECTED to resolve 0% of weekly stats (there is nothing published to
    // resolve against) — that is not thinness, it is the hole this backfill's next step fills.
    if (worst < MINIMUM_RESOLUTION && !STAT_LINE_GAPS.includes(season)) thin = true;
    console.log(
      `${season}: ${report.participationRows} participation rows, ${report.statLines} stat lines, ` +
        `${report.observationsWritten} new observations | universe ${percent(report.participationResolution)} participation, ` +
        `${percent(report.statLineResolution)} weekly stats${worst < MINIMUM_RESOLUTION && !STAT_LINE_GAPS.includes(season) ? "  <-- BELOW THE BAR" : ""}`,
    );
    for (const unresolved of [...report.unresolved].sort((a, b) => b.occurrences - a.occurrences).slice(0, 5)) {
      console.log(`    unresolved: ${unresolved.name} (${unresolved.id}) x${unresolved.occurrences}`);
    }
  }
  console.log(`\n${observations} new observations across ${seasons.length} seasons`);

  await deriveGapSeasons(db, client, seasons);
  await validateAgainstPublished(db, client, seasons);

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
