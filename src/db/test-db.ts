import { sql } from "drizzle-orm";
import { createDb, type Db } from "./client";

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgres://commish:commish@localhost:5433/commish_test";

/**
 * Connects to the dedicated test database (docker-compose `postgres-test`, tmpfs-backed).
 * Every table is truncated between tests so each test starts from a clean state.
 */
export function createTestDb(): Db {
  return createDb(TEST_DATABASE_URL);
}

export async function truncateAll(db: Db): Promise<void> {
  await db.execute(sql`
    TRUNCATE TABLE
      matchups, weeks, draft_picks, draft_actions, drafts, roster_slots,
      scoring_settings, teams, leagues, sessions, users
    RESTART IDENTITY CASCADE
  `);
}
