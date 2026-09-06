// Backfills the market's own KICKER and TEAM DEFENCE rows into `preseason_rankings`, for a store
// that already holds every other row of the same board.
// Run: npm run projections:kdef:adp [season ...]   (defaults to 2013 through 2025)
//
// THE TWO POSITIONS THE BENCHMARK RESOLVER USED TO LOSE ENTIRELY (the 2026-09-05 kicker and team
// defence round). Measured against the real 2025 board before this round: 249 rows published, 205
// resolved, and every one of the 44 misses was a kicker or a team defence. A kicker is published as
// `PK` and spelled `K` on the roster the resolver joins against, so the name-and-position key never
// matched; a team defence is not a person, has no roster row and never will, so it could not match
// at all. `benchmarks.ts` now translates the one and places the other by team code.
//
// Both gate G2 and the market-order fallback need this. A position that fails its gates ships in
// market order, and until this ran there was no market order for either of them to ship in.
//
// WRITES ONLY THE TWO POSITIONS' ROWS, never the rest of the board — the same narrowing
// `schedule-results-ingest.ts` and `schedule-points-allowed-ingest.ts` both make, and for the same
// reason: re-running the full benchmark ingestion to pick up a resolution fix would also rewrite
// every other row from a board that may have moved since it was first ingested, which is a data
// change nobody asked for and which no baseline in this repository would attribute correctly.
import { createDb, type ReadonlyDb } from "@/db/client";
import { nflPlayers } from "@/db/schema";
import {
  BENCHMARK_SOURCES,
  resolveRankings,
  type RankingCandidate,
  type RosterIdentity,
} from "@/projections/preseason/benchmarks";
import { fetchAverageDraftPosition } from "@/projections/preseason/publishers";
import { preseasonRostersAsOf, recordPreseasonRankings } from "@/projections/preseason/store";

const FIRST_SEASON = 2013;
const LAST_SEASON = 2025;

const REQUESTED = process.argv.slice(2).map(Number);
const SEASONS =
  REQUESTED.length > 0
    ? REQUESTED
    : Array.from({ length: LAST_SEASON - FIRST_SEASON + 1 }, (_, index) => FIRST_SEASON + index);

/** Far past any correction: a benchmark is SCORED AGAINST, never fed in. */
const FINAL = new Date("9999-12-31T00:00:00.000Z");

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`${name} is not set. Run this through \`npm run projections:kdef:adp\`, which loads .env.local.`);
  }
  return value;
}

/** The season's own week-one roster, with names joined on, exactly as `preseason-ingest.ts` builds it. */
async function rosterIdentities(db: ReadonlyDb, season: number): Promise<readonly RosterIdentity[]> {
  const roster = await preseasonRostersAsOf(db, { season, asOf: FINAL });
  const names = new Map(
    (await db.select({ id: nflPlayers.id, name: nflPlayers.name }).from(nflPlayers)).map((row) => [row.id, row.name]),
  );
  return roster
    .map((row) => ({ playerId: row.playerId, name: names.get(row.playerId) ?? "", position: row.position, team: row.team }))
    .filter((identity) => identity.name !== "");
}

/** The published spellings this script narrows to. `PK` is the market's own word for a kicker. */
const WANTED_POSITIONS = new Set(["PK", "K", "DEF", "DST", "D/ST"]);

function narrowed(candidates: readonly RankingCandidate[]): readonly RankingCandidate[] {
  return candidates.filter((candidate) => WANTED_POSITIONS.has(candidate.position.trim().toUpperCase()));
}

async function main(): Promise<void> {
  const db = createDb(requireEnv("DATABASE_URL"));

  console.log(`\n${"=".repeat(92)}`);
  console.log("MARKET ROWS FOR KICKERS AND TEAM DEFENCES");
  console.log(`${"=".repeat(92)}\n`);

  for (const season of SEASONS) {
    const board = await fetchAverageDraftPosition(season);
    const candidates = narrowed(board.candidates);
    const resolution = resolveRankings(candidates, await rosterIdentities(db, season));
    const written = await recordPreseasonRankings(
      db,
      resolution.resolved.map((row) => ({
        season,
        source: BENCHMARK_SOURCES.adp,
        playerId: row.playerId,
        rank: row.rank,
        asOf: board.publishedAt,
      })),
    );
    console.log(
      `  ${season}  ${String(board.candidates.length).padStart(4)} published, ${String(candidates.length).padStart(3)} of them a kicker or a defence, ` +
        `${String(resolution.resolved.length).padStart(3)} resolved, ${String(written).padStart(3)} new`,
    );
    for (const missed of resolution.unresolved.slice(0, 4)) {
      console.log(`      unresolved: ${missed.name} (${missed.position}, ${missed.team ?? "no team"}) at ${missed.rank}`);
    }
  }

  await db.$client.end();
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
