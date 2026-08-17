import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { asc, eq } from "drizzle-orm";
import { createTestDb, truncateAll } from "@/db/test-db";
import { draftPicks, drafts, players, rosterSlots } from "@/db/schema";
import { createDraftStore } from "./store";
import { seedDraftFixture, SPRINT_ROSTER_SLOTS } from "./test-support";

const db = createTestDb();
const clock = { now: () => "2026-09-01T00:00:00.000Z" };
const publish = async () => "1-0";
// Rebuilt per test: the store caches materialized state, and truncating the tables between
// tests would otherwise leave a stale cache pointing at a draft id that no longer exists.
let store = createDraftStore({ db, publish, clock });

/** One player per position per team slot, so a 2-team sprint draft always fills. */
const POOL_ROWS = [
  { id: "qb1", name: "QB One", position: "QB" as const, nflTeam: "KC" },
  { id: "qb2", name: "QB Two", position: "QB" as const, nflTeam: "SF" },
  { id: "rb1", name: "RB One", position: "RB" as const, nflTeam: "KC" },
  { id: "rb2", name: "RB Two", position: "RB" as const, nflTeam: "SF" },
  { id: "wr1", name: "WR One", position: "WR" as const, nflTeam: "KC" },
  { id: "wr2", name: "WR Two", position: "WR" as const, nflTeam: "SF" },
];

async function fixture(format: "snake" | "auction") {
  const f = await seedDraftFixture(db, {
    draftId: `draft_${format}`,
    leagueId: `league_${format}`,
    format,
    teamCount: 2,
    slotConfig: SPRINT_ROSTER_SLOTS,
    kickoffAt: new Date("2026-09-10T17:00:00.000Z"),
    auctionBudget: format === "auction" ? 50 : null,
  });
  await db.insert(players).values(POOL_ROWS);
  return f;
}

/** Runs the draft to completion on the clock alone. */
async function runOnTheClock(draftId: string): Promise<void> {
  for (let i = 0; i < 100; i++) {
    const state = await store.getDraftState(draftId);
    if (state === null || state.phase === "complete") return;
    const result = await store.applyAction(draftId, { v: 1, type: "TIMER_EXPIRE", timestamp: clock.now() });
    if (!result.ok) throw new Error(result.reason);
  }
  throw new Error("draft did not finish");
}

beforeEach(async () => {
  await truncateAll(db);
  store = createDraftStore({ db, publish, clock });
});

afterAll(async () => {
  await truncateAll(db);
});

describe("startDraft", () => {
  it("opens the draft with a full ranked pool and every team in the order, and marks the row in progress", async () => {
    const { draftId, teamIds } = await fixture("snake");
    const result = await store.startDraft(draftId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect([...result.state.draftOrder].sort()).toEqual([...teamIds].sort());
    expect(result.state.pool).toHaveLength(POOL_ROWS.length);
    expect(result.state.phase).toBe("in_progress");
    const [row] = await db.select().from(drafts).where(eq(drafts.id, draftId));
    expect(row?.status).toBe("in_progress");
  });

  it("refuses to start the same draft twice", async () => {
    const { draftId } = await fixture("snake");
    await store.startDraft(draftId);
    expect(await store.startDraft(draftId)).toEqual({ ok: false, reason: "This draft has already started." });
  });

  it("refuses to start a draft that doesn't exist", async () => {
    expect(await store.startDraft("nope")).toEqual({ ok: false, reason: "That draft doesn't exist." });
  });
});

describe("commitDraftResults — snake", () => {
  it("writes every pick and fills every roster slot when the draft completes", async () => {
    const { draftId, teamIds } = await fixture("snake");
    await store.startDraft(draftId);
    await runOnTheClock(draftId);

    const picks = await db.select().from(draftPicks).where(eq(draftPicks.draftId, draftId)).orderBy(asc(draftPicks.pickNumber));
    expect(picks).toHaveLength(6);
    expect(picks.map((p) => p.pickNumber)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(new Set(picks.map((p) => p.playerId)).size).toBe(6);
    expect(picks.every((p) => p.price === null)).toBe(true);

    for (const teamId of teamIds) {
      const slots = await db.select().from(rosterSlots).where(eq(rosterSlots.teamId, teamId));
      expect(slots).toHaveLength(3);
      expect([...slots.map((s) => s.slot)].sort()).toEqual(["QB", "RB", "WR"]);
      expect(slots.every((s) => s.playerId !== null)).toBe(true);
    }

    const [row] = await db.select().from(drafts).where(eq(drafts.id, draftId));
    expect(row?.status).toBe("complete");
  });

  it("is idempotent — committing an already-committed draft changes nothing", async () => {
    const { draftId } = await fixture("snake");
    await store.startDraft(draftId);
    await runOnTheClock(draftId);
    const again = await store.commitDraftResults(draftId);
    expect(again).toEqual({ ok: true, picks: 6, teams: 2, alreadyCommitted: true });
    expect(await db.select().from(draftPicks).where(eq(draftPicks.draftId, draftId))).toHaveLength(6);
  });

  it("refuses to commit a draft that hasn't finished", async () => {
    const { draftId } = await fixture("snake");
    await store.startDraft(draftId);
    expect(await store.commitDraftResults(draftId)).toEqual({ ok: false, reason: "This draft isn't finished yet." });
  });
});

describe("commitDraftResults — auction", () => {
  it("persists auction rosters through the same seam, carrying the winning price", async () => {
    const { draftId, teamIds } = await fixture("auction");
    await store.startDraft(draftId);
    await runOnTheClock(draftId);

    const picks = await db.select().from(draftPicks).where(eq(draftPicks.draftId, draftId));
    expect(picks).toHaveLength(6);
    // Every unchallenged auto-nomination clears at the $1 minimum.
    expect(picks.every((p) => p.price === 1)).toBe(true);
    for (const teamId of teamIds) {
      expect(await db.select().from(rosterSlots).where(eq(rosterSlots.teamId, teamId))).toHaveLength(3);
    }
    const [row] = await db.select().from(drafts).where(eq(drafts.id, draftId));
    expect(row?.status).toBe("complete");
  });
});
