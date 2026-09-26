import { and, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb, truncateAll } from "@/db/test-db";
import { drafts, mockRooms, players, teams, users } from "@/db/schema";
import { DRAFT_ACTION_VERSION } from "@/domain/draft";
import type { Clock } from "@/domain/timing";
import { teamOnClock } from "@/draft-engine";
import { createDraftStore, type DraftStore } from "@/draft-service/store";
import { seedDraftFixture, SPRINT_ROSTER_SLOTS } from "@/draft-service/test-support";
import { botThinkDelayMs } from "@/mock-draft/bots";
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

    const outcomes = await startDueMockRooms(db, { store, clock, newId: () => crypto.randomUUID() });

    const state = await store.getDraftState(room.draftId);
    expect(state!.phase).toBe("in_progress");
    expect(await countBotTeams(room.leagueId)).toBe(6);
    expect(outcomes).toContainEqual({ leagueId: room.leagueId, started: true, draftId: room.draftId });
  });

  it("leaves a lobby whose fill window has not fired untouched", async () => {
    await seedPracticePlayers(db);
    const room = await seedLobbyMock(db, { teamCount: 8, humans: 2, startsAtOffsetMs: 60_000 });
    await startDueMockRooms(db, { store: testStore(), clock, newId: () => crypto.randomUUID() });

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
    await startDueMockRooms(db, { store, clock, newId: () => crypto.randomUUID() });
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

describe("botTurn (the bot on the clock, priced: the store's batch and the advance funnel both read it)", () => {
  it("prices a paced bot turn at turnStartedAt + the seeded think-delay, naming the exact pick the live drive lands", async () => {
    const fixture = await seedAllBotMock("duecalc");
    const store = testStore();
    const driver = createMockBotDriver({ db });
    await store.startDraft(fixture.draftId);
    const state = (await store.getDraftState(fixture.draftId))!;
    const onClock = state.draftOrder[0]!;

    const due = await driver.botTurn(state);
    expect(due).not.toBeNull();
    expect(due!.teamId).toBe(onClock);
    // The identical stream the live driver derives: the room's stored seed, this pick's own key.
    expect(due!.revealAtMs).toBe(Date.parse(state.turnStartedAt!) + botThinkDelayMs(30, rngFor(FIXTURE_BOT_SEED, `${onClock}:delay:1`)));
    // The selection thunk is pure: asking twice answers identically and moves no cursor.
    const playerId = due!.choosePick();
    expect(playerId).not.toBeNull();
    expect(due!.choosePick()).toBe(playerId);

    // One computation, one writer: the store stamps THIS pick at the reveal instant.
    const applied = await store.applyAction(fixture.draftId, { v: DRAFT_ACTION_VERSION, type: "MAKE_PICK", timestamp: new Date(Math.ceil(due!.revealAtMs)).toISOString(), teamId: due!.teamId, playerId: playerId! });
    if (!applied.ok) throw new Error(applied.reason);
    const after = (await store.getDraftState(fixture.draftId))!;
    expect(after.picks[0]!.playerId).toBe(playerId);
  });

  it("prices a lone human's room's bot turn at the same seeded delay as any room (no zero-delay lane) and answers null while the human holds the clock", async () => {
    const fixture = await seedAllBotMock("duesolo", { botTeams: 1 });
    const store = testStore();
    const driver = createMockBotDriver({ db });
    await store.startDraft(fixture.draftId);
    const humanTeamId = fixture.teamIds[0]!;

    let state = (await store.getDraftState(fixture.draftId))!;
    let botTurnsPriced = 0;
    let humanTurnsRefused = 0;
    for (let i = 0; i < 12 && state.phase !== "complete"; i += 1) {
      const onClock = teamOnClock(state)!;
      const due = await driver.botTurn(state);
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
      expect(due!.revealAtMs).toBe(Date.parse(state.turnStartedAt!) + expectedDelayMs);
      expect(expectedDelayMs).toBeGreaterThan(0);
      botTurnsPriced += 1;
      const applied = await store.applyAction(fixture.draftId, {
        v: DRAFT_ACTION_VERSION,
        type: "MAKE_PICK",
        timestamp: new Date(Math.ceil(due!.revealAtMs)).toISOString(),
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
    const driver = createMockBotDriver({ db });
    const scheduled = (await store.getDraftState(fixture.draftId))!;
    expect(await driver.botTurn(scheduled)).toBeNull();

    await store.startDraft(fixture.draftId);
    const started = (await store.getDraftState(fixture.draftId))!;
    await db.delete(mockRooms).where(eq(mockRooms.leagueId, fixture.leagueId));
    expect(await driver.botTurn(started)).toBeNull();
  });
});
