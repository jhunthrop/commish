// Takes one prospective-register freeze: writes down what EVERY tracked board (the served one and
// each shadow, `register/sources.ts`) and the three benchmarks said about a week, before that week's
// first kickoff.
//
// Run: npm run projections:register:freeze -- --season=2026 --week=1
//
// REFUSES AT OR AFTER THE WEEK'S OWN FIRST KICKOFF (`takeFreeze`), which is the whole point of the
// register and not a safety rail on it: a claim written down after the games have started is not a
// prediction, and nothing in the stored row could tell a later reader which it was. Run this before
// Thursday night, every week.
//
// PRINTS WHAT IT CAUGHT, NEVER JUST A ROW COUNT. The three benchmark columns are tri-state and a
// feed that has gone quiet produces a perfectly valid freeze full of nulls, which is
// indistinguishable from a freeze taken in a week nobody had an opinion about. The coverage line and
// the top-ten stance below are the check an operator can actually make with their own eyes.
import { inArray } from "drizzle-orm";
import { createDb, type ReadonlyDb } from "@research/db/client";
import { nflPlayers } from "@research/db/schema";
import type { Clock } from "@research/domain/timing";
import { requireEnv } from "@research/projections/odds/http";
import { formatCoverage, takeFreeze } from "@research/projections/register/freeze";
import type { RegisterFreezeRow } from "@research/projections/register/store";

const systemClock: Clock = { now: () => new Date().toISOString() };

/** How many of the frozen board's own top rows to print — enough to recognise the board at a
 *  glance, short enough to read in a terminal. */
const SHOWN_ROWS = 10;

function requireNumberArg(name: string): number {
  const raw = process.argv.slice(2).find((arg) => arg.startsWith(`--${name}=`));
  if (raw === undefined) throw new Error(`register-freeze: --${name}=<n> is required.`);
  const value = Number(raw.slice(`--${name}=`.length));
  if (!Number.isInteger(value)) throw new Error(`register-freeze: --${name} must be an integer, got "${raw}".`);
  return value;
}

function benchmark(value: number | null, digits: number): string {
  return value === null ? "—" : value.toFixed(digits);
}

function line(row: RegisterFreezeRow, name: string): string {
  return [
    String(row.boardRank).padStart(6),
    `  ${name}`.padEnd(26),
    row.boardPoints.toFixed(1).padStart(9),
    benchmark(row.adpRank, 1).padStart(8),
    benchmark(row.ecrRank, 0).padStart(8),
    benchmark(row.propsPoints, 2).padStart(9),
  ].join("");
}

/** Names for the handful of rows this prints. An id is unambiguous and unreadable; the sanity check
 *  this report exists for is somebody recognising the board's own top ten. */
async function namesFor(db: ReadonlyDb, playerIds: readonly string[]): Promise<ReadonlyMap<string, string>> {
  const rows = await db.select({ id: nflPlayers.id, name: nflPlayers.name }).from(nflPlayers).where(inArray(nflPlayers.id, [...playerIds]));
  return new Map(rows.map((row) => [row.id, row.name]));
}

async function main(): Promise<void> {
  const season = requireNumberArg("season");
  const week = requireNumberArg("week");
  const db = createDb(requireEnv("DATABASE_URL"));

  try {
    const result = await takeFreeze(db, { season, week }, systemClock);
    console.log(`register-freeze: ${season} week ${week}`);
    console.log(`  frozen at   ${result.frozenAt.toISOString()}`);
    console.log(`  kickoff     ${result.kickoff.toISOString()} (${((result.kickoff.getTime() - result.frozenAt.getTime()) / 3_600_000).toFixed(1)}h away)`);
    console.log(`  rows        ${result.rows.length} across ${result.boards.length} board(s)`);

    // EVERY BOARD, PRINTED IN FULL. A shadow whose stance is never shown is a shadow nobody checks,
    // and the top-ten block is the check an operator can make with their own eyes.
    const names = await namesFor(
      db,
      result.boards.flatMap((board) => [...board.rows].sort((a, b) => a.boardRank - b.boardRank).slice(0, SHOWN_ROWS)).map((row) => row.playerId),
    );
    for (const board of result.boards) {
      console.log("");
      console.log(`  ${board.source} [${board.role}]`);
      console.log(`    board as-of ${board.boardAsOf === null ? "(no rows)" : board.boardAsOf.toISOString()}`);
      console.log(`    rows        ${board.rows.length}`);
      console.log(`    coverage    ${formatCoverage(board.coverage)}`);
      if (board.rows.length === 0) continue;
      console.log("");
      console.log(`${"rank".padStart(6)}${"  player".padEnd(26)}${"points".padStart(9)}${"adp".padStart(8)}${"ecr".padStart(8)}${"props".padStart(9)}`);
      for (const row of [...board.rows].sort((a, b) => a.boardRank - b.boardRank).slice(0, SHOWN_ROWS)) {
        console.log(line(row, names.get(row.playerId) ?? row.playerId));
      }
    }
  } finally {
    await db.$client.end();
  }
}

await main();
