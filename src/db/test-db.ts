import { sql } from "drizzle-orm";
import { afterAll } from "vitest";
import { resetRankedPlayersCacheForTests } from "@/draft-service/pool";
import { createDb, type Db } from "./client";
import { DB_POOL_CONFIG } from "./config";

export const TEST_DATABASE_URL =
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
      chat_reactions, chat_messages,
      player_stat_lines, players,
      matchups, weeks, draft_picks, draft_nudges, draft_actions, drafts,
      lineup_slots, roster_slots, league_invites,
      scoring_settings, teams, leagues, users
    RESTART IDENTITY CASCADE
  `);
  // `rankedPlayers` (src/draft-service/pool.ts) memoizes per league id across calls — safe in
  // production (the player/stat-line universe is fixed), but a test suite reuses league ids
  // across `it` blocks under a fresh seed each time. Without this, a cache entry built before
  // this truncate would outlive the data it was computed from.
  resetRankedPlayersCacheForTests();
}
