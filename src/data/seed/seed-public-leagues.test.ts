import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, truncateAll } from "@/db/test-db";
import { drafts, leagues, teams } from "@/db/schema";
import { EMPTY_BROWSE_FILTER } from "@/matchmaking/filter";
import { listPublicLeagues } from "@/league-service/browse";
import { DEV_SEED } from "./config";
import { seedPublicLeagues } from "./seed-public-leagues";

const db = createTestDb();
const clock = { now: () => "2026-08-18T12:00:00.000Z" };

beforeEach(async () => {
  await truncateAll(db);
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
    const rows = await listPublicLeagues(db, EMPTY_BROWSE_FILTER);
    expect(new Set(rows.map((row) => row.format))).toEqual(new Set(["snake", "auction"]));
    expect(new Set(rows.map((row) => row.experienceTier))).toEqual(new Set(["beginner", "experienced"]));
    expect(new Set(rows.map((row) => row.stakeTier)).size).toBeGreaterThan(1);
  });

  it("seeds a full league too, and browse correctly refuses to list it", async () => {
    await seedPublicLeagues(db, clock);
    const full = DEV_SEED.publicLeagues.filter((plan) => plan.filled >= plan.teamCount);
    expect(full.length).toBeGreaterThan(0);
    const listed = new Set((await listPublicLeagues(db, EMPTY_BROWSE_FILTER)).map((row) => row.id));
    for (const plan of full) expect(listed.has(plan.leagueId)).toBe(false);
  });

  it("is safe to run twice: it updates rather than duplicating", async () => {
    await seedPublicLeagues(db, clock);
    const before = await db.select().from(teams);
    await seedPublicLeagues(db, clock);
    expect(await db.select().from(teams)).toHaveLength(before.length);
    expect(await db.select().from(leagues)).toHaveLength(DEV_SEED.publicLeagues.length);
  });

  it("uses no em-dash in any league name a person will read", async () => {
    for (const plan of DEV_SEED.publicLeagues) expect(plan.name).not.toContain("—");
  });
});
