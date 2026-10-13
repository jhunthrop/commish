// Ingests ONLY the published ADP boards, in one or more scoring formats, for a range of seasons —
// the backfill the scoring-formats round needs (half PPR from 2018, standard from 2013) for a store
// whose rosters, depth charts and PPR benchmark are already in place.
// Run: npm run projections:adp:ingest -- --formats=half,std [firstSeason] [lastSeason]
//      (defaults to every format, BENCHMARK_BOARD_FLOOR through PRODUCT_SEASON)
//
// WRITES NOTHING BUT `preseason_rankings` ROWS UNDER THE NAMED FORMATS' OWN SOURCES, and appends
// only (`recordPreseasonRankings` conflicts do nothing): a re-run over a season already ingested
// reports 0 new and moves on. Re-running `preseason-ingest.ts` for the same reach would also
// re-fetch every week-one roster and depth chart from nflverse, which is hours of downloads to
// pick up two hundred rows a season, and is the same narrowing `kdef-adp-ingest.ts` already makes.
//
// A SEASON THE FEED DOES NOT PUBLISH A FORMAT FOR (half PPR before 2018) answers with an empty
// board, which the parser refuses; it is printed as "not published upstream" and the run goes on.
// Any other failure (an HTTP error, a resolution below the bar) marks the run thin and it exits 2,
// the identical contract `preseason-ingest.ts` keeps.
import { createDb } from "@research-ts/db/client";
import { ingestAdpBenchmark, rosterIdentitiesFor } from "@research-ts/projections/preseason/adp-benchmark";
import { BENCHMARK_BOARD_FLOOR } from "@research-ts/projections/preseason/benchmarks";
import { BOARD_FORMAT_SPECS, BOARD_FORMATS, isBoardFormat, type BoardFormat } from "@research-ts/projections/preseason/board-formats";
import { PRODUCT_SEASON } from "@research-ts/projections/preseason/current";

/** The same bar `preseason-ingest.ts` holds a benchmark to. */
const MINIMUM_RESOLUTION = 0.7;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`${name} is not set. Run this through \`npm run projections:adp:ingest\`, which loads .env.local.`);
  }
  return value;
}

function parseFormats(argv: readonly string[]): readonly BoardFormat[] {
  const flag = argv.find((argument) => argument.startsWith("--formats="));
  if (flag === undefined) return BOARD_FORMATS;
  return flag
    .slice("--formats=".length)
    .split(",")
    .map((value) => {
      if (!isBoardFormat(value)) throw new Error(`"${value}" is not a board format (${BOARD_FORMATS.join(", ")}).`);
      return value;
    });
}

function parseSeasons(argv: readonly string[]): readonly number[] {
  const positional = argv.filter((argument) => !argument.startsWith("--")).map(Number);
  const first = positional[0] ?? BENCHMARK_BOARD_FLOOR;
  const last = positional[1] ?? PRODUCT_SEASON;
  if (!Number.isInteger(first) || !Number.isInteger(last) || first > last) {
    throw new Error(`Seasons must be whole numbers with the first no later than the last; got ${first}..${last}.`);
  }
  return Array.from({ length: last - first + 1 }, (_, index) => first + index);
}

function percent(value: number | null): string {
  return value === null ? "  n/a " : `${(value * 100).toFixed(1)}%`;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const formats = parseFormats(argv);
  const seasons = parseSeasons(argv);
  const db = createDb(requireEnv("DATABASE_URL"));
  let thin = false;

  for (const season of seasons) {
    const identities = await rosterIdentitiesFor(db, season);
    console.log(`${season}: ${identities.length} roster identities to resolve against`);
    for (const format of formats) {
      const source = BOARD_FORMAT_SPECS[format].adpSource;
      try {
        const report = await ingestAdpBenchmark(db, season, format, identities);
        console.log(
          `  ${source.padEnd(22)} ${String(report.published).padStart(4)} published, ${String(report.resolved).padStart(4)} resolved ` +
            `(${percent(report.resolutionRate)}), ${report.written} new | publisher stamp "${report.publisherStamp}", ` +
            `stored as ${report.publishedAt.toISOString().slice(0, 10)}`,
        );
        for (const missed of report.unresolvedSample) console.log(`      unresolved: ${missed}`);
        if (report.resolutionRate !== null && report.resolutionRate < MINIMUM_RESOLUTION) thin = true;
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        if (/published no \d{4} board/.test(message)) {
          console.log(`  ${source.padEnd(22)} not published upstream for ${season}`);
          continue;
        }
        thin = true;
        console.error(`  ${source.padEnd(22)} FAILED: ${message}`);
      }
    }
  }

  await db.$client.end();
  if (thin) {
    console.error(`\nAt least one board failed or resolved below ${(MINIMUM_RESOLUTION * 100).toFixed(0)}%. Do not anchor a board to it without saying so.`);
    process.exit(2);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
