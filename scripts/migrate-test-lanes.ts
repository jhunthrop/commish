// Creates and migrates every test-database lane (or one lane, via TEST_DB_LANE) so a `vitest run`
// sharded across parallel workers finds a schema-current database wherever `VITEST_POOL_ID` sends it.
// Run: npm run db:migrate:test [-- --lane=N]   (env TEST_DB_LANE=N does the same as --lane=N)
//
// See `src/db/test-lanes.ts` for the lane-naming contract this turns into real databases and real
// `drizzle-kit migrate` runs: lane 1 is `commish_test` (TEST_DATABASE_URL, unchanged from before
// lanes existed); lanes 2-4 are `commish_test_2`, `commish_test_3`, `commish_test_4`.
//
// PROVISIONING LIVES HERE, NOT IN A docker-entrypoint-initdb.d SCRIPT, deliberately. An init script
// runs only when Postgres initializes an EMPTY data directory, which was every container start while
// the test data dir was a tmpfs and is now (disk-backed, see docker-compose.yml) exactly once per
// volume. Provisioning that only fires on a fresh volume would mean a lane-count change needs a
// `docker compose down -v` before it takes, and it would need the lane names spelled out a second
// time as SQL literals where they could drift from `TEST_DB_LANE_COUNT`. Doing it here makes
// `db:migrate:test` the ONE idempotent command that brings every lane into existence and up to date,
// off one source of truth, whatever state the container is in.
import { execFileSync } from "node:child_process";
import postgres from "postgres";
import { TEST_DB_LANE_COUNT, testDatabaseUrlForLane } from "@/db/test-lanes";

const DEFAULT_TEST_DATABASE_URL = "postgres://commish:commish@localhost:5433/commish_test";

/** The maintenance database every Postgres server has, which `CREATE DATABASE` must be issued from
 *  because it cannot run inside the database it is creating. */
const MAINTENANCE_DATABASE = "postgres";

function requestedLane(argv: readonly string[]): number | null {
  const flag = argv.find((arg) => arg.startsWith("--lane="));
  const raw = flag === undefined ? process.env.TEST_DB_LANE : flag.slice("--lane=".length);
  if (raw === undefined || raw === "") return null;
  const lane = Number(raw);
  if (!Number.isInteger(lane) || lane < 1 || lane > TEST_DB_LANE_COUNT) {
    throw new Error(`"${raw}" is not a valid lane (1-${TEST_DB_LANE_COUNT}).`);
  }
  return lane;
}

/** The database name a lane's URL points at — the path with its leading slash removed. */
function databaseNameOf(url: string): string {
  return decodeURIComponent(new URL(url).pathname.replace(/^\//, ""));
}

/**
 * Creates every lane database that does not exist yet, connected to the server's maintenance
 * database. Idempotent by construction: a lane that already exists is left exactly as it is, schema
 * and rows included, so this is safe to run against a working test database as often as anyone likes.
 */
async function ensureLaneDatabases(baseUrl: string, lanes: readonly number[]): Promise<void> {
  const maintenanceUrl = new URL(baseUrl);
  maintenanceUrl.pathname = `/${MAINTENANCE_DATABASE}`;
  const sql = postgres(maintenanceUrl.toString(), { max: 1 });
  try {
    for (const lane of lanes) {
      const name = databaseNameOf(testDatabaseUrlForLane(baseUrl, lane));
      const existing = await sql`SELECT 1 FROM pg_database WHERE datname = ${name}`;
      if (existing.length > 0) continue;
      // `sql(name)` is postgres-js's IDENTIFIER interpolation (a quoted name), not a bind parameter
      // -- CREATE DATABASE accepts no parameter for its target. The name itself is generated from
      // TEST_DB_LANE_COUNT and this process's own connection URL, never from a caller's argument.
      await sql`CREATE DATABASE ${sql(name)}`;
      console.log(`Created lane database ${name}.`);
    }
  } finally {
    await sql.end();
  }
}

/** One lane's `drizzle-kit migrate`, run exactly the way `db:migrate:test` always has -- the
 *  lane's URL as `DATABASE_URL`, which is the one env var `drizzle.config.ts` reads. */
function migrateLane(baseUrl: string, lane: number): void {
  const databaseUrl = testDatabaseUrlForLane(baseUrl, lane);
  console.log(`Migrating lane ${lane}: ${databaseUrl}`);
  execFileSync("npx", ["drizzle-kit", "migrate"], {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: databaseUrl },
  });
}

async function main(): Promise<void> {
  const baseUrl = process.env.TEST_DATABASE_URL ?? DEFAULT_TEST_DATABASE_URL;
  const requested = requestedLane(process.argv.slice(2));
  const lanes =
    requested !== null ? [requested] : Array.from({ length: TEST_DB_LANE_COUNT }, (_, index) => index + 1);

  await ensureLaneDatabases(baseUrl, lanes);
  for (const lane of lanes) {
    migrateLane(baseUrl, lane);
  }
}

await main();
