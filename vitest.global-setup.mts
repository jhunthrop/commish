/**
 * THE FIRST RUN IN A FRESH WORKTREE JUST WORKS.
 *
 * Every checkout of this repository gets its own set of four lane databases
 * (`src/db/test-lanes.ts`), which means a new worktree starts with four databases that do not
 * exist yet, and an old one starts with four that may be several migrations behind whatever it
 * just pulled. Asking each agent to remember `npm run db:migrate:test` is asking for the failure
 * this whole change exists to remove, so this global setup — which runs ONCE per `vitest` process,
 * before any worker spawns — resolves the set, checks every lane, and runs `db:migrate:test` for
 * this set when any lane is missing or behind. A ready set costs four short queries.
 *
 * "Behind" is the lane's `drizzle.__drizzle_migrations` count against `drizzle/meta/_journal.json`
 * (`laneNeedsMigration`), not a timestamp: it is the one comparison that is true of a database
 * with no schema at all, of one created before today's migrations, and false of an up-to-date lane
 * whose tracking row ran one ahead of the journal after a merge-time renumbering.
 *
 * It also resolves the set INTO `process.env` so the workers this process forks inherit it without
 * shelling out to git again, and it fails fast, by name, when Postgres is not up — the alternative
 * is 600 test files each opening their own pool against nothing.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { currentLaneSet } from "./src/db/test-lane-set";
import {
  type LaneSet,
  TEST_DB_LANE_COUNT,
  databaseNameFromUrl,
  laneNeedsMigration,
  testDatabaseUrlForLane,
} from "./src/db/test-lanes";

const DEFAULT_TEST_DATABASE_URL = "postgres://commish:commish@localhost:5433/commish_test";
const MAINTENANCE_DATABASE = "postgres";
const CONNECT_TIMEOUT_SECONDS = 5;

function journalEntryCount(): number {
  const path = fileURLToPath(new URL("./drizzle/meta/_journal.json", import.meta.url));
  const journal: unknown = JSON.parse(readFileSync(path, "utf8"));
  const entries = (journal as { entries?: readonly unknown[] }).entries;
  if (entries === undefined) throw new Error(`${path} has no "entries" array — the migration journal is unreadable.`);
  return entries.length;
}

function describeSet(laneSet: LaneSet, baseName: string): string {
  return laneSet === null
    ? `primary (${baseName}, ${baseName}_2..${TEST_DB_LANE_COUNT})`
    : `${laneSet} (${baseName}_${laneSet}_1..${TEST_DB_LANE_COUNT})`;
}

/** Every lane database that does not exist, or exists with fewer migrations than the journal. */
async function lanesNotReady(baseUrl: string, laneSet: LaneSet, journalEntries: number): Promise<readonly number[]> {
  const maintenanceUrl = new URL(baseUrl);
  maintenanceUrl.pathname = `/${MAINTENANCE_DATABASE}`;
  const sql = postgres(maintenanceUrl.toString(), { max: 1, connect_timeout: CONNECT_TIMEOUT_SECONDS });
  let existing: ReadonlySet<string>;
  try {
    const rows = await sql<{ datname: string }[]>`SELECT datname FROM pg_database WHERE datistemplate = false`;
    existing = new Set(rows.map((row) => row.datname));
  } catch (cause) {
    throw new Error(
      `The test Postgres at ${maintenanceUrl.host} is not reachable, so no test lane can be prepared. Start it with \`npm run infra:up\`. (${String(cause)})`,
      { cause },
    );
  } finally {
    await sql.end();
  }

  const notReady: number[] = [];
  for (let lane = 1; lane <= TEST_DB_LANE_COUNT; lane += 1) {
    const url = testDatabaseUrlForLane(baseUrl, lane, laneSet);
    if (!existing.has(databaseNameFromUrl(url))) {
      notReady.push(lane);
      continue;
    }
    if (await laneIsBehind(url, journalEntries)) notReady.push(lane);
  }
  return notReady;
}

/** One lane's applied-migration count. A missing `drizzle.__drizzle_migrations` reads as zero. */
async function laneIsBehind(laneUrl: string, journalEntries: number): Promise<boolean> {
  const sql = postgres(laneUrl, { max: 1, connect_timeout: CONNECT_TIMEOUT_SECONDS });
  try {
    const rows = await sql<{ count: string }[]>`
      SELECT count(*)::text AS count
      FROM information_schema.tables
      WHERE table_schema = 'drizzle' AND table_name = '__drizzle_migrations'
    `;
    if (rows[0]?.count === "0") return true;
    const applied = await sql<{ count: string }[]>`SELECT count(*)::text AS count FROM drizzle.__drizzle_migrations`;
    return laneNeedsMigration(Number(applied[0]?.count ?? 0), journalEntries);
  } finally {
    await sql.end();
  }
}

export default async function setup(): Promise<void> {
  const baseUrl = process.env.TEST_DATABASE_URL ?? DEFAULT_TEST_DATABASE_URL;
  const laneSet = currentLaneSet();
  // Resolved once here so every forked worker inherits the answer instead of re-running git.
  process.env.__TEST_DB_LANE_SET_RESOLVED__ = laneSet ?? "";

  const journalEntries = journalEntryCount();
  const notReady = await lanesNotReady(baseUrl, laneSet, journalEntries);
  if (notReady.length === 0) return;

  console.log(
    `Test lane set ${describeSet(laneSet, databaseNameFromUrl(baseUrl))}: lane(s) ${notReady.join(", ")} missing or behind ${journalEntries} migrations. Running db:migrate:test.`,
  );
  execFileSync("npm", ["run", "db:migrate:test"], {
    stdio: "inherit",
    env: { ...process.env, TEST_DATABASE_URL: baseUrl, ...(laneSet === null ? {} : { TEST_DB_LANE_SET: laneSet }) },
  });
}
