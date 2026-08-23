import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb, TEST_DATABASE_URL, truncateAll } from "@/db/test-db";
import { auditEvents, leagues, teams } from "@/db/schema";
import { HOUSE_CATALOG } from "@/matchmaking/house-catalog";
import { seedHouseCatalogDemo } from "./index";

const db = createTestDb();
const clock = { now: () => "2026-08-22T12:00:00.000Z" };
const FILLER_COUNT = HOUSE_CATALOG.rungs.open_12.teamCount;

beforeEach(async () => {
  vi.stubEnv("ALLOW_DESTRUCTIVE_SEED", "1");
  vi.stubEnv("DATABASE_URL", TEST_DATABASE_URL);
  await truncateAll(db);
});

afterAll(async () => {
  await truncateAll(db);
});

/**
 * Phase 3.5 addendum, Task 15, Step 1: proves the house arc runs through the REAL reconciler and
 * the REAL join transaction, never a hand-stamped row — the same "real service, real receipt"
 * standard `seed-format-demos.test.ts` already holds its own arcs to.
 */
describe("seedHouseCatalogDemo", () => {
  it("stocks the shelf, fills the oldest open_12 league through the real join, and opens a real replacement", async () => {
    const result = await seedHouseCatalogDemo(db, clock);

    expect(result.rung).toBe("open_12");
    expect(result.seatsJoined).toBe(FILLER_COUNT);
    expect(result.replacementOpened).toHaveLength(1);
    expect(result.replacementOpened[0]).not.toBe(result.filledLeagueId);

    // The filled league really has every seat — a real row per team, not a count this function
    // merely claims.
    const filledSeats = await db.select().from(teams).where(eq(teams.leagueId, result.filledLeagueId));
    expect(filledSeats).toHaveLength(FILLER_COUNT);
    expect(new Set(filledSeats.map((seat) => seat.userId)).size).toBe(FILLER_COUNT);

    // `writeLeagueInTx`'s own `league_created` event, on the REPLACEMENT's own chain — the one
    // audit event `seedPublicLeagues`/`seedDevLeagues` never produce for their upserted leagues
    // (this file's own docblock), proving this arc went through `createLeague`, never an upsert.
    // `spawnHouseLeagueInTx` writes it PLUS its own `house_league_opened` `system_action` right
    // behind it, both on the same chain.
    const replacementEvents = await db.select().from(auditEvents).where(eq(auditEvents.leagueId, result.replacementOpened[0]!));
    const eventTypes = replacementEvents.map((event) => event.eventType);
    expect(eventTypes).toContain("league_created");
    const systemActions = replacementEvents
      .filter((event) => event.eventType === "system_action")
      .map((event) => (event.payload as { action?: string }).action);
    expect(systemActions).toContain("house_league_opened");

    // The replacement is a real, distinct `open_12` league, not the same row counted twice.
    const [replacement] = await db.select().from(leagues).where(eq(leagues.id, result.replacementOpened[0]!));
    expect(replacement?.houseRung).toBe("open_12");
  });

  it("is safe to run twice — the same league stays targeted, no duplicate seats, no second replacement", async () => {
    const first = await seedHouseCatalogDemo(db, clock);
    const second = await seedHouseCatalogDemo(db, clock);

    // A re-run's own joins all land on `alreadyMember`, and the shelf is already back at
    // `openAtOnce` width — nothing new to seat, nothing new to open.
    expect(second.filledLeagueId).toBe(first.filledLeagueId);
    expect(second.seatsJoined).toBe(0);
    expect(second.replacementOpened).toHaveLength(0);

    const filledSeats = await db.select().from(teams).where(eq(teams.leagueId, first.filledLeagueId));
    expect(filledSeats).toHaveLength(FILLER_COUNT);

    // Exactly one replacement exists across BOTH runs, never a second one stamped for a shelf
    // that was already whole.
    const openLeagues = await db.select().from(leagues).where(eq(leagues.houseRung, "open_12"));
    expect(openLeagues).toHaveLength(HOUSE_CATALOG.rungs.open_12.openAtOnce + 1);
  });

  it("refuses to run in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    await expect(seedHouseCatalogDemo(db, clock)).rejects.toThrow(/must never run in production/);
    vi.stubEnv("NODE_ENV", "test");
  });
});
