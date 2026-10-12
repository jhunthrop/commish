// Fetches the CURRENT season's expert consensus and stores it against the players this product
// actually holds.
// Run: npm run projections:ecr:current [season]   (defaults to the season the platform is playing)
//
// THE ONE BENCHMARK A LIVE SEASON CAN REACH TODAY. `preseason-ingest.ts` ingests a season that has
// finished: it resolves published names against nflverse's archived week-one roster, and it is part
// of a pipeline whose other half — the board — needs three prior seasons of ingested usage and a
// replay moment derived from games that have already been played. None of that exists for a season
// nobody has played yet, and `docs/research/2026-08-28-live-season.md` scopes what would make it.
//
// A consensus is different in kind: it is PUBLISHED BEFORE a season rather than derived from one,
// so the only thing standing between it and a player's screen was somewhere to hang it. The
// crosswalk is that somewhere. The spine is the product's own roster, which is the narrow,
// demonstrably-current candidate set `resolveRankings` says a name join needs, and every resolved
// name is carried into the store's id space by id.
//
// THE RESOLUTION RATE IS PRINTED AND THE UNRESOLVED ARE NAMED. A benchmark that silently resolved
// sixty percent of a board would be shown on the sixty percent of players that happened to match.
import { createDb } from "@research/db/client";
import { BENCHMARK_SOURCES, resolveRankings } from "@research/projections/preseason/benchmarks";
import { crossedRosterIdentities, PRODUCT_SEASON } from "@research/projections/preseason/current";
import { fetchExpertConsensus } from "@research/projections/preseason/publishers";
import { recordPreseasonRankings } from "@research/projections/preseason/store";

const SEASON = Number(process.argv[2] ?? PRODUCT_SEASON);

/** Below this the ingestion is reported as thin and exits non-zero, matching
 *  `preseason-ingest.ts`' own gate so the two cannot drift on what "enough" means. */
const MINIMUM_RESOLUTION = 0.7;

/** How many unresolved names to print. Enough to see whether the misses have a shape. */
const NAMED_MISSES = 20;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`${name} is not set. Run this through \`npm run projections:ecr:current\`, which loads .env.local.`);
  }
  return value;
}

function percent(rate: number | null): string {
  return rate === null ? "n/a" : `${(rate * 100).toFixed(1)}%`;
}

async function main(): Promise<void> {
  const db = createDb(requireEnv("DATABASE_URL"));

  const identities = await crossedRosterIdentities(db);
  if (identities.length === 0) {
    throw new Error("The crosswalk is empty. Run `npm run projections:crosswalk` first.");
  }

  const board = await fetchExpertConsensus(SEASON);
  const resolution = resolveRankings(board.candidates, identities);
  const written = await recordPreseasonRankings(
    db,
    resolution.resolved.map((row) => ({
      season: SEASON,
      source: BENCHMARK_SOURCES.ecr,
      playerId: row.playerId,
      rank: row.rank,
      asOf: board.publishedAt,
    })),
  );

  console.log(`\n${SEASON} EXPERT CONSENSUS (${BENCHMARK_SOURCES.ecr})`);
  console.log(`  published stamp on the page      ${board.publisherStamp}`);
  console.log(`  stored as knowable at            ${board.publishedAt.toISOString()}`);
  console.log(`  crossed-over roster spine        ${identities.length} players`);
  console.log(`  ranked by the publisher          ${board.candidates.length}`);
  console.log(`  resolved                         ${resolution.resolved.length} (${percent(resolution.resolutionRate)})`);
  console.log(`  new rows written                 ${written}`);

  console.log(`\n  UNRESOLVED (${resolution.unresolved.length}). Named, never silently dropped.`);
  for (const candidate of resolution.unresolved.slice(0, NAMED_MISSES)) {
    console.log(`    ${String(candidate.rank).padStart(4)} ${candidate.position.padEnd(4)} ${candidate.name} (${candidate.team ?? "no team"})`);
  }
  if (resolution.unresolved.length > NAMED_MISSES) {
    console.log(`    ... and ${resolution.unresolved.length - NAMED_MISSES} more`);
  }

  await db.$client.end();

  if (resolution.resolutionRate !== null && resolution.resolutionRate < MINIMUM_RESOLUTION) {
    console.error(`\nTHIN: resolved ${percent(resolution.resolutionRate)}, below the ${percent(MINIMUM_RESOLUTION)} floor.`);
    process.exit(2);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
