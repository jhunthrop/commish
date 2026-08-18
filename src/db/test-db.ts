import { sql } from "drizzle-orm";
import { afterAll } from "vitest";
import { createDb, type Db } from "./client";
import { DB_POOL_CONFIG } from "./config";

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgres://commish:commish@localhost:5433/commish_test";

/**
 * Connects to the dedicated test database (docker-compose `postgres-test`, tmpfs-backed).
 * Every table is truncated between tests so each test starts from a clean state.
 *
 * Test-only module (it imports `vitest`): registers its own `afterAll` to close the
 * connection pool it opens, so callers don't each need to remember to. A small pool plus a
 * short idle timeout (`DB_POOL_CONFIG.test*`) keeps ~40 test files' worth of simultaneous
 * pools from starving the shared test Postgres of connections.
 */
export function createTestDb(): Db {
  const db = createDb(TEST_DATABASE_URL, {
    max: DB_POOL_CONFIG.testMaxConnections,
    idleTimeoutSeconds: DB_POOL_CONFIG.testIdleTimeoutSeconds,
  });
  afterAll(async () => {
    await db.$client.end();
  });
  return db;
}

export async function truncateAll(db: Db): Promise<void> {
  await db.execute(sql`
    TRUNCATE TABLE
      player_stat_lines, players,
      matchups, weeks, draft_picks, draft_nudges, draft_actions, drafts, roster_slots,
      scoring_settings, teams, leagues, users
    RESTART IDENTITY CASCADE
  `);
}
