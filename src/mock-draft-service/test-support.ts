import { and, eq } from "drizzle-orm";
import { expect } from "vitest";
import type { Db } from "@research-ts/db/client";
import { players } from "@research-ts/db/schema";
import { leagues, mockRooms, teams, users } from "@/db/schema";
import type { Clock } from "@research-ts/domain/timing";
import { createDraftStore } from "@/draft-service/store";
import { claimMockSeat, type MockLifecycleDeps } from "./claim";
import { createMockRoom, type CreateMockRoomResult } from "./creation";

/**
 * Shared test support for the mock lifecycle writers, the same helper-class idiom the money
 * writers keep (`@/money-service/test-support`): a refusal is only a refusal if the database can
 * prove nothing landed (`expectNoMockRoomCreated`, `expectNoSeatClaimed`), and a fixture is only
 * honest if it goes through the real writers (`seedLobbyMock` calls `createMockRoom` and
 * `claimMockSeat`, never a hand-rolled INSERT that could drift from what production writes).
 */

/** One fixed instant for every mock lifecycle test — the outermost edge is the only place a wall
 *  clock is allowed, and a test's edge is this constant. */
export const MOCK_TEST_CLOCK: Clock = { now: () => "2026-08-25T12:00:00.000Z" };

/** Module-level counters, NOT per-deps-instance: two `mockLifecycleDeps` builds inside one test
 *  (a fixture's and the test's own) must never mint the same league id or share code. */
let idCounter = 0;
let randomState = 1;

/**
 * The five collaborators every lifecycle writer draws from, built for a test: a real
 * `DraftStore` over `db` (no Redis — publish is a stub), the fixed clock, deterministic ids, a
 * fixed bot seed and a deterministic share-code source. Override any of them per test.
 */
export function mockLifecycleDeps(db: Db, overrides: Partial<MockLifecycleDeps> = {}): MockLifecycleDeps {
  const clock = overrides.clock ?? MOCK_TEST_CLOCK;
  return {
    // `deliverNotice` is deliberately NOT stubbed: a mock draft creates no notice (ruling 2), so
    // the store's default is provably never called — a stub here would be dead test machinery.
    store: createDraftStore({ db, publish: async () => "0-0", clock }),
    clock,
    newId: () => `mock_id_${++idCounter}`,
    newSeed: () => 7,
    // A tiny LCG: deterministic across a run, varied enough that two rooms in one test never
    // collide on a share code.
    random: () => {
      randomState = (randomState * 9301 + 49297) % 233280;
      return randomState / 233280;
    },
    ...overrides,
  };
}

/**
 * Two hundred players across all six positions — enough that `reduceStart`'s own pool-size rule
 * (`pool >= teams × roster slots`; a 12-team standard room needs 180) admits the widest room a
 * mock offers, through the REAL `buildDraftPool` a start snapshots.
 */
export async function seedPracticePlayers(db: Db): Promise<void> {
  const perPosition = [
    ["QB", 30],
    ["RB", 60],
    ["WR", 60],
    ["TE", 20],
    ["K", 15],
    ["DEF", 15],
  ] as const;
  await db.insert(players).values(
    perPosition.flatMap(([position, count]) =>
      Array.from({ length: count }, (_, i) => ({ id: `${position.toLowerCase()}${i + 1}`, name: `${position} ${i + 1}`, position, nflTeam: "FA" })),
    ),
  );
}

export interface SeedLobbyMockInput {
  readonly teamCount: number;
  /** How many human seats are taken, host included — `1` seeds the host alone. */
  readonly humans: number;
  /** Moves `mock_rooms.starts_at` relative to `MOCK_TEST_CLOCK` after the room exists — the
   *  ticker tests' way of making a room due (negative) or far off (positive). */
  readonly startsAtOffsetMs?: number;
}

export interface SeededLobbyMock {
  readonly leagueId: string;
  readonly draftId: string;
  readonly shareCode: string;
  readonly hostUserId: string;
  readonly hostTeamId: string;
  readonly humanUserIds: readonly string[];
}

/**
 * A `lobby` room with `humans` of `teamCount` seats claimed, built through the REAL writers:
 * `createMockRoom` for the host, `claimMockSeat` for everyone after — so every invariant those
 * writers hold (the share code, the early-start stamp, the unique membership index) holds for
 * the fixture too.
 */
export async function seedLobbyMock(db: Db, input: SeedLobbyMockInput): Promise<SeededLobbyMock> {
  const stamp = ++idCounter;
  const humanUserIds = Array.from({ length: input.humans }, (_, i) => `lobby_${stamp}_human_${i + 1}`);
  await db.insert(users).values(humanUserIds.map((id) => ({ id, email: `${id}@test.local`, displayName: id })));

  const deps = mockLifecycleDeps(db);
  const created = await createMockRoom(
    db,
    { hostUserId: humanUserIds[0]!, mode: "lobby", teamCount: input.teamCount, pickSeconds: 60, scoringPreset: "ppr", rosterShape: "standard" },
    deps,
  );
  expect(created).toMatchObject({ ok: true });
  const room = created as Extract<CreateMockRoomResult, { ok: true }>;

  for (const userId of humanUserIds.slice(1)) {
    const claimed = await claimMockSeat(db, { code: room.shareCode, userId }, deps);
    expect(claimed).toMatchObject({ ok: true });
  }

  if (input.startsAtOffsetMs !== undefined) {
    await db
      .update(mockRooms)
      .set({ startsAt: new Date(Date.parse(MOCK_TEST_CLOCK.now()) + input.startsAtOffsetMs) })
      .where(eq(mockRooms.leagueId, room.leagueId));
  }

  return {
    leagueId: room.leagueId,
    draftId: room.draftId,
    shareCode: room.shareCode,
    hostUserId: humanUserIds[0]!,
    hostTeamId: room.teamId,
    humanUserIds,
  };
}

/**
 * Proves a refused (or failed) creation left this host with nothing: no `mock_rooms` row and no
 * mock league commissioned by them — scoped to the host rather than asserted table-wide, so a
 * test that already holds an earlier, successful room can still prove the SECOND creation wrote
 * nothing.
 */
export async function expectNoMockRoomCreated(db: Db, hostUserId: string): Promise<void> {
  expect(await db.select({ leagueId: mockRooms.leagueId }).from(mockRooms).where(eq(mockRooms.hostUserId, hostUserId))).toEqual([]);
  expect(
    await db
      .select({ id: leagues.id })
      .from(leagues)
      .where(and(eq(leagues.isMock, true), eq(leagues.commissionerUserId, hostUserId))),
  ).toEqual([]);
}

/** Proves a refused claim took no seat: no `teams` row for this person in this league. */
export async function expectNoSeatClaimed(db: Db, leagueId: string, userId: string): Promise<void> {
  expect(await db.select({ id: teams.id }).from(teams).where(and(eq(teams.leagueId, leagueId), eq(teams.userId, userId)))).toEqual([]);
}
