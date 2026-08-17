import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import { createTestDb, truncateAll } from "@/db/test-db";
import { createMockStatsProvider } from "@/stats/mock/mock-stats-provider";
import { PLAYER_COUNT, SEASON_WEEKS } from "@/stats/mock/generate-dataset";
import { seedPlayers } from "./seed-players";

const db = createTestDb();
const provider = createMockStatsProvider();

beforeEach(async () => { await truncateAll(db); });
afterAll(async () => { await truncateAll(db); });

async function countOf(table: string): Promise<number> {
  const rows = (await db.execute(sql.raw(`select count(*)::int as n from ${table}`))) as unknown as { n: number }[];
  return rows[0]!.n;
}

describe("seedPlayers", () => {
  it("loads every player and every stat line", async () => {
    const result = await seedPlayers(db, provider);
    expect(result).toEqual({ players: PLAYER_COUNT, statLines: PLAYER_COUNT * SEASON_WEEKS });
    expect(await countOf("players")).toBe(PLAYER_COUNT);
    expect(await countOf("player_stat_lines")).toBe(PLAYER_COUNT * SEASON_WEEKS);
  }, 30_000);

  it("is idempotent — running twice does not duplicate rows", async () => {
    await seedPlayers(db, provider);
    await seedPlayers(db, provider);
    expect(await countOf("players")).toBe(PLAYER_COUNT);
    expect(await countOf("player_stat_lines")).toBe(PLAYER_COUNT * SEASON_WEEKS);
  }, 30_000);
});
