// Drops the lane-set databases of worktrees that no longer exist.
// Run: npm run db:lanes:prune [-- --dry-run]
//
// `db:migrate:test` mints four databases per worktree (`src/db/test-lanes.ts`), and an agent
// worktree is a disposable thing: delete the checkout and its four databases are left behind with
// nobody to name them again. This sweeps them. The live set is every worktree `git worktree list`
// knows about whose directory is still on disk, plus an explicit `TEST_DB_LANE_SET` if one is
// exported; a lane database whose set key matches none of those has no owner and goes.
//
// THE PRIMARY SET IS UNREACHABLE HERE, BY CONSTRUCTION RATHER THAN BY A CHECK. `commish_test` and
// `commish_test_2..4` carry no set segment, so `parseLaneSetDatabaseName` never parses them and
// they can never enter the drop list -- see `laneSetDatabasesToDrop`'s own tests. The explicit
// guard below is belt and braces over the same fact.
import postgres from "postgres";
import { currentLaneSet, liveLaneSetKeys } from "@/db/test-lane-set";
import {
  TEST_DB_LANE_COUNT,
  databaseNameFromUrl,
  laneDatabaseName,
  laneSetDatabasesToDrop,
  parseLaneSetDatabaseName,
} from "@/db/test-lanes";

const DEFAULT_TEST_DATABASE_URL = "postgres://commish:commish@localhost:5433/commish_test";
const MAINTENANCE_DATABASE = "postgres";

function primaryLaneDatabaseNames(baseName: string): ReadonlySet<string> {
  return new Set(Array.from({ length: TEST_DB_LANE_COUNT }, (_, index) => laneDatabaseName(baseName, index + 1, null)));
}

async function main(): Promise<void> {
  const dryRun = process.argv.slice(2).includes("--dry-run");
  const baseUrl = process.env.TEST_DATABASE_URL ?? DEFAULT_TEST_DATABASE_URL;
  const baseName = databaseNameFromUrl(baseUrl);

  const live = new Set(liveLaneSetKeys());
  const own = currentLaneSet();
  if (own !== null) live.add(own);

  const maintenanceUrl = new URL(baseUrl);
  maintenanceUrl.pathname = `/${MAINTENANCE_DATABASE}`;
  const sql = postgres(maintenanceUrl.toString(), { max: 1 });
  try {
    const rows = await sql<{ datname: string }[]>`SELECT datname FROM pg_database WHERE datistemplate = false ORDER BY datname`;
    const names = rows.map((row) => row.datname);
    const doomed = laneSetDatabasesToDrop(names, baseName, live);
    const protectedNames = primaryLaneDatabaseNames(baseName);

    if (doomed.length === 0) {
      console.log(`Nothing to prune. ${live.size} live lane set(s), ${names.length} database(s) on the server.`);
      return;
    }

    console.log(`${dryRun ? "Would drop" : "Dropping"} ${doomed.length} lane database(s) belonging to worktrees that are gone:`);
    for (const name of doomed) {
      const parsed = parseLaneSetDatabaseName(baseName, name);
      console.log(`  ${name}  (set ${parsed?.set ?? "?"}, lane ${parsed?.lane ?? "?"})`);
    }
    if (dryRun) return;

    for (const name of doomed) {
      if (protectedNames.has(name)) throw new Error(`Refusing to drop ${name}: that is a primary lane.`);
      // Identifier interpolation, not a bind parameter -- DROP DATABASE takes no parameter. Every
      // name here came back from pg_database AND parsed as `<base>_<set>_<lane>` with a set of
      // lowercase alphanumerics, so nothing a caller wrote reaches this statement.
      await sql`DROP DATABASE IF EXISTS ${sql(name)} WITH (FORCE)`;
      console.log(`Dropped ${name}.`);
    }
  } finally {
    await sql.end();
  }
}

await main();
