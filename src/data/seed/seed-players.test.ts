import { describe, it, expect, afterEach, beforeEach, afterAll, vi } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { createTestDb, truncateAll, TEST_DATABASE_URL } from "@/db/test-db";
import { playerStatLines } from "@/db/schema";
import { createMockStatsProvider } from "@/stats/mock/mock-stats-provider";
import { PLAYER_COUNT, SEASON_WEEKS } from "@/stats/mock/generate-dataset";
import type { StatsProvider } from "@/stats/provider";
import { seedPlayers } from "./seed-players";

const db = createTestDb();
const provider = createMockStatsProvider();

// `seedPlayers` refuses to run against a database it cannot prove is local (see `guard.ts`).
// The test database IS local, so say so explicitly rather than letting the guard fail open.
beforeEach(() => {
  vi.stubEnv("ALLOW_DESTRUCTIVE_SEED", "1");
  vi.stubEnv("DATABASE_URL", TEST_DATABASE_URL);
});
afterEach(() => { vi.unstubAllEnvs(); });

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

  it("re-seeding with a revised stat line upserts it instead of leaving the stale row", async () => {
    await seedPlayers(db, provider);

    const week1Lines = await provider.getWeeklyStatLines(1);
    const target = week1Lines[0]!;
    const revisedPassingYards = target.passingYards + 100;

    // Delegates to the mock provider and maps only the one targeted line — immutable,
    // never mutates a line returned by the underlying provider.
    const revisedProvider: StatsProvider = {
      listPlayers: () => provider.listPlayers(),
      getWeeklyStatLines: async (week) => {
        const lines = await provider.getWeeklyStatLines(week);
        if (week !== 1) return lines;
        return lines.map((line) =>
          line.playerId === target.playerId ? { ...line, passingYards: revisedPassingYards } : line,
        );
      },
    };

    await seedPlayers(db, revisedProvider);

    const [row] = await db
      .select({ passingYards: playerStatLines.passingYards })
      .from(playerStatLines)
      .where(and(eq(playerStatLines.playerId, target.playerId), eq(playerStatLines.week, 1)));
    expect(row?.passingYards).toBe(revisedPassingYards);
    expect(await countOf("player_stat_lines")).toBe(PLAYER_COUNT * SEASON_WEEKS);
  }, 30_000);
});
