// THE PEEK TIMING HARNESS — how long `playerSeason` takes and how many round trips it makes, for
// the exact server function the player peek and the full player page both call
// (`src/league-service/player.ts`). This is the measurement the peek-facts precompute design
// (`docs/superpowers/specs/2026-09-07-peek-facts-precompute-design.md`) records before and after.
//
// Run: npm run peek:timing <leagueId> <playerId> [playerId ...]
//
// IT READS AND NEVER WRITES. It opens its OWN postgres client rather than `getDb()` so it can hand
// `postgres`' `debug` hook a counter: the driver calls it once per statement it actually sends, so
// the number printed is real round trips, not an application-level guess at how many queries a code
// path "should" make. The client is wrapped in the same schema-less `drizzle(client)` the product
// uses, so `playerSeason` runs byte-for-byte what it runs in production.
//
// COLD AND WARM. Each player is timed twice against the same process. The first pass pays for every
// cold buffer and every first-touch plan; the second is the steady state a manager clicking through
// a board actually experiences. Both are printed, because a design that only reported the warm pass
// would be hiding the number a fresh serverless instance pays.
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import type { Db } from "@research-ts/db/client";
import { players } from "@research-ts/db/schema";
import { leagues } from "@/db/schema";
import { playerSeason } from "@/league-service/player";

/** One timed call: which player, which pass, what it cost. */
interface PeekTiming {
  readonly playerId: string;
  readonly label: string;
  readonly pass: "cold" | "warm";
  readonly milliseconds: number;
  readonly queries: number;
}

function requireDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (url === undefined || url === "") {
    throw new Error("DATABASE_URL is not set. Run this through `npm run peek:timing`, which loads .env.local.");
  }
  return url;
}

interface Args {
  readonly leagueId: string;
  readonly playerIds: readonly string[];
}

function parseArgs(argv: readonly string[]): Args {
  const [leagueId, ...playerIds] = argv;
  if (leagueId === undefined || leagueId === "") {
    throw new Error("A league id is required: npm run peek:timing <leagueId> <playerId> [playerId ...].");
  }
  if (playerIds.length === 0) {
    throw new Error("At least one player id is required: npm run peek:timing <leagueId> <playerId> [playerId ...].");
  }
  return { leagueId, playerIds };
}

/** A mutable counter the driver's own `debug` hook increments, and the drizzle handle built over
 *  the client that reports to it. One object so the two can never be wired to different counters. */
interface CountingDb {
  readonly db: Db;
  readonly client: postgres.Sql;
  count(): number;
  reset(): void;
}

function countingDb(connectionString: string): CountingDb {
  let queries = 0;
  const client = postgres(connectionString, {
    max: 4,
    prepare: false,
    debug: () => {
      queries += 1;
    },
  });
  return {
    db: drizzle(client),
    client,
    count: () => queries,
    reset: () => {
      queries = 0;
    },
  };
}

async function timeOne(counting: CountingDb, leagueId: string, playerId: string, label: string, pass: "cold" | "warm"): Promise<PeekTiming> {
  counting.reset();
  const started = performance.now();
  const body = await playerSeason(counting.db, leagueId, playerId);
  const milliseconds = performance.now() - started;
  if (body === null) {
    throw new Error(`playerSeason returned nothing for player ${playerId}; check the id against the players table.`);
  }
  return { playerId, label, pass, milliseconds, queries: counting.count() };
}

function formatTimings(timings: readonly PeekTiming[]): string {
  const header = ["player", "pass", "ms", "queries"];
  const rows = timings.map((timing) => [timing.label, timing.pass, timing.milliseconds.toFixed(0), String(timing.queries)]);
  const widths = header.map((cell, column) => Math.max(cell.length, ...rows.map((row) => row[column]!.length)));
  const line = (cells: readonly string[]): string => cells.map((cell, column) => cell.padEnd(widths[column]!)).join("  ");
  return [line(header), line(widths.map((width) => "-".repeat(width))), ...rows.map(line)].join("\n");
}

async function main(): Promise<void> {
  const { leagueId, playerIds } = parseArgs(process.argv.slice(2));
  const counting = countingDb(requireDatabaseUrl());

  const [league] = await counting.db.select({ id: leagues.id }).from(leagues).where(eq(leagues.id, leagueId));
  if (league === undefined) {
    await counting.client.end();
    throw new Error(`No league ${leagueId}. Pass a real league id.`);
  }

  const timings: PeekTiming[] = [];
  for (const playerId of playerIds) {
    const [row] = await counting.db.select({ name: players.name, position: players.position }).from(players).where(eq(players.id, playerId));
    if (row === undefined) {
      await counting.client.end();
      throw new Error(`No player ${playerId}. Pass a real product player id.`);
    }
    const label = `${row.name} (${row.position})`;
    timings.push(await timeOne(counting, leagueId, playerId, label, "cold"));
    timings.push(await timeOne(counting, leagueId, playerId, label, "warm"));
  }

  console.log(formatTimings(timings));
  await counting.client.end();
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
