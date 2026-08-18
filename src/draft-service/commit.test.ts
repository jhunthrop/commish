import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { asc, eq } from "drizzle-orm";
import { createTestDb, truncateAll } from "@/db/test-db";
import { draftActions, draftPicks, drafts, matchups, players, rosterSlots, weeks } from "@/db/schema";
import type { DraftAction, DraftPoolEntry } from "@/domain/draft";
import { DRAFT_CLOCK_SCHEDULE, currentDeadline, initialDraftState, reduceDraft, type DraftConfig } from "@/draft-engine";
import { LEAGUE_CONFIG } from "@/league";
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
    // The reducer now rejects an expiry before the deadline it actually set — advance to
    // that deadline (rather than the fixed test clock, which would only clear the first
    // turn) instead of reasoning about tier math here.
    const result = await store.applyAction(draftId, {
      v: 1, type: "TIMER_EXPIRE", timestamp: currentDeadline(state) ?? clock.now(),
    });
    if (!result.ok) throw new Error(result.reason);
  }
  throw new Error("draft did not finish");
}

const SPRINT_POOL: readonly DraftPoolEntry[] = POOL_ROWS.map((p) => ({ playerId: p.id, position: p.position }));

/**
 * Drives a full snake draft to completion with the PURE reducer (no store, no I/O) and
 * inserts the resulting action log directly into `draft_actions` — bypassing `applyAction`
 * entirely, so its automatic commit-on-completion never runs. `drafts.status` is left exactly
 * as `seedDraftFixture` set it ("scheduled"). This is what "a draft finished but the process
 * crashed before the commit transaction ran" looks like on disk, and it's the only way to
 * reach `commitDraftResults`'s real (`alreadyCommitted: false`) branch, since every path
 * through the store commits automatically the moment a draft completes.
 */
async function seedCompletedActionLog(draftId: string, leagueId: string, teamIds: readonly string[]): Promise<void> {
  const config: DraftConfig = {
    draftId,
    leagueId,
    format: "snake",
    kickoffAt: "2026-09-10T17:00:00.000Z",
    auctionBudget: null,
    slotConfig: SPRINT_ROSTER_SLOTS,
    clockSchedule: DRAFT_CLOCK_SCHEDULE,
  };
  const actions: DraftAction[] = [
    { v: 1, type: "START_DRAFT", minBid: 1, timestamp: clock.now(), draftOrder: teamIds, pool: SPRINT_POOL },
  ];
  let state = initialDraftState(config);
  for (const action of actions) {
    const result = reduceDraft(state, action);
    if (!result.ok) throw new Error(result.reason);
    state = result.state;
  }
  while (state.phase !== "complete") {
    const expire: DraftAction = { v: 1, type: "TIMER_EXPIRE", timestamp: currentDeadline(state) ?? clock.now() };
    const result = reduceDraft(state, expire);
    if (!result.ok) throw new Error(result.reason);
    actions.push(expire);
    state = result.state;
  }

  await db.insert(draftActions).values(
    actions.map((action, index) => ({
      draftId,
      sequence: index + 1,
      action,
      timestamp: new Date(action.timestamp),
    })),
  );
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

  it("refuses to start a draft with an empty pool", async () => {
    // fixture() inserts POOL_ROWS into `players`; skip that step so the pool is empty.
    const { draftId } = await seedDraftFixture(db, {
      draftId: "draft_empty",
      leagueId: "league_empty",
      format: "snake",
      teamCount: 2,
      slotConfig: SPRINT_ROSTER_SLOTS,
      kickoffAt: new Date("2026-09-10T17:00:00.000Z"),
      auctionBudget: null,
    });
    expect(await store.startDraft(draftId)).toEqual({ ok: false, reason: "There are no players to draft yet." });
  });

  it("refuses to start a draft marked complete with an empty action log — the seeded-season-league booby trap", async () => {
    // Mirrors src/data/seed/seed-season-league.ts: rosters dealt directly, `drafts.status`
    // written straight to "complete", and NO draft_actions ever written. Replaying an empty
    // log yields phase "scheduled", so without this guard the reducer's own "already
    // started"/"already finished" checks never fire and startDraft would happily re-run over
    // rosters that already exist.
    const { draftId } = await fixture("snake");
    await db.update(drafts).set({ status: "complete" }).where(eq(drafts.id, draftId));

    const result = await store.startDraft(draftId);
    expect(result).toEqual({ ok: false, reason: "This draft has already finished." });
    expect(await db.select().from(draftActions).where(eq(draftActions.draftId, draftId))).toHaveLength(0);
  });

  it("refuses to start a draft whose pool can't fill every roster", async () => {
    // SPRINT_ROSTER_SLOTS is 3 slots/team * 2 teams = 6 players needed; insert only 5.
    const { draftId } = await seedDraftFixture(db, {
      draftId: "draft_short_pool",
      leagueId: "league_short_pool",
      format: "snake",
      teamCount: 2,
      slotConfig: SPRINT_ROSTER_SLOTS,
      kickoffAt: new Date("2026-09-10T17:00:00.000Z"),
      auctionBudget: null,
    });
    await db.insert(players).values(POOL_ROWS.slice(0, 5));
    expect(await store.startDraft(draftId)).toEqual({
      ok: false,
      reason: "There aren't enough players to fill every roster.",
    });
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

  it("gives the league a full season the moment the draft completes", async () => {
    const { draftId, leagueId, teamIds } = await fixture("snake");
    await store.startDraft(draftId);
    await runOnTheClock(draftId);

    const weekRows = await db.select().from(weeks).where(eq(weeks.leagueId, leagueId));
    const matchupRows = await db.select().from(matchups).where(eq(matchups.leagueId, leagueId));
    expect(weekRows).toHaveLength(LEAGUE_CONFIG.regularSeasonWeeks);
    expect(matchupRows.length).toBe(LEAGUE_CONFIG.regularSeasonWeeks * (teamIds.length / 2));
    expect(matchupRows.every((row) => row.homeScore === null && row.awayScore === null)).toBe(true);

    // …and the defensive re-commit does not duplicate it.
    await store.commitDraftResults(draftId);
    expect(await db.select().from(matchups).where(eq(matchups.leagueId, leagueId))).toHaveLength(matchupRows.length);
    expect(await db.select().from(weeks).where(eq(weeks.leagueId, leagueId))).toHaveLength(weekRows.length);
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

describe("commitDraftResults — the real commit branch", () => {
  it("refuses to commit a draft that doesn't exist", async () => {
    expect(await store.commitDraftResults("nope")).toEqual({ ok: false, reason: "That draft doesn't exist." });
  });

  it("commits for real (not the auto-commit shortcut) when a completed log exists but drafts.status was never flipped", async () => {
    const { draftId, leagueId, teamIds } = await fixture("snake");
    await seedCompletedActionLog(draftId, leagueId, teamIds);

    // Precondition: the log says the draft finished, but nothing has touched `drafts.status` —
    // it's still whatever seedDraftFixture set it to, proving auto-commit never ran here.
    const [before] = await db.select().from(drafts).where(eq(drafts.id, draftId));
    expect(before?.status).toBe("scheduled");
    expect(await db.select().from(draftPicks).where(eq(draftPicks.draftId, draftId))).toHaveLength(0);

    const result = await store.commitDraftResults(draftId);
    expect(result).toEqual({ ok: true, picks: 6, teams: 2, alreadyCommitted: false });

    const picks = await db.select().from(draftPicks).where(eq(draftPicks.draftId, draftId));
    expect(picks).toHaveLength(6);
    for (const teamId of teamIds) {
      expect(await db.select().from(rosterSlots).where(eq(rosterSlots.teamId, teamId))).toHaveLength(3);
    }
    const [after] = await db.select().from(drafts).where(eq(drafts.id, draftId));
    expect(after?.status).toBe("complete");
    // The recovered commit builds the season too — crash recovery must not leave a league
    // with rosters and no fixtures.
    expect(await db.select().from(weeks).where(eq(weeks.leagueId, leagueId))).toHaveLength(LEAGUE_CONFIG.regularSeasonWeeks);

    // Calling it again now finds drafts.status already "complete" and takes the short-circuit.
    const again = await store.commitDraftResults(draftId);
    expect(again).toEqual({ ok: true, picks: 6, teams: 2, alreadyCommitted: true });
    expect(await db.select().from(draftPicks).where(eq(draftPicks.draftId, draftId))).toHaveLength(6);
  });
});
