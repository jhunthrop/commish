import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb, truncateAll } from "@/db/test-db";
import { drafts, leagues, users } from "@/db/schema";
import type { Clock } from "@/domain/timing";
import { MOCK_CONFIG } from "@/mock-draft/config";
import { seedLobbyMock } from "./test-support";
import { listMockWireItems } from "./wire";

const db = createTestDb();

/** The one instant every test in this file treats as "now" — injected, never read from a wall
 *  clock, per the service modules' own "no ambient clock" rule. */
const NOW = "2026-08-26T12:00:00.000Z";
const clock: Clock = { now: () => NOW };
const nowMs = Date.parse(NOW);

const MS_PER_MINUTE = 60_000;

beforeEach(async () => {
  await truncateAll(db);
});

/** Flips a room's draft to `in_progress` and stamps its `kickoff_at` directly — the same
 *  hand-write every other lobby test in this directory uses (`lobby.test.ts`'s own
 *  `db.update(drafts).set({ status: "in_progress" })`), since `createMockRoom`/`claimMockSeat`
 *  never advance a draft's status themselves; the real driver (`./driver`) does, on its own
 *  ticker cadence, which this file has no reason to run. */
async function markInProgress(draftId: string, kickoffAt: Date): Promise<void> {
  await db
    .update(drafts)
    .set({ status: "in_progress", kickoffAt })
    .where(eq(drafts.id, draftId));
}

describe("listMockWireItems", () => {
  it("renders nothing at all when the lobby is genuinely quiet — no fabricated item, ever", async () => {
    await seedLobbyMock(db, { teamCount: 8, humans: 1 });

    expect(await listMockWireItems(db, clock)).toEqual([]);
  });

  it("reports a room that went in_progress inside the window, with a coarse ago and no seat claim ever named", async () => {
    const room = await seedLobbyMock(db, { teamCount: 12, humans: 3 });
    await markInProgress(room.draftId, new Date(nowMs - 4 * MS_PER_MINUTE));

    const items = await listMockWireItems(db, clock);

    // Still `in_progress` right now, so it is BOTH the wire's one running mock AND its one
    // recent fill — the two items answer two different questions off the identical row.
    expect(items).toEqual([
      { kind: "mocks_running", count: 1 },
      { kind: "mock_filled", teamCount: 12, agoMs: 4 * MS_PER_MINUTE },
    ]);
  });

  it("excludes a fill outside the window from mock_filled, though mocks_running still counts the room (it is still drafting)", async () => {
    const room = await seedLobbyMock(db, { teamCount: 8, humans: 1 });
    await markInProgress(room.draftId, new Date(nowMs - (MOCK_CONFIG.wire.filledWindowMs + MS_PER_MINUTE)));

    expect(await listMockWireItems(db, clock)).toEqual([{ kind: "mocks_running", count: 1 }]);
  });

  it("never surfaces a real league's own in_progress draft, only a mock's", async () => {
    // `seedLobbyMock` only ever writes mock leagues (`is_mock = true` by construction); this
    // proves the query's own `leagues.is_mock` join predicate, not just the fixture's shape, by
    // reaching straight into `drafts`/`leagues` for a REAL league the fixture never touches.
    await db
      .insert(users)
      .values({
        id: "real_owner",
        email: "real_owner@test.local",
        displayName: "Real Owner",
      });
    await db.insert(leagues).values({
      id: "real_lg",
      name: "Real League",
      format: "snake",
      teamCount: 10,
      isPublicMatchmade: false,
      isMock: false,
      commissionerUserId: "real_owner",
    });
    await db
      .insert(drafts)
      .values({
        id: "real_draft",
        leagueId: "real_lg",
        format: "snake",
        status: "in_progress",
        kickoffAt: new Date(nowMs - MS_PER_MINUTE),
      });

    expect(await listMockWireItems(db, clock)).toEqual([]);
  });

  it("counts every in_progress mock draft platform-wide for mocks_running, leading the list", async () => {
    const roomA = await seedLobbyMock(db, { teamCount: 8, humans: 1 });
    const roomB = await seedLobbyMock(db, { teamCount: 10, humans: 1 });
    // Old enough that mock_filled would exclude it — proves mocks_running has no window at all.
    await markInProgress(
      roomA.draftId,
      new Date(nowMs - (MOCK_CONFIG.wire.filledWindowMs + MS_PER_MINUTE)),
    );
    await markInProgress(
      roomB.draftId,
      new Date(nowMs - (MOCK_CONFIG.wire.filledWindowMs + MS_PER_MINUTE)),
    );

    expect(await listMockWireItems(db, clock)).toEqual([
      { kind: "mocks_running", count: 2 },
    ]);
  });

  it("orders mocks_running first, then mock_filled items newest first", async () => {
    const older = await seedLobbyMock(db, { teamCount: 8, humans: 1 });
    const newer = await seedLobbyMock(db, { teamCount: 10, humans: 1 });
    // Still drafting, but its fill fell outside mock_filled's own window — counted by
    // mocks_running (no window at all) without adding a THIRD mock_filled item, which would
    // make this test's ordering claim ambiguous.
    const longRunning = await seedLobbyMock(db, { teamCount: 12, humans: 1 });
    await markInProgress(older.draftId, new Date(nowMs - 20 * MS_PER_MINUTE));
    await markInProgress(newer.draftId, new Date(nowMs - 2 * MS_PER_MINUTE));
    await markInProgress(longRunning.draftId, new Date(nowMs - (MOCK_CONFIG.wire.filledWindowMs + MS_PER_MINUTE)));

    const items = await listMockWireItems(db, clock);

    expect(items).toEqual([
      { kind: "mocks_running", count: 3 },
      { kind: "mock_filled", teamCount: 10, agoMs: 2 * MS_PER_MINUTE },
      { kind: "mock_filled", teamCount: 8, agoMs: 20 * MS_PER_MINUTE },
    ]);
  });

  it("caps the total at MOCK_CONFIG.wire.maxItems", async () => {
    for (let i = 0; i < MOCK_CONFIG.wire.maxItems + 3; i += 1) {
      const room = await seedLobbyMock(db, { teamCount: 8, humans: 1 });
      await markInProgress(
        room.draftId,
        new Date(nowMs - (i + 1) * MS_PER_MINUTE),
      );
    }

    const items = await listMockWireItems(db, clock);

    expect(items).toHaveLength(MOCK_CONFIG.wire.maxItems);
  });
});
