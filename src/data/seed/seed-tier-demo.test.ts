import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { createTestDb, truncateAll, TEST_DATABASE_URL } from "@/db/test-db";
import { createMockStatsProvider } from "@/stats/mock/mock-stats-provider";
import { INTEGRITY_CONFIG } from "@/integrity/config";
import { completedSeasonsFor } from "@/league-service/participation";
import { participationTierFor } from "@/participation/tier";
import { seedPlayers } from "./seed-players";
import { seedTierDemoIdentities, TIER_DEMO_NEWCOMER_IDS, TIER_DEMO_VETERAN_ID } from "./seed-tier-demo";

const db = createTestDb();
const clock = { now: () => "2026-08-17T12:00:00.000Z" };

beforeEach(async () => {
  // `seedPlayers` refuses to run against a database it cannot prove is local (see `guard.ts`).
  vi.stubEnv("ALLOW_DESTRUCTIVE_SEED", "1");
  vi.stubEnv("DATABASE_URL", TEST_DATABASE_URL);
  await truncateAll(db);
  await seedPlayers(db, createMockStatsProvider());
});

afterAll(async () => {
  await truncateAll(db);
});

describe("seedTierDemoIdentities (Phase 3.5, Task 7.5)", () => {
  it("gives the veteran identity real completed seasons at or past the cutoff, by construction", async () => {
    const identities = await seedTierDemoIdentities(db, clock);
    expect(identities.veteran).toBe(TIER_DEMO_VETERAN_ID);

    const veteranSeasons = await completedSeasonsFor(db, TIER_DEMO_VETERAN_ID);
    expect(veteranSeasons).toBeGreaterThanOrEqual(INTEGRITY_CONFIG.participation.veteranSeasonCutoff);
    expect(participationTierFor(veteranSeasons, INTEGRITY_CONFIG.participation.veteranSeasonCutoff)).toBe("veteran");
  });

  it("leaves both newcomer identities at zero completed seasons — no league ever seats them", async () => {
    const identities = await seedTierDemoIdentities(db, clock);
    expect(identities.newcomers).toEqual(TIER_DEMO_NEWCOMER_IDS);

    for (const id of identities.newcomers) {
      const seasons = await completedSeasonsFor(db, id);
      expect(seasons).toBe(0);
      expect(participationTierFor(seasons, INTEGRITY_CONFIG.participation.veteranSeasonCutoff)).toBe("newcomer");
    }
  });

  it("is safe to run twice — the veteran's completed-season count never doubles", async () => {
    await seedTierDemoIdentities(db, clock);
    const before = await completedSeasonsFor(db, TIER_DEMO_VETERAN_ID);
    await seedTierDemoIdentities(db, clock);
    const after = await completedSeasonsFor(db, TIER_DEMO_VETERAN_ID);
    expect(after).toBe(before);
  });
});
