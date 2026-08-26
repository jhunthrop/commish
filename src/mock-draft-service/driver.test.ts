import { and, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb, truncateAll } from "@/db/test-db";
import { drafts, mockRooms, players, teams, users } from "@/db/schema";
import type { Clock } from "@/domain/timing";
import type { DraftState } from "@/draft-engine";
import { createDraftStore, type DraftStore } from "@/draft-service/store";
import { createDraftTicker, type DraftTicker } from "@/draft-service/ticker";
import { seedDraftFixture, SPRINT_ROSTER_SLOTS } from "@/draft-service/test-support";
import { botThinkDelaySeconds } from "@/mock-draft/bots";
import { MOCK_CONFIG } from "@/mock-draft/config";
import { rngFor } from "@/mock-draft/rng";
import { createMockRoom } from "./creation";
import { createMockBotDriver, dueMockRoomsQuery, startDueMockRooms } from "./driver";
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
    reconcileHouse: async () => ({ opened: [], refused: [] }),
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
        reason: "Something went wrong starting this practice draft.",
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

    advance(MOCK_CONFIG.botDelay.maxSeconds * 1000);
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
    const delaySeconds = botThinkDelaySeconds(30, rngFor(FIXTURE_BOT_SEED, `${onClock}:delay:1`));
    const dueAtMs = Date.parse(BASE_NOW) + delaySeconds * 1000;

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

    advance(MOCK_CONFIG.botDelay.maxSeconds * 1000);
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

  it("answers null for a draft with no team on the clock (a finished room the scan still holds)", async () => {
    const fixture = await seedAllBotMock("done");
    const store = testStore();
    await store.startDraft(fixture.draftId);
    const state = await store.getDraftState(fixture.draftId);
    const { driveBotPick } = createMockBotDriver({ db, store });
    expect(await driveBotPick({ ...state!, phase: "complete" }, now)).toBeNull();
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
    advance(MOCK_CONFIG.botDelay.maxSeconds * 1000);

    expect(await driveBotPick(stale!, now)).toEqual({ picked: true });
    // The same STALE state again: the driver re-derives the identical pick, and the real
    // admit/reduce path — judging against the FRESH log under the row lock — refuses it.
    const second = await driveBotPick(stale!, now);
    expect(second).toMatchObject({ picked: false });
    expect((second as { reason: string }).reason.length).toBeGreaterThan(0);
    expect((await store.getDraftState(fixture.draftId))!.picks).toHaveLength(1);
  });
});

describe("the whole practice round, through the real writers", () => {
  it("a solo room drafts itself to completion: bots pick on their own clocks, the host is autopicked, status never lies", async () => {
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
    // Task 4's law holds through a full driven round: a finished mock never flips `drafts.status`.
    const [draft] = await db.select({ status: drafts.status }).from(drafts).where(eq(drafts.id, room.draftId));
    expect(draft?.status).toBe("in_progress");
  });
});
