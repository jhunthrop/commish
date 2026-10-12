import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, TEST_DATABASE_URL } from "@research/db/test-db";
import { truncateAll } from "@/db/test-db";
import { drafts, leagues, teams } from "@/db/schema";
import { EMPTY_BROWSE_FILTER } from "@/matchmaking/filter";
import { INTEGRITY_CONFIG } from "@/integrity/config";
import { listPublicLeagues } from "@/league-service/browse";
import { completedSeasonsFor } from "@/league-service/participation";
import { createMockStatsProvider } from "@/stats/mock/mock-stats-provider";
import { DEV_SEED } from "./config";
import { ensureDevUsers } from "./dev-users";
import { seedPlayers } from "./seed-players";
import { seedPublicLeagues } from "./seed-public-leagues";
import { TIER_DEMO_NEWCOMER_IDS, TIER_DEMO_VETERAN_ID } from "./seed-tier-demo";

const db = createTestDb();
const clock = { now: () => "2026-08-18T12:00:00.000Z" };

beforeEach(async () => {
  // Task 7.5: `seedPublicLeagues` now plays through `seedTierDemoIdentities`'s own three real
  // season leagues (`seedSeasonLeague`), which — like `seed-season-league.test.ts`'s own
  // `beforeEach` — needs the player pool seeded first, and `seedPlayers` refuses to run against
  // a database it cannot prove is local (see `guard.ts`).
  vi.stubEnv("ALLOW_DESTRUCTIVE_SEED", "1");
  vi.stubEnv("DATABASE_URL", TEST_DATABASE_URL);
  await truncateAll(db);
  await seedPlayers(db, createMockStatsProvider());
});

afterEach(() => {
  vi.unstubAllEnvs();
});

afterAll(async () => {
  await truncateAll(db);
});

describe("seedPublicLeagues", () => {
  it("seeds every planned league with a scheduled draft and the fill level it advertises", async () => {
    const counts = await seedPublicLeagues(db, clock);
    expect(counts.leagues).toBe(DEV_SEED.publicLeagues.length);

    for (const plan of DEV_SEED.publicLeagues) {
      const [league] = await db.select().from(leagues).where(eq(leagues.id, plan.leagueId));
      expect(league).toMatchObject({
        name: plan.name,
        format: plan.format,
        teamCount: plan.teamCount,
        stakeTier: plan.stakeTier,
        experienceTier: plan.experienceTier,
        isPublicMatchmade: true,
      });
      const [draft] = await db.select().from(drafts).where(eq(drafts.leagueId, plan.leagueId));
      expect(draft?.status).toBe("scheduled");
      expect(await db.select().from(teams).where(eq(teams.leagueId, plan.leagueId))).toHaveLength(plan.filled);
    }
  });

  it("covers both formats, both experience tiers and more than one stake tier, so every filter narrows something", async () => {
    await seedPublicLeagues(db, clock);
    const { leagues: rows } = await listPublicLeagues(db, EMPTY_BROWSE_FILTER);
    expect(new Set(rows.map((row) => row.format))).toEqual(new Set(["snake", "auction"]));
    expect(new Set(rows.map((row) => row.experienceTier))).toEqual(new Set(["beginner", "experienced"]));
    expect(new Set(rows.map((row) => row.stakeTier)).size).toBeGreaterThan(1);
  });

  it("seeds a full league too, and browse correctly refuses to list it", async () => {
    await seedPublicLeagues(db, clock);
    const full = DEV_SEED.publicLeagues.filter((plan) => plan.filled >= plan.teamCount);
    expect(full.length).toBeGreaterThan(0);
    const listed = new Set((await listPublicLeagues(db, EMPTY_BROWSE_FILTER)).leagues.map((row) => row.id));
    for (const plan of full) expect(listed.has(plan.leagueId)).toBe(false);
  });

  it("is safe to run twice: it updates rather than duplicating", async () => {
    await seedPublicLeagues(db, clock);
    const before = await db.select().from(teams);
    await seedPublicLeagues(db, clock);
    expect(await db.select().from(teams)).toHaveLength(before.length);
    // `DEV_SEED.publicLeagues` plus `seedTierDemoIdentities`'s own three dedicated, real season
    // leagues (Phase 3.5, Task 7.5) — `seedPublicLeagues` seeds both, and both must stay
    // idempotent in the row-count sense on a re-run.
    expect(await db.select().from(leagues)).toHaveLength(DEV_SEED.publicLeagues.length + 3);
  });

  it("uses no em-dash in any league name a person will read", async () => {
    for (const plan of DEV_SEED.publicLeagues) expect(plan.name).not.toContain("—");
  });

  it("never seats a shared-pool identity in the tier-demo league (Phase 3.5, Task 7.5)", async () => {
    await seedPublicLeagues(db, clock);
    const ownerIds = await ensureDevUsers(db);

    const plan = DEV_SEED.publicLeagues.find((p) => p.leagueId === "dev_public_tier_demo")!;
    const teamRows = await db.select().from(teams).where(eq(teams.leagueId, plan.leagueId));
    expect(teamRows).toHaveLength(plan.filled);
    // Not index 0 (never has been — that's the seed's own veteran identity, the one this league
    // exists to refuse) AND not any OTHER member of the shared 12-identity pool either: every
    // seat here is one of `seedTierDemoIdentities`'s own dedicated ids, immune to the pool's own
    // completed-season drift (`seed-tier-demo.ts`'s own docblock).
    const poolIds = new Set(ownerIds);
    expect(teamRows.some((row) => poolIds.has(row.userId))).toBe(false);

    // Every OTHER seeded public league still starts at index 0 — this is the ONE exception.
    for (const other of DEV_SEED.publicLeagues) {
      if (other.leagueId === plan.leagueId) continue;
      const rows = await db.select().from(teams).where(eq(teams.leagueId, other.leagueId));
      if (rows.length > 0) expect(rows.some((row) => row.userId === ownerIds[0])).toBe(true);
    }
  });

  it("seats the tier-demo league with two dedicated newcomers and one dedicated veteran, by construction (Phase 3.5, Task 7.5)", async () => {
    await seedPublicLeagues(db, clock);
    const plan = DEV_SEED.publicLeagues.find((p) => p.leagueId === "dev_public_tier_demo")!;
    const teamRows = await db.select().from(teams).where(eq(teams.leagueId, plan.leagueId));
    const seatedIds = new Set(teamRows.map((row) => row.userId));
    expect(seatedIds).toEqual(new Set([...TIER_DEMO_NEWCOMER_IDS, TIER_DEMO_VETERAN_ID]));

    const newcomerSeasons = await Promise.all(TIER_DEMO_NEWCOMER_IDS.map((id) => completedSeasonsFor(db, id)));
    for (const seasons of newcomerSeasons) expect(seasons).toBe(0);

    const veteranSeasons = await completedSeasonsFor(db, TIER_DEMO_VETERAN_ID);
    expect(veteranSeasons).toBeGreaterThanOrEqual(INTEGRITY_CONFIG.participation.veteranSeasonCutoff);
  });
});
