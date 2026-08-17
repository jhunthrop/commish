import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, truncateAll } from "@/db/test-db";
import { drafts, leagues, teams } from "@/db/schema";
import { STANDARD_ROSTER_SLOTS } from "@/domain/roster";
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
    expect(draft?.kickoffAt.toISOString()).toBe("2026-09-02T02:00:00.000Z"); // clock.now() + 26h

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
});
