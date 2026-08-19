import { describe, it, expect, afterEach, beforeEach, afterAll, vi } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { createTestDb, truncateAll, TEST_DATABASE_URL } from "@/db/test-db";
import { playerStatLines } from "@/db/schema";
import { createMockStatsProvider } from "@/stats/mock/mock-stats-provider";
import { PLAYER_COUNT, SEASON_WEEKS } from "@/stats/mock/generate-dataset";
import type { StatsProvider } from "@/stats/provider";
import { STATS_INGESTION_CONFIG } from "@/stats-pipeline/config";
import type { ReferenceCache } from "@/stats-pipeline/reference-cache";
import { seedPlayers } from "./seed-players";

const db = createTestDb();
const provider = createMockStatsProvider();

/** A recording stand-in for the injected reference cache, so a test can assert exactly what was invalidated. */
function recordingReferenceCache(): Pick<ReferenceCache, "invalidatePlayers"> & { invalidatePlayers: ReturnType<typeof vi.fn> } {
  return { invalidatePlayers: vi.fn(async () => {}) };
}

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
    // never mutates a line returned by the underlying provider. The revision rides on the
    // per-GAME read, which is what `seedPlayers` walks a week with.
    const revisedProvider: StatsProvider = {
      lastWeekOfSeason: provider.lastWeekOfSeason,
      listPlayers: () => provider.listPlayers(),
      listGames: (week) => provider.listGames(week),
      getGameStatLines: async (game) => {
        const lines = await provider.getGameStatLines(game);
        if (game.week !== 1) return lines;
        return lines.map((line) =>
          line.playerId === target.playerId ? { ...line, passingYards: revisedPassingYards } : line,
        );
      },
      getWeeklyStatLines: (week) => provider.getWeeklyStatLines(week),
    };

    await seedPlayers(db, revisedProvider);

    const [row] = await db
      .select({ passingYards: playerStatLines.passingYards })
      .from(playerStatLines)
      .where(and(eq(playerStatLines.playerId, target.playerId), eq(playerStatLines.week, 1)));
    expect(row?.passingYards).toBe(revisedPassingYards);
    expect(await countOf("player_stat_lines")).toBe(PLAYER_COUNT * SEASON_WEEKS);
  }, 30_000);

  it("invalidates the player index after a successful seed", async () => {
    const cache = recordingReferenceCache();
    await seedPlayers(db, provider, cache);
    expect(cache.invalidatePlayers).toHaveBeenCalledTimes(1);
  }, 30_000);

  it("reserves every upstream call it makes against the backfill ledger, at the count that call costs", async () => {
    // `reservedForBackfill` was only ever a reduction of the ingestion ceiling: the largest
    // spender in the repo reserved nothing at all, so the month's real total could exceed the
    // quota by the whole cost of a backfill. Each reservation here is an exact number, never a
    // worst case — the week's schedule is listed first precisely so its box-score count is known.
    const reserved: number[] = [];
    const budget = { reserveBackfill: vi.fn(async (count: number) => { reserved.push(count); return { granted: true as const }; }) };

    await seedPlayers(db, provider, undefined, budget);

    // 2 for listPlayers, then per week 1 for the schedule and one per game, then the 1 that
    // discovers the season is over.
    expect(reserved[0]).toBe(2);
    const gamesInWeekOne = (await provider.listGames(1)).length;
    expect(reserved[1]).toBe(1);
    expect(reserved[2]).toBe(gamesInWeekOne);
    expect(reserved.reduce((total, count) => total + count, 0)).toBeLessThanOrEqual(
      STATS_INGESTION_CONFIG.reservedForBackfill,
    );
  }, 30_000);

  it("stops the whole backfill rather than seeding half a season when the ledger denies it", async () => {
    const budget = { reserveBackfill: async () => ({ granted: false as const, denial: "budget-exhausted" as const }) };
    await expect(seedPlayers(db, provider, undefined, budget)).rejects.toThrow(/STATS_MONTHLY_REQUEST_BUDGET/);
    expect(await countOf("players")).toBe(0);
  });

  it("does not invalidate the player index when the local-target guard refuses to run", async () => {
    // The guard throws before a single row is written — the earliest reachable failure this
    // function has. `beforeEach` above opts in for every other test; this one opts back out.
    vi.stubEnv("ALLOW_DESTRUCTIVE_SEED", "0");
    const cache = recordingReferenceCache();
    await expect(seedPlayers(db, provider, cache)).rejects.toThrow(/Refusing to seed/);
    expect(cache.invalidatePlayers).not.toHaveBeenCalled();
  });
});
