import { asc, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb, TEST_DATABASE_URL } from "@research-ts/db/test-db";
import { truncateAll } from "@/db/test-db";
import { auditEvents, drafts, leagues, teams } from "@/db/schema";
import { ensureHouseCatalog } from "@/league-service/house-factory";
import { HOUSE_CATALOG } from "@/matchmaking/house-catalog";
import { SAFE_HOUSE_FILL_KICKOFF_MARGIN_MS } from "./house-fill-safety";
import { seedHouseCatalogDemo } from "./index";

const db = createTestDb();
const clock = { now: () => "2026-08-22T12:00:00.000Z" };
const FILLER_COUNT = HOUSE_CATALOG.rungs.open_12.teamCount;

/** Rewrites `leagueId`'s own draft to a kickoff `msFromNow` past `clock.now()` — TEST SETUP only,
 *  simulating the "long-lived shared dev database" staleness fix round 1 (F1) found for real; a
 *  production caller has no such write path against a house league (`./house-fill-safety.ts`'s
 *  own docblock). */
async function setKickoffOffset(leagueId: string, msFromNow: number): Promise<void> {
  const kickoffAt = new Date(Date.parse(clock.now()) + msFromNow);
  await db.update(drafts).set({ kickoffAt }).where(eq(drafts.leagueId, leagueId));
}

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

    // A re-run's own shortfall reads back `0` for the already-fully-seated target — the join
    // loop never executes at all (fix round 1, F2: NOT `alreadyMember`, since no join is ever
    // attempted), and the shelf is already back at `openAtOnce` width, so nothing new opens either.
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

  /**
   * Fix round 1, F1's aging-class hazard, still real for a `'when_full'` house league even though
   * the SHAPE of the fix changed (founder directive 2026-08-26): `open_12`'s own shelf width
   * dropped to `1`, so a stale sole candidate has no sibling to fall back to any more — the old
   * "skip to the next-earliest safe one" outcome cannot happen on a shelf this narrow. What the
   * guard still does: refuse to fill the one candidate it has rather than risk
   * `autoStartDueDrafts` claiming its draft mid-fill, because the placeholder `kickoffFor` wrote
   * at spawn time (`@/league-service/house-factory.ts`) can age toward "now" on a long-idle league
   * exactly the way a `'scheduled'` kickoff used to.
   */
  it("refuses to fill the sole open_12 league once its placeholder kickoff has aged past the safety margin", async () => {
    // Stock the shelf directly (never `seedHouseCatalogDemo` itself yet — this test needs to
    // stamp staleness onto the league BEFORE any fill is attempted against it).
    await ensureHouseCatalog(db, { clock, newId: () => crypto.randomUUID() });
    const [only] = await db.select({ id: leagues.id }).from(leagues).where(eq(leagues.houseRung, "open_12")).orderBy(asc(leagues.createdAt)).limit(1);
    // One millisecond short of the safety margin — deliberately at the boundary, not comfortably
    // past it, so this proves the guard's own `>=` rather than a generously-stale fixture that
    // would pass even a looser check.
    await setKickoffOffset(only!.id, SAFE_HOUSE_FILL_KICKOFF_MARGIN_MS - 1);

    await expect(seedHouseCatalogDemo(db, clock)).rejects.toThrow(/stale shelf, not a flake/);
    const seats = await db.select().from(teams).where(eq(teams.leagueId, only!.id));
    expect(seats).toHaveLength(0);
  });

  /**
   * FINAL WHOLE-BRANCH REVIEW, F2's self-heal was for a `'scheduled'`-trigger house league:
   * `houseKickoffStillAhead` retired a stale one from the reconciler's own count, so the very next
   * `ensureHouseCatalog` pass saw a shortfall and opened a fresh edition in its place. Founder
   * directive 2026-08-26 makes `open_12` `'when_full'`, and `houseKickoffStillAhead` reads
   * UNCONDITIONALLY true for a `'when_full'` draft (its first `OR` branch,
   * `@/league-service/house-factory.ts`) — staling its placeholder kickoff by hand no longer
   * makes the reconciler see any shortfall at all, so it never restocks. This documents that
   * directly: the old self-heal does not happen for a house league any more, and the arc throws
   * rather than silently drafting from a fresh edition nobody asked it to open.
   */
  it("does not self-heal any more — a stale when_full placeholder never triggers a restock, so the arc throws", async () => {
    await ensureHouseCatalog(db, { clock, newId: () => crypto.randomUUID() });
    const [only] = await db.select({ id: leagues.id }).from(leagues).where(eq(leagues.houseRung, "open_12"));
    await setKickoffOffset(only!.id, -60_000); // one minute PAST kickoff — as stale as it gets.

    await expect(seedHouseCatalogDemo(db, clock)).rejects.toThrow(/stale shelf, not a flake/);

    // No restock happened — the shelf still shows exactly the one (stale) league it started with.
    const openLeagues = await db.select().from(leagues).where(eq(leagues.houseRung, "open_12"));
    expect(openLeagues).toHaveLength(1);
    const seats = await db.select().from(teams).where(eq(teams.leagueId, only!.id));
    expect(seats).toHaveLength(0);
  });

  // Retargeted (founder directive 2026-08-26): a stale `when_full` placeholder never makes
  // `ensureHouseCatalog` see a shortfall (the test directly above), so the restock this test used
  // to force into failing via a colliding `newId` is never even attempted any more — the loud
  // throw below is reached the same way the two tests above reach it. Kept anyway: it still pins
  // the exact error message and proves the collision is harmless rather than a second failure
  // mode, which is worth knowing even though it no longer changes which branch fires.
  it("throws the same named, loud error even when a colliding newId would also break any restock attempt", async () => {
    await ensureHouseCatalog(db, { clock, newId: () => crypto.randomUUID() });
    const openLeagues = await db.select({ id: leagues.id }).from(leagues).where(eq(leagues.houseRung, "open_12"));
    for (const league of openLeagues) {
      await setKickoffOffset(league.id, -60_000);
    }
    const [taken] = await db.select({ id: drafts.id }).from(drafts).where(eq(drafts.leagueId, openLeagues[0]!.id));

    await expect(seedHouseCatalogDemo(db, clock, { newId: () => taken!.id })).rejects.toThrow(/stale shelf, not a flake/);

    // The loud failure left every candidate exactly as it found it — no partial, racy fill.
    for (const league of openLeagues) {
      const seats = await db.select().from(teams).where(eq(teams.leagueId, league.id));
      expect(seats).toHaveLength(0);
    }
  });
});
