import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { and, eq } from "drizzle-orm";
import { createTestDb } from "@research-ts/db/test-db";
import { truncateAll } from "@/db/test-db";
import { drafts, leagues, teams, users } from "@/db/schema";
import { STANDARD_ROSTER_SLOTS } from "@research-ts/domain/roster";
import { DEV_SEED } from "./config";
import { seedDevLeagues } from "./seed-dev-leagues";

const db = createTestDb();
const clock = { now: () => "2026-09-01T00:00:00.000Z" };

beforeEach(async () => {
  await truncateAll(db);
});

afterAll(async () => {
  await truncateAll(db);
});

describe("seedDevLeagues", () => {
  it("creates a snake and an auction dev league, each with a full set of teams and a scheduled draft", async () => {
    const result = await seedDevLeagues(db, clock);
    expect(result).toEqual({ leagues: 2, teams: DEV_SEED.teamCount * 2, drafts: 2 });

    const [snake] = await db.select().from(leagues).where(eq(leagues.id, DEV_SEED.snake.leagueId));
    expect(snake?.format).toBe("snake");
    expect(snake?.rosterSlots).toHaveLength(STANDARD_ROSTER_SLOTS.length);

    expect(await db.select().from(teams).where(eq(teams.leagueId, DEV_SEED.snake.leagueId))).toHaveLength(DEV_SEED.teamCount);

    const [draft] = await db.select().from(drafts).where(eq(drafts.id, DEV_SEED.snake.draftId));
    expect(draft?.status).toBe("scheduled");
    // clock.now() + DEV_SEED.kickoffHoursFromNow (0h — the floor tier, live draft-night pace)
    expect(draft?.kickoffAt.toISOString()).toBe("2026-09-01T00:00:00.000Z");

    const [auctionDraft] = await db.select().from(drafts).where(eq(drafts.id, DEV_SEED.auction.draftId));
    expect(auctionDraft?.auctionBudget).toBe(DEV_SEED.auction.budget);
  });

  it("is idempotent — running it twice leaves exactly one of everything", async () => {
    await seedDevLeagues(db, clock);
    await seedDevLeagues(db, clock);
    expect(await db.select().from(leagues)).toHaveLength(2);
    expect(await db.select().from(teams)).toHaveLength(DEV_SEED.teamCount * 2);
    expect(await db.select().from(drafts)).toHaveLength(2);
  });

  it("hands the claimed user team 1 and the commissioner's chair in both leagues, when given one", async () => {
    // The claim id is a real (WorkOS) user id — its `users` row already exists from the
    // AuthKit callback by the time anyone would run the seed while signed in.
    await db.insert(users).values({ id: "workos_real_user", email: "real@test.local", displayName: "Real User" });

    const result = await seedDevLeagues(db, clock, "workos_real_user");
    expect(result).toEqual({ leagues: 2, teams: DEV_SEED.teamCount * 2, drafts: 2 });

    for (const plan of [DEV_SEED.snake, DEV_SEED.auction]) {
      const [league] = await db.select().from(leagues).where(eq(leagues.id, plan.leagueId));
      expect(league?.commissionerUserId).toBe("workos_real_user");
      const [team1] = await db
        .select()
        .from(teams)
        .where(and(eq(teams.leagueId, plan.leagueId), eq(teams.id, `${plan.leagueId}_team_01`)));
      expect(team1?.userId).toBe("workos_real_user");
    }
  });

  it("does not un-claim a founder's team or commissioner's chair on a re-seed without a claim id", async () => {
    await db.insert(users).values({ id: "workos_real_user", email: "real@test.local", displayName: "Real User" });
    await seedDevLeagues(db, clock, "workos_real_user");

    // Re-seed WITHOUT a claim id — e.g. a run where DEV_SEED_CLAIM_USER_ID isn't exported.
    // The previously claimed team and commissioner's chair must hold in both leagues.
    await seedDevLeagues(db, clock);

    for (const plan of [DEV_SEED.snake, DEV_SEED.auction]) {
      const [league] = await db.select().from(leagues).where(eq(leagues.id, plan.leagueId));
      expect(league?.commissionerUserId).toBe("workos_real_user");
      const [team1] = await db
        .select()
        .from(teams)
        .where(and(eq(teams.leagueId, plan.leagueId), eq(teams.id, `${plan.leagueId}_team_01`)));
      expect(team1?.userId).toBe("workos_real_user");
      // The rest of the roster is still refreshed to the (still-placeholder) dev owners.
      const [team2] = await db
        .select()
        .from(teams)
        .where(and(eq(teams.leagueId, plan.leagueId), eq(teams.id, `${plan.leagueId}_team_02`)));
      expect(team2?.userId).toBe(`${DEV_SEED.userIdPrefix}02`);
    }
  });

  it("is called with no ambient environment coupling — the claim id is undefined unless a caller passes one", async () => {
    // Regression guard: seedDevLeagues must never read `process.env` itself. A developer who
    // happens to have DEV_SEED_CLAIM_USER_ID exported locally (from running `npm run seed`
    // against their real dev database) must not have it silently affect this test — there is
    // no row for that id in the test database, so if this function read it directly the FK
    // constraint on `teams.user_id` would fail here instead of this asserting normal placeholder
    // ownership.
    process.env.DEV_SEED_CLAIM_USER_ID = "not_a_real_row_in_this_test_db";
    try {
      const result = await seedDevLeagues(db, clock);
      expect(result).toEqual({ leagues: 2, teams: DEV_SEED.teamCount * 2, drafts: 2 });
      const [snake] = await db.select().from(leagues).where(eq(leagues.id, DEV_SEED.snake.leagueId));
      expect(snake?.commissionerUserId).toBe(`${DEV_SEED.userIdPrefix}01`);
    } finally {
      delete process.env.DEV_SEED_CLAIM_USER_ID;
    }
  });
});
