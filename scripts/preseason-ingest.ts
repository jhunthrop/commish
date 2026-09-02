// Ingests everything a preseason board needs that a game never produces: week-one rosters from
// nflverse, plus the two published benchmarks the engine spec names and the repository did not have
// (average draft position and expert consensus).
// Run: npm run projections:preseason:ingest [firstSeason] [lastSeason]
//
// Separate from `projection-backfill.ts` because the two make different KINDS of claim. That script
// stamps facts from the game day that produced them; every row this one writes is stamped from a
// league deadline or a publication date, and is asserting that something was knowable before a ball
// was thrown. That assertion is the single most dangerous one in the engine, so it lives in a script
// whose whole subject is the offseason rather than mixed into the season backfill.
//
// It prints PER-SEASON RESOLUTION for both benchmarks and stops if either falls below the bar, for
// the reason `projection-backfill.ts` prints its own: a benchmark that resolved sixty percent of a
// board would be scored on the sixty percent that happened to match, which selects on exactly the
// players both sources found easy.
import { createDb, type ReadonlyDb } from "@/db/client";
import { nflPlayers } from "@/db/schema";
import { createNflverseClient } from "@/projections/nflverse/client";
import { ROSTER_SOURCE_CONFIG } from "@/projections/nflverse/rosters";
import { BENCHMARK_BOARD_FLOOR, BENCHMARK_SOURCES, resolveRankings, type RosterIdentity } from "@/projections/preseason/benchmarks";
import { ingestDepthCharts, ingestWeek1Rosters, type RosterIngestReport } from "@/projections/preseason/ingest";
import { fetchAverageDraftPosition, fetchExpertConsensus, type PublishedBoard } from "@/projections/preseason/publishers";
import { preseasonRostersAsOf, recordPreseasonRankings } from "@/projections/preseason/store";

const FIRST_SEASON = Number(process.argv[2] ?? ROSTER_SOURCE_CONFIG.earliestSeason);
const LAST_SEASON = Number(process.argv[3] ?? 2024);

/**
 * The share of a published board that must resolve to the season's own roster before the benchmark
 * is usable. A published board carries kickers and team defences this engine never projects, and
 * those never resolve, so the bar is well below the one a participation backfill has to clear.
 */
const MINIMUM_RESOLUTION = 0.7;

/** Far past any correction: benchmarks are SCORED AGAINST, never fed in, exactly like actuals. */
const FINAL = new Date("9999-12-31T00:00:00.000Z");

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`${name} is not set. Run this through \`npm run projections:preseason:ingest\`, which loads .env.local.`);
  }
  return value;
}

function percent(value: number | null): string {
  return value === null ? "  n/a " : `${(value * 100).toFixed(1)}%`;
}

/**
 * What the roster write actually did, in its own path's terms.
 *
 * The archive path can only ever add, so "N new" says everything there is to say about it. The live
 * path replaces the season's rows wholesale, and "N new" would print 0 for a run that had just
 * changed two hundred statuses — the exact reading that hid the stale-roster defect for a day. See
 * `ingestWeek1Rosters`'s own docblock.
 */
function describeRosterWrite(report: RosterIngestReport): string {
  if (report.mode === "insert_if_absent") return `${report.written} new`;
  return (
    `${report.written} written (${report.added} added, ${report.replaced} replaced of which ` +
    `${report.statusChanged} changed status, ${report.removed} removed)`
  );
}

/** The season's own week-one roster, with names joined on, as the benchmark resolver needs it. */
async function rosterIdentities(db: ReadonlyDb, season: number): Promise<readonly RosterIdentity[]> {
  const roster = await preseasonRostersAsOf(db, { season, asOf: FINAL });
  const names = new Map(
    (await db.select({ id: nflPlayers.id, name: nflPlayers.name }).from(nflPlayers)).map((row) => [row.id, row.name]),
  );
  return roster
    .map((row) => ({
      playerId: row.playerId,
      name: names.get(row.playerId) ?? "",
      position: row.position,
      team: row.team,
    }))
    .filter((identity) => identity.name !== "");
}

async function ingestBenchmark(
  db: ReturnType<typeof createDb>,
  season: number,
  source: string,
  board: PublishedBoard,
  identities: readonly RosterIdentity[],
): Promise<number | null> {
  const resolution = resolveRankings(board.candidates, identities);
  const written = await recordPreseasonRankings(
    db,
    resolution.resolved.map((row) => ({ season, source, playerId: row.playerId, rank: row.rank, asOf: board.publishedAt })),
  );
  console.log(
    `  ${source.padEnd(22)} ${String(board.candidates.length).padStart(4)} published, ${String(resolution.resolved.length).padStart(4)} resolved ` +
      `(${percent(resolution.resolutionRate)}), ${written} new | publisher stamp "${board.publisherStamp}", ` +
      `stored as ${board.publishedAt.toISOString().slice(0, 10)}`,
  );
  for (const missed of resolution.unresolved.slice(0, 5)) {
    console.log(`      unresolved: ${missed.name} (${missed.position}, ${missed.team ?? "no team"}) at ${missed.rank}`);
  }
  return resolution.resolutionRate;
}

async function main(): Promise<void> {
  if (!Number.isInteger(FIRST_SEASON) || !Number.isInteger(LAST_SEASON) || FIRST_SEASON > LAST_SEASON) {
    throw new Error(`Seasons must be whole numbers with the first no later than the last; got ${FIRST_SEASON}..${LAST_SEASON}.`);
  }
  const db = createDb(requireEnv("DATABASE_URL"));
  const client = createNflverseClient();
  let thin = false;

  for (let season = FIRST_SEASON; season <= LAST_SEASON; season += 1) {
    const rosters = await ingestWeek1Rosters(db, season, client);
    console.log(
      `${season}: ${rosters.entriesRead} week-one roster entries, ${describeRosterWrite(rosters)}, ` +
        `${rosters.unknownToUniverse} not in the universe`,
    );
    const depth = await ingestDepthCharts(db, season, client);
    console.log(
      `${season}: ${depth.entriesRead} week-one offensive depth-chart entries, ${depth.written} new, ` +
        // "cutoff" rather than "stamped": since Task 3's publication-instant change, a DATED season's
        // rows each carry their own snapshot's real `dt`, not this uniform value. See
        // `DepthChartIngestReport.asOf`'s own docblock.
        `${depth.unknownToUniverse} not in the universe, cutoff ${depth.asOf.toISOString()}`,
    );

    // THE BENCHMARKS HAVE THEIR OWN FLOOR, AND IT IS NOT THE ROSTER FLOOR (fit-round Task 1).
    // `HISTORICAL_ROSTER_FLOOR` moved to 2003 so this script could backfill the old decade's
    // week-one rosters; neither published board exists that far back (`BENCHMARK_BOARD_FLOOR`).
    // Skipped explicitly and printed, never attempted-and-failed: a fetch that 404s for a season no
    // board was ever published for is not a degraded run, and reporting it as one would leave every
    // archive backfill exiting non-zero and train an operator to ignore the exit code.
    if (season < BENCHMARK_BOARD_FLOOR) {
      console.log(
        `${season}: no published preseason board upstream (BENCHMARK_BOARD_FLOOR is ${BENCHMARK_BOARD_FLOOR}); ` +
          `rosters and depth charts only for this season.`,
      );
      continue;
    }

    const identities = await rosterIdentities(db, season);

    for (const [source, load] of [
      [BENCHMARK_SOURCES.adp, fetchAverageDraftPosition],
      [BENCHMARK_SOURCES.ecr, fetchExpertConsensus],
    ] as const) {
      try {
        const rate = await ingestBenchmark(db, season, source, await load(season), identities);
        if (rate !== null && rate < MINIMUM_RESOLUTION) thin = true;
      } catch (error: unknown) {
        // A benchmark that cannot be fetched is REPORTED and the run continues, because the rosters
        // are the part a board cannot be built without and the benchmarks are the part it is scored
        // against. Losing the scoreboard is bad; losing it silently is what this line prevents.
        thin = true;
        console.error(`  ${source.padEnd(22)} FAILED: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  await db.$client.end();
  if (thin) {
    console.error(
      `\nAt least one benchmark is missing or resolved below ${(MINIMUM_RESOLUTION * 100).toFixed(0)}%. Do not publish a comparison against it without saying so.`,
    );
    process.exit(2);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
