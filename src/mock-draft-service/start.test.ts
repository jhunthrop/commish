import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb, expectRejectionMatching, truncateAll } from "@/db/test-db";
import { drafts, leagues, mockRooms, teams, users } from "@/db/schema";
import { currentDeadline } from "@/draft-engine";
import { MOCK_CONFIG } from "@/mock-draft/config";
import { pickBotTeamNames } from "@/mock-draft/team-names";
import { MOCK_REFUSALS } from "./claim";
import { drawBotSeats, seatBotsInTx, startMockDraft, topUpBots } from "./start";
import { MOCK_TEST_CLOCK, mockLifecycleDeps, seedLobbyMock, seedPracticePlayers } from "./test-support";

const db = createTestDb();

beforeEach(async () => {
  await truncateAll(db);
});

async function botUserIdsFor(leagueId: string): Promise<readonly string[]> {
  const rows = await db
    .select({ userId: teams.userId, isBot: users.isBot })
    .from(teams)
    .innerJoin(users, eq(users.id, teams.userId))
    .where(eq(teams.leagueId, leagueId));
  return rows.filter((row) => row.isBot).map((row) => row.userId);
}

describe("drawBotSeats", () => {
  it("draws distinct bots, never one already seated, deterministically from the seed", () => {
    const first = drawBotSeats(7, [], 5);
    const again = drawBotSeats(7, [], 5);
    expect(again).toEqual(first);
    expect(new Set(first.map((bot) => bot.id)).size).toBe(5);

    const afterTwo = drawBotSeats(7, first.slice(0, 2).map((bot) => bot.id), 3);
    expect(afterTwo).toEqual(first.slice(2, 5));

    const other = drawBotSeats(8, [], 5);
    expect(other).not.toEqual(first);
  });
});

describe("topUpBots", () => {
  it("fills every empty seat with distinct roster bots, deterministically off the room's stored seed", async () => {
    const room = await seedLobbyMock(db, { teamCount: 8, humans: 2 });
    const out = await topUpBots(db, room.leagueId, mockLifecycleDeps(db));
    expect(out).toEqual({ ok: true, added: 6 });

    const bots = await botUserIdsFor(room.leagueId);
    expect(bots).toHaveLength(6);
    expect(new Set(bots).size).toBe(6);

    // A second room under the same stored seed draws the same bots: the draw replays off
    // `mock_rooms.bot_seed`, never off a wall clock or an unseeded source.
    const twin = await seedLobbyMock(db, { teamCount: 8, humans: 2 });
    await topUpBots(db, twin.leagueId, mockLifecycleDeps(db));
    expect(await botUserIdsFor(twin.leagueId)).toEqual(bots);
  });

  it("never hands a bot the name an existing team already carries — the host's own pool-name twin (T2 review MEDIUM)", async () => {
    // The host names their team EXACTLY what the room's seed would deal first: without the
    // exclusion the first bot seated would be their twin. The fixture's stored seed is what
    // `topUpBots` re-reads, so the collision is engineered off the same deck the code draws.
    const room = await seedLobbyMock(db, { teamCount: 8, humans: 1 });
    const [{ botSeed }] = await db.select({ botSeed: mockRooms.botSeed }).from(mockRooms).where(eq(mockRooms.leagueId, room.leagueId));
    const [firstDealt] = pickBotTeamNames(botSeed!, 1);
    await db.update(teams).set({ name: firstDealt! }).where(eq(teams.leagueId, room.leagueId));

    await topUpBots(db, room.leagueId, mockLifecycleDeps(db));
    const names = (await db.select({ name: teams.name }).from(teams).where(eq(teams.leagueId, room.leagueId))).map((row) => row.name);
    expect(names).toHaveLength(8);
    expect(new Set(names).size).toBe(8); // no twin, ever
  });

  it("is idempotent by arithmetic: a second call finds no empty seat and adds nothing", async () => {
    const room = await seedLobbyMock(db, { teamCount: 8, humans: 1 });
    const deps = mockLifecycleDeps(db);
    expect(await topUpBots(db, room.leagueId, deps)).toEqual({ ok: true, added: 7 });
    expect(await topUpBots(db, room.leagueId, deps)).toEqual({ ok: true, added: 0 });
    expect(await db.select({ id: teams.id }).from(teams).where(eq(teams.leagueId, room.leagueId))).toHaveLength(8);
  });

  it("refuses a REAL league structurally: no mock_rooms row, no bot ever seated", async () => {
    await db.insert(users).values({ id: "u_real", email: "real@test.local", displayName: "Real" });
    await db.insert(leagues).values({ id: "lg_real", name: "Real League", format: "snake", teamCount: 8, commissionerUserId: "u_real" });

    const out = await topUpBots(db, "lg_real", mockLifecycleDeps(db));

    expect(out).toEqual({ ok: false, status: 409, reason: MOCK_REFUSALS.notMock });
    expect(await db.select({ id: teams.id }).from(teams).where(eq(teams.leagueId, "lg_real"))).toEqual([]);
  });

  it("answers 404 for a league that does not exist", async () => {
    expect(await topUpBots(db, "lg_ghost", mockLifecycleDeps(db))).toEqual({ ok: false, status: 404, reason: MOCK_REFUSALS.missing });
  });
});

describe("seatBotsInTx", () => {
  it("fails loudly when the roster cannot cover the empty seats, rolling the transaction back", async () => {
    const room = await seedLobbyMock(db, { teamCount: 8, humans: 1 });
    const deps = mockLifecycleDeps(db);
    await expectRejectionMatching(
      db.transaction(async (tx) => {
        await seatBotsInTx(tx, { leagueId: room.leagueId, teamCount: MOCK_CONFIG.botRoster.length + 2, botSeed: 7, newId: deps.newId });
      }),
      /cannot fill/,
    );
    // Rolled back: the room still holds only its host.
    expect(await db.select({ id: teams.id }).from(teams).where(eq(teams.leagueId, room.leagueId))).toHaveLength(1);
  });
});

describe("bot team naming", () => {
  it("names each bot team off the seeded team-name pool, sorted by bot id, never the owner's roster display name", async () => {
    const room = await seedLobbyMock(db, { teamCount: 8, humans: 2 });
    const out = await topUpBots(db, room.leagueId, mockLifecycleDeps(db));
    expect(out).toEqual({ ok: true, added: 6 });

    const [mockRoom] = await db.select({ botSeed: mockRooms.botSeed }).from(mockRooms).where(eq(mockRooms.leagueId, room.leagueId));
    const rows = await db
      .select({ userId: teams.userId, teamName: teams.name, isBot: users.isBot })
      .from(teams)
      .innerJoin(users, eq(users.id, teams.userId))
      .where(eq(teams.leagueId, room.leagueId));
    const botRows = rows.filter((row) => row.isBot);
    expect(botRows).toHaveLength(6);

    const sortedBotIds = [...botRows.map((row) => row.userId)].sort();
    const expectedNames = pickBotTeamNames(mockRoom!.botSeed, sortedBotIds.length);
    const expectedNameByBotId = new Map(sortedBotIds.map((id, i) => [id, expectedNames[i]]));

    for (const row of botRows) {
      expect(row.teamName).toBe(expectedNameByBotId.get(row.userId));
      const rosterBot = MOCK_CONFIG.botRoster.find((bot) => bot.id === row.userId);
      expect(rosterBot).toBeDefined();
      // The team name is drawn from the SEPARATE team-name pool — never the seat's owner handle.
      expect(row.teamName).not.toBe(rosterBot!.name);
    }
  });

  it("re-derives byte-identical team names on a replay: same botSeed, same drawn bots, same names", async () => {
    const room = await seedLobbyMock(db, { teamCount: 8, humans: 2 });
    await topUpBots(db, room.leagueId, mockLifecycleDeps(db));
    const twin = await seedLobbyMock(db, { teamCount: 8, humans: 2 });
    await topUpBots(db, twin.leagueId, mockLifecycleDeps(db));

    const botNamesFor = async (leagueId: string) =>
      db
        .select({ userId: teams.userId, teamName: teams.name, isBot: users.isBot })
        .from(teams)
        .innerJoin(users, eq(users.id, teams.userId))
        .where(eq(teams.leagueId, leagueId))
        .then((rows) => rows.filter((row) => row.isBot).map(({ userId, teamName }) => ({ userId, teamName })));

    // Both rooms share the SAME stored `botSeed` fixture value (`seedLobbyMock` mints a fresh
    // one per room in general, but the deterministic test seed source `mockLifecycleDeps` hands
    // out the identical sequence for identical inputs) — drawn bots and their team names must
    // match. The human seats' own team names differ between the two rooms by fixture design
    // (`seedLobbyMock`'s per-room id stamp), so only the bot rows are compared here.
    expect(await botNamesFor(room.leagueId)).toEqual(await botNamesFor(twin.leagueId));
  });
});

describe("startMockDraft", () => {
  it("tops up and starts in one call: the callable the solo path and the ticker share", async () => {
    await seedPracticePlayers(db);
    const room = await seedLobbyMock(db, { teamCount: 8, humans: 2 });
    const deps = mockLifecycleDeps(db);

    const out = await startMockDraft(db, room.leagueId, deps);

    expect(out).toEqual({ ok: true, draftId: room.draftId });
    const state = await deps.store.getDraftState(room.draftId);
    expect(state!.phase).toBe("in_progress");
    expect(state!.draftOrder).toHaveLength(8);
    expect(await botUserIdsFor(room.leagueId)).toHaveLength(6);

    // The room the caller lands on is genuinely drivable: one clock expiry through the real
    // single-writer path lands a pick, exactly as Task 6's bot driver will submit them.
    const picked = await deps.store.applyAction(room.draftId, { v: 1, type: "TIMER_EXPIRE", timestamp: currentDeadline(state!) ?? MOCK_TEST_CLOCK.now() });
    expect(picked.ok).toBe(true);
    expect((await deps.store.getDraftState(room.draftId))!.picks).toHaveLength(1);
  });

  it("survives a crash between bot top-up and start: the committed top-up is found again and the start completes", async () => {
    await seedPracticePlayers(db);
    const room = await seedLobbyMock(db, { teamCount: 8, humans: 2 });
    const deps = mockLifecycleDeps(db);

    // The crash: `topUpBots` commits, the process dies before the start ever runs.
    expect(await topUpBots(db, room.leagueId, deps)).toEqual({ ok: true, added: 6 });
    const [mid] = await db.select({ status: drafts.status }).from(drafts).where(eq(drafts.id, room.draftId));
    expect(mid?.status).toBe("scheduled");

    // The next tick: the due scan still finds a `'scheduled'` draft, the top-up arithmetic
    // finds zero empty seats, and the start completes.
    const out = await startMockDraft(db, room.leagueId, deps);
    expect(out).toEqual({ ok: true, draftId: room.draftId });
    const [after] = await db.select({ status: drafts.status }).from(drafts).where(eq(drafts.id, room.draftId));
    expect(after?.status).toBe("in_progress");
    expect(await db.select({ id: teams.id }).from(teams).where(eq(teams.leagueId, room.leagueId))).toHaveLength(8);
  });

  it("hands a top-up refusal straight through", async () => {
    expect(await startMockDraft(db, "lg_ghost", mockLifecycleDeps(db))).toEqual({ ok: false, status: 404, reason: MOCK_REFUSALS.missing });
  });

  it("answers 404 when the draft row is gone", async () => {
    const room = await seedLobbyMock(db, { teamCount: 8, humans: 1 });
    await db.delete(drafts).where(eq(drafts.id, room.draftId));
    expect(await startMockDraft(db, room.leagueId, mockLifecycleDeps(db))).toEqual({ ok: false, status: 404, reason: MOCK_REFUSALS.missing });
  });

  it("maps the store's own refusal for a draft already in progress", async () => {
    await seedPracticePlayers(db);
    const room = await seedLobbyMock(db, { teamCount: 8, humans: 1 });
    const deps = mockLifecycleDeps(db);
    expect(await startMockDraft(db, room.leagueId, deps)).toMatchObject({ ok: true });

    const out = await startMockDraft(db, room.leagueId, deps);
    expect(out).toMatchObject({ ok: false, status: 409 });
  });
});
