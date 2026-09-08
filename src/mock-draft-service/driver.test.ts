import { and, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb, truncateAll } from "@/db/test-db";
import { drafts, mockRooms, players, teams, users } from "@/db/schema";
import { DRAFT_ACTION_VERSION } from "@/domain/draft";
import type { Clock } from "@/domain/timing";
import { teamOnClock, type DraftState } from "@/draft-engine";
import { createDraftStore, type DraftStore } from "@/draft-service/store";
import { createDraftTicker, liveDraftsQuery, type DraftTicker } from "@/draft-service/ticker";
import { seedDraftFixture, SPRINT_ROSTER_SLOTS } from "@/draft-service/test-support";
import { botThinkDelayMs } from "@/mock-draft/bots";
import { MOCK_CONFIG } from "@/mock-draft/config";
import { rngFor } from "@/mock-draft/rng";
import { createMockRoom } from "./creation";
import { createMockBotDriver, dueMockRoomsQuery, settleMockDraftCompletion, startDueMockRooms } from "./driver";
import { mockLifecycleDeps, seedLobbyMock, seedPracticePlayers, MOCK_TEST_CLOCK } from "./test-support";

const db = createTestDb();

/** The same instant `MOCK_TEST_CLOCK` pins, so fixtures built through the real writers (which
 *  stamp `starts_at` off that clock) and this file's own advancing clock agree about "now". */
const BASE_NOW = MOCK_TEST_CLOCK.now();
let now = BASE_NOW;
const clock: Clock = { now: () => now };
const advance = (ms: number): void => {
  now = new Date(Date.parse(now) + ms).toISOString();
};

/** The fixture's own `botSeed` (`seedDraftFixture` stamps 7) — named so the delay-boundary test
 *  reads as arithmetic, not as a magic number agreeing with another magic number. */
const FIXTURE_BOT_SEED = 7;

/** The delay draw's upper bound (`MOCK_CONFIG.botDelay`): a clock advanced this far past a turn's
 *  start is past ANY bot's seeded delay for that turn. */
const MAX_DELAY_MS = MOCK_CONFIG.botDelay.baseMs + MOCK_CONFIG.botDelay.jitterMs;

function testStore(publishLog?: string[]): DraftStore {
  return createDraftStore({
    db,
    publish: async (input) => {
      publishLog?.push(input.type);
      return "0-0";
    },
    clock,
  });
}

/** A ticker with the two unrelated lanes stubbed out, the same isolation `ticker.test.ts`'s own
 *  `NO_OP_HOUSE_RECONCILE` keeps — these tests are about the MOCK lanes riding the real tick. */
function testTicker(store: DraftStore): DraftTicker {
  return createDraftTicker({
    db,
    store,
    clock,
    autoStart: async () => [],
    reconcileHouse: async () => ({ opened: [], retired: [], refused: [] }),
  });
}

/** Six players — exactly what a 2-team sprint-roster draft (2 × QB/RB/WR) can fully seat. */
async function seedSprintPlayers(): Promise<void> {
  await db.insert(players).values([
    { id: "qb1", name: "QB One", position: "QB", nflTeam: "KC" },
    { id: "qb2", name: "QB Two", position: "QB", nflTeam: "KC" },
    { id: "rb1", name: "RB One", position: "RB", nflTeam: "SF" },
    { id: "rb2", name: "RB Two", position: "RB", nflTeam: "SF" },
    { id: "wr1", name: "WR One", position: "WR", nflTeam: "NYJ" },
    { id: "wr2", name: "WR Two", position: "WR", nflTeam: "NYJ" },
  ]);
}

/**
 * A 2-team, all-bot mock on the sprint roster — the smallest room the driver can carry to
 * completion (6 picks). `kickoffAt` (which `seedDraftFixture` copies into `mock_rooms.starts_at`)
 * sits a day out so the DUE SCAN never starts this room out from under a test that wants to
 * start it by hand.
 */
async function seedAllBotMock(id: string, opts?: { readonly botTeams?: number }): Promise<{ draftId: string; leagueId: string; teamIds: readonly string[] }> {
  const fixture = await seedDraftFixture(db, {
    draftId: `draft_${id}`,
    leagueId: `league_${id}`,
    format: "snake",
    teamCount: 2,
    slotConfig: SPRINT_ROSTER_SLOTS,
    kickoffAt: new Date(Date.parse(BASE_NOW) + 24 * 60 * 60 * 1000),
    auctionBudget: null,
    isMock: true,
    botTeams: opts?.botTeams ?? 2,
    mockPickSeconds: 30,
  });
  await seedSprintPlayers();
  return fixture;
}

async function countBotTeams(leagueId: string): Promise<number> {
  const rows = await db
    .select({ id: teams.id })
    .from(teams)
    .innerJoin(users, eq(users.id, teams.userId))
    .where(and(eq(teams.leagueId, leagueId), eq(users.isBot, true)));
  return rows.length;
}

beforeEach(async () => {
  await truncateAll(db);
  now = BASE_NOW;
});

afterAll(async () => {
  await truncateAll(db);
});

describe("the due scan (Task 6, Step 2)", () => {
  it("starts a due lobby mock short of humans by topping up bots first", async () => {
    await seedPracticePlayers(db);
    const room = await seedLobbyMock(db, { teamCount: 8, humans: 2, startsAtOffsetMs: -1 });
    const store = testStore();
    const ticker = testTicker(store);

    const outcomes = await ticker.tick();

    const state = await store.getDraftState(room.draftId);
    expect(state!.phase).toBe("in_progress");
    expect(await countBotTeams(room.leagueId)).toBe(6);
    expect(outcomes).toContainEqual({ draftId: room.draftId, applied: true });
  });

  it("leaves a lobby whose fill window has not fired untouched", async () => {
    await seedPracticePlayers(db);
    const room = await seedLobbyMock(db, { teamCount: 8, humans: 2, startsAtOffsetMs: 60_000 });
    const ticker = testTicker(testStore());

    await ticker.tick();

    const [draft] = await db.select({ status: drafts.status }).from(drafts).where(eq(drafts.id, room.draftId));
    expect(draft?.status).toBe("scheduled");
    expect(await countBotTeams(room.leagueId)).toBe(0);
  });

  it("finishes a solo room whose own start failed at creation — startsAt=now means the very next tick retries (the T5 carry)", async () => {
    // NO players seeded yet: the solo self-start fails (the pool is empty), is logged and
    // swallowed by `createMockRoom`, and the committed room waits `'scheduled'` with
    // `starts_at = now` — exactly the shape the due scan exists to finish.
    await db.insert(users).values({ id: "solo_host", email: "solo_host@test.local", displayName: "Solo Host" });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    let created;
    try {
      created = await createMockRoom(
        db,
        { hostUserId: "solo_host", mode: "solo", teamCount: 8, pickSeconds: 30, scoringPreset: "ppr", rosterShape: "standard" },
        mockLifecycleDeps(db, { clock }),
      );
    } finally {
      errorSpy.mockRestore();
    }
    expect(created).toMatchObject({ ok: true });
    const { draftId } = created as { draftId: string };
    const [before] = await db.select({ status: drafts.status }).from(drafts).where(eq(drafts.id, draftId));
    expect(before?.status).toBe("scheduled");

    // The players arrive; the due scan's next tick starts the room with no other help.
    await seedPracticePlayers(db);
    const store = testStore();
    await testTicker(store).tick();
    expect((await store.getDraftState(draftId))!.phase).toBe("in_progress");
  });

  it("dueMockRoomsQuery: due scheduled rooms only, oldest first, bounded by maxMockStartsPerTick", async () => {
    const total = MOCK_CONFIG.maxMockStartsPerTick + 1;
    for (let i = 1; i <= total; i += 1) {
      // Each room's `starts_at` is `i` seconds in the past, so the oldest is the LAST seeded.
      await seedDraftFixture(db, {
        draftId: `draft_due_${i}`,
        leagueId: `league_due_${i}`,
        format: "snake",
        teamCount: 2,
        slotConfig: SPRINT_ROSTER_SLOTS,
        kickoffAt: new Date(Date.parse(BASE_NOW) - i * 1000),
        auctionBudget: null,
        isMock: true,
        botTeams: 2,
      });
    }
    // One already started (must not appear), one not yet due (must not appear).
    await seedDraftFixture(db, {
      draftId: "draft_due_started",
      leagueId: "league_due_started",
      format: "snake",
      teamCount: 2,
      slotConfig: SPRINT_ROSTER_SLOTS,
      kickoffAt: new Date(Date.parse(BASE_NOW) - 10_000_000),
      auctionBudget: null,
      isMock: true,
      botTeams: 2,
    });
    await db.update(drafts).set({ status: "in_progress" }).where(eq(drafts.id, "draft_due_started"));
    await seedDraftFixture(db, {
      draftId: "draft_due_future",
      leagueId: "league_due_future",
      format: "snake",
      teamCount: 2,
      slotConfig: SPRINT_ROSTER_SLOTS,
      kickoffAt: new Date(Date.parse(BASE_NOW) + 60_000),
      auctionBudget: null,
      isMock: true,
      botTeams: 2,
    });

    const rows = await dueMockRoomsQuery(db, new Date(Date.parse(now)));
    expect(rows).toHaveLength(MOCK_CONFIG.maxMockStartsPerTick);
    // Oldest `starts_at` first: the last-seeded room is the most overdue.
    expect(rows[0]!.leagueId).toBe(`league_due_${total}`);
    const returned = rows.map((row) => row.leagueId);
    expect(returned).not.toContain("league_due_started");
    expect(returned).not.toContain("league_due_future");
    // The one due room past the ceiling waits for the next tick.
    expect(returned).not.toContain("league_due_1");
  });

  it("maps a start the race already won to a benign outcome, never a failure (the mapped-409 answer)", async () => {
    // A due lobby with NO players: `startMockDraft` tops bots up, then the real start refuses
    // (empty pool) as a mapped 409 — the same status a lost cross-instance race answers with,
    // absorbed rather than logged as an error.
    const room = await seedLobbyMock(db, { teamCount: 8, humans: 2, startsAtOffsetMs: -1 });
    const outcomes = await startDueMockRooms(db, mockLifecycleDeps(db, { clock }));
    expect(outcomes).toEqual([{ leagueId: room.leagueId, started: false, benignRace: true, reason: "There are no players to draft yet." }]);
  });

  it("catches one room's own thrown failure without starving the rooms after it", async () => {
    await seedPracticePlayers(db);
    const roomA = await seedLobbyMock(db, { teamCount: 8, humans: 1, startsAtOffsetMs: -2000 });
    const roomB = await seedLobbyMock(db, { teamCount: 8, humans: 1, startsAtOffsetMs: -1000 });
    const deps = mockLifecycleDeps(db, { clock });
    // A store whose start throws for room A only — room B must still start this scan.
    const throwingStore: DraftStore = {
      ...deps.store,
      startDraft: async (draftId) => {
        if (draftId === roomA.draftId) throw new Error("connection reset");
        return deps.store.startDraft(draftId);
      },
    };
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const outcomes = await startDueMockRooms(db, { ...deps, store: throwingStore });
      expect(outcomes).toContainEqual({
        leagueId: roomA.leagueId,
        started: false,
        benignRace: false,
        reason: "Something went wrong starting this mock draft.",
      });
      expect(outcomes).toContainEqual({ leagueId: roomB.leagueId, started: true, draftId: roomB.draftId });
      expect(errorSpy).toHaveBeenCalledWith("[mock-draft] due start failed", { leagueId: roomA.leagueId }, expect.any(Error));
    } finally {
      errorSpy.mockRestore();
    }
  });
});

describe("the bot driver (Task 6, Step 3)", () => {
  it("submits a bot pick only after the seeded think-delay, through the real single-writer path", async () => {
    const fixture = await seedAllBotMock("delay");
    const store = testStore();
    const ticker = testTicker(store);
    await store.startDraft(fixture.draftId);

    // t=0: a bot is on the clock, its delay has not elapsed.
    await ticker.tick();
    expect((await store.getDraftState(fixture.draftId))!.picks).toHaveLength(0);

    advance(MAX_DELAY_MS);
    await ticker.tick();
    const state = await store.getDraftState(fixture.draftId);
    expect(state!.picks).toHaveLength(1);
    expect(state!.picks[0]!.auto).toBe(false);

    // The NEXT bot's own turn only just started — one pick per draft per tick is the pace.
    await ticker.tick();
    expect((await store.getDraftState(fixture.draftId))!.picks).toHaveLength(1);
  });

  it("waits out the delay to the exact seeded millisecond — one short, then due", async () => {
    const fixture = await seedAllBotMock("boundary");
    const store = testStore();
    const ticker = testTicker(store);
    await store.startDraft(fixture.draftId);
    const state = await store.getDraftState(fixture.draftId);
    const onClock = state!.draftOrder[0]!;

    // The identical stream the driver derives: the room's stored seed, this pick's own key.
    const dueAtMs = Date.parse(BASE_NOW) + botThinkDelayMs(30, rngFor(FIXTURE_BOT_SEED, `${onClock}:delay:1`));

    now = new Date(Math.ceil(dueAtMs) - 1).toISOString();
    await ticker.tick();
    expect((await store.getDraftState(fixture.draftId))!.picks).toHaveLength(0);

    now = new Date(Math.ceil(dueAtMs)).toISOString();
    await ticker.tick();
    const after = await store.getDraftState(fixture.draftId);
    expect(after!.picks).toHaveLength(1);
    expect(after!.picks[0]!.teamId).toBe(onClock);
  });

  it("lands the pick through the real store: the room broadcasts draft.pick over the live wire", async () => {
    const fixture = await seedAllBotMock("sse");
    const publishLog: string[] = [];
    const store = testStore(publishLog);
    const ticker = testTicker(store);
    await store.startDraft(fixture.draftId);

    advance(MAX_DELAY_MS);
    await ticker.tick();

    expect((await store.getDraftState(fixture.draftId))!.picks).toHaveLength(1);
    expect(publishLog).toContain("draft.pick");
  });

  it("replays exactly: a mid-draft server restart resumes the identical pick log (the fast-forwarded stream)", async () => {
    const run = async (restartAfterPicks: number | null): Promise<readonly string[]> => {
      await truncateAll(db);
      now = BASE_NOW;
      const fixture = await seedAllBotMock("replay");
      let store = testStore();
      let ticker = testTicker(store);
      await store.startDraft(fixture.draftId);
      let restarted = false;
      for (let i = 0; i < 60; i += 1) {
        const state = await store.getDraftState(fixture.draftId);
        if (state!.phase === "complete") {
          expect(state!.picks.every((pick) => !pick.auto)).toBe(true); // no bot ever timed out
          return state!.picks.map((pick) => `${pick.teamId}:${pick.playerId}`);
        }
        if (restartAfterPicks !== null && !restarted && state!.picks.length >= restartAfterPicks) {
          // The "restart": a fresh store and a fresh ticker — every in-memory cache (draft
          // state, bot metadata, rng cursors) is gone, exactly as a redeployed server's would be.
          store = testStore();
          ticker = testTicker(store);
          restarted = true;
        }
        advance(10_000);
        await ticker.tick();
      }
      throw new Error("the draft did not complete");
    };

    const uninterrupted = await run(null);
    const restarted = await run(3);
    expect(uninterrupted).toHaveLength(6);
    expect(restarted).toEqual(uninterrupted);
  });

  it("leaves a human on the clock alone", async () => {
    const fixture = await seedAllBotMock("human", { botTeams: 1 });
    const store = testStore();
    await store.startDraft(fixture.draftId);
    const state = await store.getDraftState(fixture.draftId);
    // `seedDraftFixture` marks bot users from the END of the roster: team 1 is the human.
    const humanTeamId = fixture.teamIds[0]!;
    const humanFirst: DraftState = { ...state!, draftOrder: [humanTeamId, fixture.teamIds[1]!] };

    const { driveBotPick } = createMockBotDriver({ db, store });
    advance(60_000); // far past any think-delay AND past the clock — still not the driver's turn to act
    expect(await driveBotPick(humanFirst, now)).toBeNull();
    expect((await store.getDraftState(fixture.draftId))!.picks).toHaveLength(0);
  });

  it("answers null with no team on the clock — settling a finished room, leaving any other phase alone (fix round)", async () => {
    const fixture = await seedAllBotMock("done");
    const store = testStore();
    await store.startDraft(fixture.draftId);
    const state = await store.getDraftState(fixture.draftId);
    const { driveBotPick } = createMockBotDriver({ db, store });

    // A no-team-on-clock state that is NOT complete settles nothing.
    expect(await driveBotPick({ ...state!, phase: "scheduled" }, now)).toBeNull();
    const [unsettled] = await db.select({ status: drafts.status }).from(drafts).where(eq(drafts.id, fixture.draftId));
    expect(unsettled?.status).toBe("in_progress");

    // A finished room is settled in the same breath as the null answer (Task 6 fix round).
    expect(await driveBotPick({ ...state!, phase: "complete" }, now)).toBeNull();
    const [settled] = await db.select({ status: drafts.status }).from(drafts).where(eq(drafts.id, fixture.draftId));
    expect(settled?.status).toBe("complete");
  });

  it("settleMockDraftCompletion is idempotent and refuses everything but an in_progress mock (fix round, ruled)", async () => {
    // The real thing, once: started mock, settled exactly one time.
    const mock = await seedAllBotMock("settle");
    const store = testStore();
    await store.startDraft(mock.draftId);
    expect(await settleMockDraftCompletion(db, mock.draftId)).toBe(true);
    expect(await settleMockDraftCompletion(db, mock.draftId)).toBe(false); // idempotent — zero rows the second time
    const [row] = await db.select({ status: drafts.status }).from(drafts).where(eq(drafts.id, mock.draftId));
    expect(row?.status).toBe("complete");

    // A mock that never started: the in_progress precondition refuses.
    const scheduled = await seedDraftFixture(db, {
      draftId: "draft_settle_sched",
      leagueId: "league_settle_sched",
      format: "snake",
      teamCount: 2,
      slotConfig: SPRINT_ROSTER_SLOTS,
      kickoffAt: new Date(Date.parse(BASE_NOW) + 24 * 60 * 60 * 1000),
      auctionBudget: null,
      isMock: true,
      botTeams: 2,
    });
    expect(await settleMockDraftCompletion(db, scheduled.draftId)).toBe(false);
    const [sched] = await db.select({ status: drafts.status }).from(drafts).where(eq(drafts.id, scheduled.draftId));
    expect(sched?.status).toBe("scheduled");

    // A REAL league's in-progress draft: the is_mock belt refuses at the writer, whatever the
    // caller believed — a real draft's status is only ever written by claimAutoStart and
    // commitDraftState.
    const real = await seedDraftFixture(db, {
      draftId: "draft_settle_real",
      leagueId: "league_settle_real",
      format: "snake",
      teamCount: 2,
      slotConfig: SPRINT_ROSTER_SLOTS,
      kickoffAt: new Date(Date.parse(BASE_NOW) + 24 * 60 * 60 * 1000),
      auctionBudget: null,
    });
    await db.update(drafts).set({ status: "in_progress" }).where(eq(drafts.id, real.draftId));
    expect(await settleMockDraftCompletion(db, real.draftId)).toBe(false);
    const [realRow] = await db.select({ status: drafts.status }).from(drafts).where(eq(drafts.id, real.draftId));
    expect(realRow?.status).toBe("in_progress");
  });

  it("invalidateDraft drops a swept draft's cached meta; a live cache never re-reads the sidecar (fix round MEDIUM)", async () => {
    const fixture = await seedAllBotMock("meta_sweep");
    const store = testStore();
    await store.startDraft(fixture.draftId);
    const stale = await store.getDraftState(fixture.draftId);
    const driver = createMockBotDriver({ db, store });
    advance(MAX_DELAY_MS);

    expect(await driver.driveBotPick(stale!, now)).toEqual({ picked: true }); // meta cached here
    await db.delete(mockRooms).where(eq(mockRooms.leagueId, fixture.leagueId));

    // CONTROL — the cache is real: with the sidecar row already gone, the cached meta still
    // carries the same stale state all the way to the store (which refuses the replayed pick
    // against the fresh log) — `mock_rooms` was never consulted again.
    expect(await driver.driveBotPick(stale!, now)).toMatchObject({ picked: false });

    // THE SEAM: invalidated (what the sweep calls per swept room), the next call re-reads the
    // sidecar, finds the room gone, and answers null.
    driver.invalidateDraft(fixture.draftId);
    expect(await driver.driveBotPick(stale!, now)).toBeNull();
  });

  it("answers null when the mock_rooms row is gone out from under a held state (a concurrent sweep)", async () => {
    const fixture = await seedAllBotMock("vanished");
    const store = testStore();
    await store.startDraft(fixture.draftId);
    const state = await store.getDraftState(fixture.draftId);
    await db.delete(mockRooms).where(eq(mockRooms.leagueId, fixture.leagueId));
    const { driveBotPick } = createMockBotDriver({ db, store });
    advance(60_000);
    expect(await driveBotPick(state!, now)).toBeNull();
  });

  it("answers null for a state with no running turn clock", async () => {
    const fixture = await seedAllBotMock("noclock");
    const store = testStore();
    await store.startDraft(fixture.draftId);
    const state = await store.getDraftState(fixture.draftId);
    const { driveBotPick } = createMockBotDriver({ db, store });
    advance(60_000);
    // No turn start: no clock tier in force, nothing to measure a think-delay from.
    expect(await driveBotPick({ ...state!, turnStartedAt: null }, now)).toBeNull();
  });

  it("treats a roster that can take nothing as no pick, not an error (the T3 carry)", async () => {
    const fixture = await seedAllBotMock("full");
    const store = testStore();
    await store.startDraft(fixture.draftId);
    const state = await store.getDraftState(fixture.draftId);
    const onClock = state!.draftOrder[0]!;
    const fullRoster: DraftState = {
      ...state!,
      rosters: {
        ...state!.rosters,
        [onClock]: [
          { slot: "QB", slotIndex: 0, playerId: "qb1" },
          { slot: "RB", slotIndex: 0, playerId: "rb1" },
          { slot: "WR", slotIndex: 0, playerId: "wr1" },
        ],
      },
    };
    const { driveBotPick } = createMockBotDriver({ db, store });
    advance(60_000);
    expect(await driveBotPick(fullRoster, now)).toBeNull();
    expect((await store.getDraftState(fixture.draftId))!.picks).toHaveLength(0);
  });

  it("surfaces the store's own refusal when a stale state drives a pick the log already moved past", async () => {
    const fixture = await seedAllBotMock("stale");
    const store = testStore();
    await store.startDraft(fixture.draftId);
    const stale = await store.getDraftState(fixture.draftId);
    const { driveBotPick } = createMockBotDriver({ db, store });
    advance(MAX_DELAY_MS);

    expect(await driveBotPick(stale!, now)).toEqual({ picked: true });
    // The same STALE state again: the driver re-derives the identical pick, and the real
    // admit/reduce path — judging against the FRESH log under the row lock — refuses it.
    const second = await driveBotPick(stale!, now);
    expect(second).toMatchObject({ picked: false });
    expect((second as { reason: string }).reason.length).toBeGreaterThan(0);
    expect((await store.getDraftState(fixture.draftId))!.picks).toHaveLength(1);
  });
});

describe("a lone human's room paces its bots too (founder report 2026-09-08: no burst, no sim lane)", () => {
  /** The human's next legal pick in the sprint fixture: any untaken player at a position the
   *  human's own roster still has open. Position is the id's own prefix (qb1/rb2/wr1...). */
  function nextHumanPlayer(state: DraftState, humanTeamId: string): string {
    const taken = new Set(state.picks.map((pick) => pick.playerId));
    const filled = new Set(state.picks.filter((pick) => pick.teamId === humanTeamId).map((pick) => pick.playerId.slice(0, 2)));
    const playerId = ["qb1", "qb2", "rb1", "rb2", "wr1", "wr2"].find((id) => !taken.has(id) && !filled.has(id.slice(0, 2)));
    if (playerId === undefined) throw new Error("no eligible player left for the human");
    return playerId;
  }

  it("a drive lands at most ONE bot pick, and only once that pick's own seeded delay has elapsed", async () => {
    // One human (team 1), one bot: the seat arithmetic that used to select the zero-delay sim
    // lane. A 2-team snake puts the bot on the clock twice in a row at the turn edge, which is
    // exactly the stretch that used to land in one call.
    const fixture = await seedAllBotMock("paced_solo", { botTeams: 1 });
    const store = testStore();
    await store.startDraft(fixture.draftId);
    const humanTeamId = fixture.teamIds[0]!;
    const { driveBotPick } = createMockBotDriver({ db, store });

    let state = (await store.getDraftState(fixture.draftId))!;
    if (teamOnClock(state) === humanTeamId) {
      const picked = await store.applyAction(fixture.draftId, { v: DRAFT_ACTION_VERSION, type: "MAKE_PICK", timestamp: now, teamId: humanTeamId, playerId: nextHumanPlayer(state, humanTeamId) });
      if (!picked.ok) throw new Error(picked.reason);
      state = picked.state;
    }
    const picksBefore = state.picks.length;
    // The bot's turn just began: nothing is due, whatever the seat count.
    expect(await driveBotPick(state, now)).toBeNull();
    advance(MAX_DELAY_MS);
    expect(await driveBotPick(state, now)).toEqual({ picked: true });
    const after = (await store.getDraftState(fixture.draftId))!;
    expect(after.picks).toHaveLength(picksBefore + 1);
    // The bot holds the clock again (the snake's turn edge), and its NEXT pick is not due yet:
    // the second pick waits its own delay instead of riding the first drive.
    expect(teamOnClock(after)).not.toBe(humanTeamId);
    expect(await driveBotPick(after, now)).toBeNull();
  });

  it("completion settles in the drive that observes it, paced or not", async () => {
    const fixture = await seedAllBotMock("paced_settle", { botTeams: 1 });
    const store = testStore();
    await store.startDraft(fixture.draftId);
    const humanTeamId = fixture.teamIds[0]!;
    const { driveBotPick } = createMockBotDriver({ db, store });

    let state = (await store.getDraftState(fixture.draftId))!;
    for (let i = 0; i < 40 && state.phase !== "complete"; i += 1) {
      if (teamOnClock(state) === humanTeamId) {
        const picked = await store.applyAction(fixture.draftId, { v: DRAFT_ACTION_VERSION, type: "MAKE_PICK", timestamp: now, teamId: humanTeamId, playerId: nextHumanPlayer(state, humanTeamId) });
        if (!picked.ok) throw new Error(picked.reason);
        state = picked.state;
      } else {
        advance(MAX_DELAY_MS);
        await driveBotPick(state, now);
        state = (await store.getDraftState(fixture.draftId))!;
      }
    }
    expect(state.phase).toBe("complete");
    expect(state.picks.every((pick) => !pick.auto)).toBe(true);

    // Whichever seat made the final pick, ONE more drive call against the finished state is
    // the most that stands between the last pick and a settled row.
    await driveBotPick(state, now);
    const [row] = await db.select({ status: drafts.status }).from(drafts).where(eq(drafts.id, fixture.draftId));
    expect(row?.status).toBe("complete");
  });
});

describe("the whole practice round, through the real writers", () => {
  it("a solo room drafts itself to completion: bots pick at their seeded delay, the absent host is autopicked, status never lies", async () => {
    await seedPracticePlayers(db);
    await db.insert(users).values({ id: "solo_full_host", email: "solo_full@test.local", displayName: "Solo Host" });
    const created = await createMockRoom(
      db,
      { hostUserId: "solo_full_host", mode: "solo", teamCount: 2, pickSeconds: 30, scoringPreset: "ppr", rosterShape: "standard" },
      mockLifecycleDeps(db, { clock }),
    );
    expect(created).toMatchObject({ ok: true });
    const room = created as { draftId: string; leagueId: string; teamId: string };

    const store = testStore();
    const ticker = testTicker(store);
    let state = await store.getDraftState(room.draftId);
    expect(state!.phase).toBe("in_progress"); // solo started itself at creation

    for (let i = 0; i < 200 && state!.phase !== "complete"; i += 1) {
      advance(10_000);
      await ticker.tick();
      state = await store.getDraftState(room.draftId);
    }

    expect(state!.phase).toBe("complete");
    expect(state!.picks).toHaveLength(30); // 2 teams × 15 standard roster spots
    const hostPicks = state!.picks.filter((pick) => pick.teamId === room.teamId);
    const botPicks = state!.picks.filter((pick) => pick.teamId !== room.teamId);
    expect(hostPicks.every((pick) => pick.auto)).toBe(true); // the absent host was autopicked by the clock
    expect(botPicks.every((pick) => !pick.auto)).toBe(true); // no bot ever timed out (the T1 guarantee)

    // Task 4's law still holds at the completing pick itself: the pick that finishes a mock
    // writes NO status through `commitDraftState` — the flip is only ever the bare guarded
    // SETTLE (Task 6 fix round, ruled). Within one tick of completion the row is settled and
    // its `liveDraftsQuery` slot is freed for real drafts (the slot-freed regression the ruling
    // exists for) — promptly, never the retention window.
    await ticker.tick();
    const [after] = await db.select({ status: drafts.status }).from(drafts).where(eq(drafts.id, room.draftId));
    expect(after?.status).toBe("complete");
    expect((await liveDraftsQuery(db)).map((row) => row.id)).not.toContain(room.draftId);
  });
});

describe("dueBotPick (the drivers' one due computation — the paced ticker and the catch-up funnel both read it)", () => {
  it("prices a paced bot turn at turnStartedAt + the seeded think-delay, naming the exact pick the live drive lands", async () => {
    const fixture = await seedAllBotMock("duecalc");
    const store = testStore();
    const driver = createMockBotDriver({ db, store });
    await store.startDraft(fixture.draftId);
    const state = (await store.getDraftState(fixture.draftId))!;
    const onClock = state.draftOrder[0]!;

    const due = await driver.dueBotPick(state);
    expect(due).not.toBeNull();
    expect(due!.teamId).toBe(onClock);
    // The identical stream the live driver derives: the room's stored seed, this pick's own key.
    expect(due!.dueAtMs).toBe(Date.parse(state.turnStartedAt!) + botThinkDelayMs(30, rngFor(FIXTURE_BOT_SEED, `${onClock}:delay:1`)));
    // The selection thunk is pure: asking twice answers identically and moves no cursor.
    const playerId = due!.choosePick();
    expect(playerId).not.toBeNull();
    expect(due!.choosePick()).toBe(playerId);

    // One computation, two callers: the live drive at the due instant lands THIS pick.
    now = new Date(Math.ceil(due!.dueAtMs)).toISOString();
    const driven = await driver.driveBotPick(state, now);
    expect(driven).toEqual({ picked: true });
    const after = (await store.getDraftState(fixture.draftId))!;
    expect(after.picks[0]!.playerId).toBe(playerId);
  });

  it("prices a lone human's room's bot turn at the same seeded delay as any room (no zero-delay lane) and answers null while the human holds the clock", async () => {
    const fixture = await seedAllBotMock("duesolo", { botTeams: 1 });
    const store = testStore();
    const driver = createMockBotDriver({ db, store });
    await store.startDraft(fixture.draftId);
    const humanTeamId = fixture.teamIds[0]!;

    let state = (await store.getDraftState(fixture.draftId))!;
    let botTurnsPriced = 0;
    let humanTurnsRefused = 0;
    for (let i = 0; i < 12 && state.phase !== "complete"; i += 1) {
      const onClock = teamOnClock(state)!;
      const due = await driver.dueBotPick(state);
      if (onClock === humanTeamId) {
        expect(due).toBeNull();
        humanTurnsRefused += 1;
        const taken = new Set(state.picks.map((pick) => pick.playerId));
        const filled = new Set(state.picks.filter((pick) => pick.teamId === humanTeamId).map((pick) => pick.playerId.slice(0, 2)));
        const playerId = ["qb1", "qb2", "rb1", "rb2", "wr1", "wr2"].find((id) => !taken.has(id) && !filled.has(id.slice(0, 2)))!;
        const picked = await store.applyAction(fixture.draftId, {
          v: DRAFT_ACTION_VERSION,
          type: "MAKE_PICK",
          timestamp: now,
          teamId: humanTeamId,
          playerId,
        });
        if (!picked.ok) throw new Error(picked.reason);
        state = picked.state;
        continue;
      }
      // The bot's pick is due its own seeded delay after its turn began — a lone human's room
      // prices exactly like a shared one.
      expect(due).not.toBeNull();
      const expectedDelayMs = botThinkDelayMs(30, rngFor(FIXTURE_BOT_SEED, `${onClock}:delay:${state.pickNumber}`));
      expect(due!.dueAtMs).toBe(Date.parse(state.turnStartedAt!) + expectedDelayMs);
      expect(expectedDelayMs).toBeGreaterThan(0);
      botTurnsPriced += 1;
      const applied = await store.applyAction(fixture.draftId, {
        v: DRAFT_ACTION_VERSION,
        type: "MAKE_PICK",
        timestamp: new Date(Math.ceil(due!.dueAtMs)).toISOString(),
        teamId: due!.teamId,
        playerId: due!.choosePick()!,
      });
      if (!applied.ok) throw new Error(applied.reason);
      state = applied.state;
    }
    expect(state.phase).toBe("complete");
    expect(botTurnsPriced).toBeGreaterThan(0);
    expect(humanTurnsRefused).toBeGreaterThan(0);
  });

  it("answers null with no turn running and null once the room's sidecar is gone", async () => {
    const fixture = await seedAllBotMock("duenone");
    const store = testStore();
    const driver = createMockBotDriver({ db, store });
    const scheduled = (await store.getDraftState(fixture.draftId))!;
    expect(await driver.dueBotPick(scheduled)).toBeNull();

    await store.startDraft(fixture.draftId);
    const started = (await store.getDraftState(fixture.draftId))!;
    await db.delete(mockRooms).where(eq(mockRooms.leagueId, fixture.leagueId));
    expect(await driver.dueBotPick(started)).toBeNull();
  });
});
