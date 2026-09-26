import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb, truncateAll } from "@/db/test-db";
import { chatMessages, draftActions, drafts, leagues, mockRooms, players, scoringSettings, teams } from "@/db/schema";
import type { Clock } from "@/domain/timing";
import { rankedPlayers } from "@/draft-service/pool";
import { createDraftStore, type DraftStore } from "@/draft-service/store";
import { createDraftAdvancer } from "@/draft-service/advance";
import { createMockBotDriver } from "./driver";
import { seedDraftFixture, SPRINT_ROSTER_SLOTS } from "@/draft-service/test-support";
import { MOCK_CONFIG } from "@/mock-draft/config";
import { deleteMockLeagueRow, sweepExpiredMocks } from "./sweep";
import { MOCK_TEST_CLOCK } from "./test-support";

const db = createTestDb();

const BASE_NOW = MOCK_TEST_CLOCK.now();
let now = BASE_NOW;
const clock: Clock = { now: () => now };
const advance = (ms: number): void => {
  now = new Date(Date.parse(now) + ms).toISOString();
};

function testStore(): DraftStore {
  return createDraftStore({ db, publish: async () => "0-0", clock });
}

beforeEach(async () => {
  await truncateAll(db);
  now = BASE_NOW;
});

afterAll(async () => {
  await truncateAll(db);
});

/** An all-bot 2-team sprint mock — started (and optionally driven to completion) through the
 *  REAL store and ticker, so the sweep is judged against rows production would actually write. */
async function seedMock(id: string, opts: { readonly completed: boolean }): Promise<{ leagueId: string; draftId: string; store: DraftStore }> {
  await db.insert(players).values([
    { id: "qb1", name: "QB One", position: "QB", nflTeam: "KC" },
    { id: "qb2", name: "QB Two", position: "QB", nflTeam: "KC" },
    { id: "rb1", name: "RB One", position: "RB", nflTeam: "SF" },
    { id: "rb2", name: "RB Two", position: "RB", nflTeam: "SF" },
    { id: "wr1", name: "WR One", position: "WR", nflTeam: "NYJ" },
    { id: "wr2", name: "WR Two", position: "WR", nflTeam: "NYJ" },
  ]);
  const fixture = await seedDraftFixture(db, {
    draftId: `draft_${id}`,
    leagueId: `league_${id}`,
    format: "snake",
    teamCount: 2,
    slotConfig: SPRINT_ROSTER_SLOTS,
    kickoffAt: new Date(Date.parse(BASE_NOW) + 24 * 60 * 60 * 1000),
    auctionBudget: null,
    isMock: true,
    botTeams: 2,
    mockPickSeconds: 30,
  });
  await db
    .insert(chatMessages)
    .values({ leagueId: fixture.leagueId, authorUserId: `${fixture.leagueId}_user_1`, body: "hello room" })
    .onConflictDoNothing();
  const store = testStore();
  const advancer = createDraftAdvancer({ db, store, mockDriver: createMockBotDriver({ db }) });
  await store.startDraft(fixture.draftId);
  if (opts.completed) {
    for (let i = 0; i < 40; i += 1) {
      const state = await store.getDraftState(fixture.draftId);
      if (state!.phase === "complete") break;
      advance(10_000);
      await advancer.advance(fixture.draftId, now);
    }
    expect((await store.getDraftState(fixture.draftId))!.phase).toBe("complete");
    // The commit that finished the room settled its status (the batched bots round), which is
    // exactly what makes it a candidate of the sweep's pure-SQL 'complete' scan.
    const [settled] = await db.select({ status: drafts.status }).from(drafts).where(eq(drafts.id, fixture.draftId));
    expect(settled?.status).toBe("complete");
  }
  return { leagueId: fixture.leagueId, draftId: fixture.draftId, store };
}

async function rowCounts(leagueId: string, draftId: string): Promise<Record<string, number>> {
  return {
    leagues: (await db.select({ id: leagues.id }).from(leagues).where(eq(leagues.id, leagueId))).length,
    teams: (await db.select({ id: teams.id }).from(teams).where(eq(teams.leagueId, leagueId))).length,
    drafts: (await db.select({ id: drafts.id }).from(drafts).where(eq(drafts.leagueId, leagueId))).length,
    draft_actions: (await db.select({ id: draftActions.id }).from(draftActions).where(eq(draftActions.draftId, draftId))).length,
    mock_rooms: (await db.select({ leagueId: mockRooms.leagueId }).from(mockRooms).where(eq(mockRooms.leagueId, leagueId))).length,
    scoring_settings: (await db.select({ leagueId: scoringSettings.leagueId }).from(scoringSettings).where(eq(scoringSettings.leagueId, leagueId))).length,
    chat_messages: (await db.select({ id: chatMessages.id }).from(chatMessages).where(eq(chatMessages.leagueId, leagueId))).length,
  };
}

const ZERO_ROWS = {
  leagues: 0,
  teams: 0,
  drafts: 0,
  draft_actions: 0,
  mock_rooms: 0,
  scoring_settings: 0,
  chat_messages: 0,
};

describe("the retention sweep (Task 6, Step 4)", () => {
  it("sweeps an expired completed mock to zero rows and drops its ranking cache", async () => {
    const { leagueId, draftId, store } = await seedMock("done", { completed: true });
    const cachedRanking = await rankedPlayers(db, leagueId);

    advance(MOCK_CONFIG.retention.completedMs + 60_000);
    const swept = await sweepExpiredMocks(db, { store, clock });

    expect(swept).toEqual([{ leagueId, draftId }]);
    expect(await rowCounts(leagueId, draftId)).toEqual(ZERO_ROWS);
    // `pool.ts`'s Map would otherwise hold one dead ranking per swept mock forever — a fresh
    // read must rebuild, never hand back the swept room's cached array.
    expect(await rankedPlayers(db, leagueId)).not.toBe(cachedRanking);
    // No resurrection, BEHAVIORALLY (fix round, review MEDIUM): the same store that drove and
    // cached this draft now answers null — the sweep's `store.invalidate` plus the cascade left
    // nothing for a replay to rebuild from, not merely a spy that was called.
    expect(await store.getDraftState(draftId)).toBeNull();
  });

  it("keeps a finished room for its full completedMs — the longer window, judged per state", async () => {
    const { leagueId, draftId, store } = await seedMock("kept", { completed: true });
    // Well past `inProgressMs` (so the completed room IS a scan candidate), well short of
    // `completedMs` (so the per-state judgment must keep it).
    advance(MOCK_CONFIG.retention.completedMs - 60_000);
    expect(await sweepExpiredMocks(db, { store, clock })).toEqual([]);
    expect((await rowCounts(leagueId, draftId)).leagues).toBe(1);
  });

  it("sweeps an abandoned in-progress room after inProgressMs from its last action", async () => {
    const { leagueId, draftId, store } = await seedMock("abandoned", { completed: false });
    advance(MOCK_CONFIG.retention.inProgressMs + 60_000);
    expect(await sweepExpiredMocks(db, { store, clock })).toEqual([{ leagueId, draftId }]);
    expect(await rowCounts(leagueId, draftId)).toEqual(ZERO_ROWS);
  });

  it("keeps a live in-progress room inside its window", async () => {
    const { leagueId, draftId, store } = await seedMock("live", { completed: false });
    advance(MOCK_CONFIG.retention.inProgressMs - 60_000);
    expect(await sweepExpiredMocks(db, { store, clock })).toEqual([]);
    expect((await rowCounts(leagueId, draftId)).leagues).toBe(1);
  });

  it("sweeps a never-started room after unstartedMs from created_at, and keeps a fresh one", async () => {
    const old = await seedDraftFixture(db, {
      draftId: "draft_stale_lobby",
      leagueId: "league_stale_lobby",
      format: "snake",
      teamCount: 8,
      slotConfig: SPRINT_ROSTER_SLOTS,
      kickoffAt: new Date(Date.parse(BASE_NOW) + 60_000),
      auctionBudget: null,
      isMock: true,
    });
    const fresh = await seedDraftFixture(db, {
      draftId: "draft_fresh_lobby",
      leagueId: "league_fresh_lobby",
      format: "snake",
      teamCount: 8,
      slotConfig: SPRINT_ROSTER_SLOTS,
      kickoffAt: new Date(Date.parse(BASE_NOW) + 60_000),
      auctionBudget: null,
      isMock: true,
    });
    // `created_at` is stamped by the database's own wall clock; the sweep judges it against the
    // injected clock, so both rows get an explicit stamp relative to BASE_NOW.
    await db
      .update(mockRooms)
      .set({ createdAt: new Date(Date.parse(BASE_NOW) - MOCK_CONFIG.retention.unstartedMs - 60_000) })
      .where(eq(mockRooms.leagueId, old.leagueId));
    await db.update(mockRooms).set({ createdAt: new Date(Date.parse(BASE_NOW)) }).where(eq(mockRooms.leagueId, fresh.leagueId));

    const swept = await sweepExpiredMocks(db, { store: testStore(), clock });
    expect(swept).toEqual([{ leagueId: old.leagueId, draftId: old.draftId }]);
    expect((await rowCounts(old.leagueId, old.draftId)).leagues).toBe(0);
    expect((await rowCounts(fresh.leagueId, fresh.draftId)).leagues).toBe(1);
  });

  it("never touches a real league, however old — no mock_rooms row means no candidacy, and even a corrupt sidecar row is filtered on is_mock", async () => {
    // A real league one retention-window past everything, with a scheduled draft: structurally
    // absent from the sweep's scans (no `mock_rooms` row).
    const real = await seedDraftFixture(db, {
      draftId: "draft_real_old",
      leagueId: "league_real_old",
      format: "snake",
      teamCount: 2,
      slotConfig: SPRINT_ROSTER_SLOTS,
      kickoffAt: new Date(Date.parse(BASE_NOW) - 400 * 24 * 60 * 60 * 1000),
      auctionBudget: null,
    });
    // A second real league behind a hand-corrupted sidecar row (nothing in production writes
    // this shape): the scan's own `is_mock = true` join refuses it candidacy.
    const corrupt = await seedDraftFixture(db, {
      draftId: "draft_real_corrupt",
      leagueId: "league_real_corrupt",
      format: "snake",
      teamCount: 2,
      slotConfig: SPRINT_ROSTER_SLOTS,
      kickoffAt: new Date(Date.parse(BASE_NOW) - 400 * 24 * 60 * 60 * 1000),
      auctionBudget: null,
    });
    await db.insert(mockRooms).values({
      leagueId: corrupt.leagueId,
      hostUserId: `${corrupt.leagueId}_user_1`,
      mode: "lobby",
      pickSeconds: 60,
      botSeed: 1,
      shareCode: "corrupt_code",
      startsAt: new Date(Date.parse(BASE_NOW)),
      createdAt: new Date(Date.parse(BASE_NOW) - MOCK_CONFIG.retention.unstartedMs - 60_000),
    });

    advance(365 * 24 * 60 * 60 * 1000);
    expect(await sweepExpiredMocks(db, { store: testStore(), clock })).toEqual([]);
    expect((await rowCounts(real.leagueId, real.draftId)).leagues).toBe(1);
    expect((await rowCounts(corrupt.leagueId, corrupt.draftId)).leagues).toBe(1);
  });

  it("the writer itself refuses a real league: deleteMockLeagueRow is a no-op on is_mock=false", async () => {
    const real = await seedDraftFixture(db, {
      draftId: "draft_real_writer",
      leagueId: "league_real_writer",
      format: "snake",
      teamCount: 2,
      slotConfig: SPRINT_ROSTER_SLOTS,
      kickoffAt: new Date(Date.parse(BASE_NOW)),
      auctionBudget: null,
    });
    expect(await deleteMockLeagueRow(db, real.leagueId)).toBe(false);
    expect((await rowCounts(real.leagueId, real.draftId)).leagues).toBe(1);

    const mock = await seedDraftFixture(db, {
      draftId: "draft_mock_writer",
      leagueId: "league_mock_writer",
      format: "snake",
      teamCount: 2,
      slotConfig: SPRINT_ROSTER_SLOTS,
      kickoffAt: new Date(Date.parse(BASE_NOW)),
      auctionBudget: null,
      isMock: true,
    });
    expect(await deleteMockLeagueRow(db, mock.leagueId)).toBe(true);
    expect((await rowCounts(mock.leagueId, mock.draftId)).leagues).toBe(0);
  });

  it("absorbs losing the delete race itself: a league that vanishes between the scan and the DELETE is skipped, not an error", async () => {
    const { leagueId, draftId, store } = await seedMock("delete_race", { completed: false });
    advance(MOCK_CONFIG.retention.inProgressMs + 60_000);
    // The "concurrent sweep" wins in the window between this run's scan and its own DELETE —
    // simulated at the injectable writer seam, with the REAL writer still making the final call.
    const racedDelete = async (dbArg: typeof db, id: string): Promise<boolean> => {
      await db.delete(leagues).where(eq(leagues.id, id));
      return deleteMockLeagueRow(dbArg, id);
    };
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(await sweepExpiredMocks(db, { store, clock, deleteLeague: racedDelete })).toEqual([]);
      expect(errorSpy).toHaveBeenCalledWith("[mock-draft] sweep could not delete a league it judged expired", { leagueId });
    } finally {
      errorSpy.mockRestore();
    }
    expect((await rowCounts(leagueId, draftId)).leagues).toBe(0);
  });

  it("invalidates the ranking cache, the store's own state cache and the bot driver's meta per swept room (the injected seams)", async () => {
    const { leagueId, draftId, store } = await seedMock("caches", { completed: true });
    advance(MOCK_CONFIG.retention.completedMs + 60_000);
    const invalidateRanking = vi.fn();
    const invalidate = vi.fn();
    const invalidateDriverMeta = vi.fn();
    const swept = await sweepExpiredMocks(db, { store: { ...store, invalidate }, clock, invalidateRanking, invalidateDriverMeta });
    expect(swept).toEqual([{ leagueId, draftId }]);
    expect(invalidateRanking).toHaveBeenCalledTimes(1);
    expect(invalidateRanking).toHaveBeenCalledWith(leagueId);
    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledWith(draftId);
    // Fix round (review MEDIUM): the driver's per-draft meta is the third in-memory hold a
    // swept room could keep — dropped through the same per-room seam the ticker wires to
    // `createMockBotDriver().invalidateDraft` (that function's own behavior is proven in
    // `driver.test.ts`; this pins that the sweep calls it once per swept room).
    expect(invalidateDriverMeta).toHaveBeenCalledTimes(1);
    expect(invalidateDriverMeta).toHaveBeenCalledWith(draftId);
  });

});
