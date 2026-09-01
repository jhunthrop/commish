// Prints the top N of one season's persisted board: rank, name, position, NFL team, blended points,
// ADP rank and the law chips (registry ids) that fired for him.
// Run: npm run projections:board:top [season] [n]   (n defaults to 50)
//
// READS THE STORE ONLY, the same discipline `preseason-report.ts` holds: this script never builds a
// board, it prints the one `scripts/preseason-persist.ts` already wrote down under `BOARD_SOURCE`
// (`board-store.ts`'s current value — the blended v4 board). An empty result means no board has been
// persisted for the season yet, not a silent guess.
import { createDb } from "@/db/client";
import { nflPlayers } from "@/db/schema";
import { BENCHMARK_SOURCES } from "@/projections/preseason/benchmarks";
import { BOARD_SOURCE, boardReasons, preseasonProjectionsAsOf } from "@/projections/preseason/board-store";
import { preseasonRankingsAsOf, preseasonRostersAsOf } from "@/projections/preseason/store";

/** Far past any correction: this script reads the CURRENT state of the store, never a point-in-time
 *  reconstruction — the same `9999-12-31` convention every other read-only report script uses. */
const FAR_FUTURE = new Date("9999-12-31T00:00:00.000Z");

const DEFAULT_TOP_N = 50;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`${name} is not set. Run this through \`npm run projections:board:top\`, which loads .env.local.`);
  }
  return value;
}

function parseArgs(argv: readonly string[]): { readonly season: number; readonly n: number } {
  const [seasonArg, nArg] = argv;
  if (seasonArg === undefined) {
    throw new Error("A season is required: npm run projections:board:top <season> [n].");
  }
  const season = Number(seasonArg);
  if (!Number.isInteger(season)) {
    throw new Error(`"${seasonArg}" is not a valid season.`);
  }
  const n = nArg === undefined ? DEFAULT_TOP_N : Number(nArg);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`"${nArg}" is not a valid row count.`);
  }
  return { season, n };
}

/** One row of the printed table — every field the deliverable names: rank, name, position, NFL
 *  team, blended points, ADP rank and the law chips (registry ids) that fired for him. */
export interface BoardTopRow {
  readonly rank: number;
  readonly name: string;
  /** nflverse's own spelling, straight off the week-one roster row — the raw `string` `preseason/
   *  store.ts`'s `PreseasonRosterRow` already carries, never re-narrowed to the domain `Position`
   *  union: a print script has no reason to reject a roster spelling the rest of the engine already
   *  accepted when it built the board this row came from. */
  readonly position: string;
  readonly team: string;
  readonly projectedPoints: number;
  /** `null` when the player carries no market ADP row — printed as `n/a`, never a fabricated rank. */
  readonly adpRank: number | null;
  /** Every CONFIRMED law's id (`board.ts`'s `"law"` reason) that fired for him, in the order the
   *  board carries them. Empty when no law chip fired. */
  readonly lawIds: readonly string[];
}

const RANK_WIDTH = 4;
const NAME_WIDTH = 24;
const POSITION_WIDTH = 4;
const TEAM_WIDTH = 5;
const POINTS_WIDTH = 7;
const ADP_WIDTH = 6;

/** One printed line — a fixed-width table row, in the house voice (no em dash, ever). */
export function formatBoardTopRow(row: BoardTopRow): string {
  const rank = `${row.rank}.`.padStart(RANK_WIDTH);
  const name = row.name.padEnd(NAME_WIDTH);
  const position = row.position.padEnd(POSITION_WIDTH);
  const team = row.team.padEnd(TEAM_WIDTH);
  const points = `${row.projectedPoints.toFixed(1)} pts`.padStart(POINTS_WIDTH + 4);
  const adp = `adp ${row.adpRank === null ? "n/a" : row.adpRank.toFixed(1)}`.padEnd(ADP_WIDTH + 4);
  const laws = row.lawIds.length === 0 ? "" : `  ${row.lawIds.join(", ")}`;
  return `${rank} ${name} ${position} ${team} ${points}  ${adp}${laws}`;
}

const HEADER = `${"rank".padStart(RANK_WIDTH)} ${"name".padEnd(NAME_WIDTH)} ${"pos".padEnd(POSITION_WIDTH)} ${"team".padEnd(TEAM_WIDTH)} ${"points".padStart(POINTS_WIDTH + 4)}  ${"adp".padEnd(ADP_WIDTH + 4)}laws`;

/** The whole printed table: one header line, then one line per row, in the order given. */
export function formatBoardTopTable(rows: readonly BoardTopRow[]): string {
  return [HEADER, ...rows.map(formatBoardTopRow)].join("\n");
}

async function main(): Promise<void> {
  const { season, n } = parseArgs(process.argv.slice(2));
  const db = createDb(requireEnv("DATABASE_URL"));

  const projections = await preseasonProjectionsAsOf(db, { season, source: BOARD_SOURCE, asOf: FAR_FUTURE });
  if (projections.length === 0) {
    console.log(`No ${BOARD_SOURCE} board is persisted for ${season}. Run \`npm run projections:preseason:persist ${season}\` first.`);
    await db.$client.end();
    return;
  }

  const [names, roster, adp, reasons] = await Promise.all([
    db.select({ id: nflPlayers.id, name: nflPlayers.name }).from(nflPlayers),
    preseasonRostersAsOf(db, { season, asOf: FAR_FUTURE }),
    preseasonRankingsAsOf(db, { season, source: BENCHMARK_SOURCES.adp, asOf: FAR_FUTURE }),
    boardReasons(db, BOARD_SOURCE, season),
  ]);

  const nameOf = new Map(names.map((row) => [row.id, row.name] as const));
  const teamOf = new Map(roster.map((row) => [row.playerId, row.team] as const));
  const positionOf = new Map(roster.map((row) => [row.playerId, row.position] as const));
  const adpRankOf = new Map(adp.map((row) => [row.playerId, row.rank] as const));

  const top = [...projections].sort((a, b) => a.rank - b.rank).slice(0, n);
  const rows: BoardTopRow[] = top.map((entry) => {
    const position = positionOf.get(entry.playerId);
    if (position === undefined) {
      throw new Error(`${entry.playerId} is on the persisted ${season} board but not on its week-one roster snapshot.`);
    }
    return {
      rank: entry.rank,
      name: nameOf.get(entry.playerId) ?? entry.playerId,
      position,
      team: teamOf.get(entry.playerId) ?? "n/a",
      projectedPoints: entry.projectedPoints,
      adpRank: adpRankOf.get(entry.playerId) ?? null,
      lawIds: (reasons.get(entry.playerId) ?? []).filter((reason) => reason.code === "law").map((reason) => reason.lawId),
    };
  });

  console.log(`${BOARD_SOURCE}  season ${season}  top ${rows.length} of ${projections.length}`);
  console.log(formatBoardTopTable(rows));

  await db.$client.end();
}

// Runs `main` only when this file is the process entry point (`tsx scripts/board-top.ts ...`),
// never when `board-top.test.ts` imports the pure formatting functions above — the same guard every
// other script in this repository gets for free by never being imported, which this one loses the
// moment it grows a test file for the part of it that IS pure.
if (import.meta.url === `file://${process.argv[1]}`) {
  main()
    .then(() => process.exit(0))
    .catch((error: unknown) => {
      console.error(error);
      process.exit(1);
    });
}
