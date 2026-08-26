import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb, truncateAll } from "@/db/test-db";
import { drafts, leagues, users } from "@/db/schema";
import { claimMockSeat } from "./claim";
import { createMockRoom } from "./creation";
import { listOpenMockRooms, mockRoomSummary, myMockRooms } from "./lobby";
import { MOCK_TEST_CLOCK, mockLifecycleDeps, seedLobbyMock } from "./test-support";

const db = createTestDb();

beforeEach(async () => {
  await truncateAll(db);
});

async function seedUser(id: string): Promise<string> {
  await db.insert(users).values({ id, email: `${id}@test.local`, displayName: `User ${id}` }).onConflictDoNothing();
  return id;
}

describe("listOpenMockRooms", () => {
  it("lists a lobby room with an open seat, request-time truth off the current fill count", async () => {
    const room = await seedLobbyMock(db, { teamCount: 8, humans: 1 });

    const open = await listOpenMockRooms(db, MOCK_TEST_CLOCK);

    expect(open).toEqual([
      expect.objectContaining({
        leagueId: room.leagueId,
        shareCode: room.shareCode,
        teamCount: 8,
        seatsOpen: 7,
        pickSeconds: 60,
      }),
    ]);
  });

  it("never lists a link room — a share code is an invitation, not a listing", async () => {
    const hostId = await seedUser("u_link_host");
    const created = await createMockRoom(db, { hostUserId: hostId, mode: "link", teamCount: 8, pickSeconds: 60, scoringPreset: "ppr", rosterShape: "standard" }, mockLifecycleDeps(db));
    expect(created).toMatchObject({ ok: true });

    expect(await listOpenMockRooms(db, MOCK_TEST_CLOCK)).toEqual([]);
  });

  it("never lists a solo room — full from birth, so it never passes the open-seat filter", async () => {
    const hostId = await seedUser("u_solo_host");
    const created = await createMockRoom(db, { hostUserId: hostId, mode: "solo", teamCount: 8, pickSeconds: 60, scoringPreset: "ppr", rosterShape: "standard" }, mockLifecycleDeps(db));
    expect(created).toMatchObject({ ok: true });

    expect(await listOpenMockRooms(db, MOCK_TEST_CLOCK)).toEqual([]);
  });

  it("drops a room once it fills", async () => {
    await seedLobbyMock(db, { teamCount: 2, humans: 2 });

    expect(await listOpenMockRooms(db, MOCK_TEST_CLOCK)).toEqual([]);
  });

  it("drops a room once its draft has started", async () => {
    const room = await seedLobbyMock(db, { teamCount: 8, humans: 1 });
    await db.update(drafts).set({ status: "in_progress" }).where(eq(drafts.id, room.draftId));

    expect(await listOpenMockRooms(db, MOCK_TEST_CLOCK)).toEqual([]);
  });

  it("reads startsInMs unclamped — a room already past its window reads negative, never a fabricated zero", async () => {
    const room = await seedLobbyMock(db, { teamCount: 8, humans: 1, startsAtOffsetMs: -5_000 });

    const [open] = await listOpenMockRooms(db, MOCK_TEST_CLOCK);
    expect(open).toMatchObject({ leagueId: room.leagueId, startsInMs: -5_000 });
  });
});

describe("myMockRooms", () => {
  it("includes the caller's own room in every mode, not just lobby, with the caller's own team name (R4b)", async () => {
    const hostId = await seedUser("u_mine_link_host");
    const created = await createMockRoom(
      db,
      { hostUserId: hostId, mode: "link", teamCount: 8, pickSeconds: 30, scoringPreset: "ppr", rosterShape: "standard", teamName: "The Link Legends" },
      mockLifecycleDeps(db),
    );
    expect(created).toMatchObject({ ok: true });
    const room = created as Extract<typeof created, { ok: true }>;

    const mine = await myMockRooms(db, hostId, MOCK_TEST_CLOCK);

    expect(mine).toEqual([
      expect.objectContaining({
        leagueId: room.leagueId,
        draftId: room.draftId,
        mode: "link",
        status: "scheduled",
        teamCount: 8,
        seatsOpen: 7,
        pickSeconds: 30,
        teamName: "The Link Legends",
      }),
    ]);
  });

  it("falls back to the host's own display name for the team name when none was chosen", async () => {
    const hostId = await seedUser("u_mine_default_name_host");
    const created = await createMockRoom(db, { hostUserId: hostId, mode: "solo", teamCount: 8, pickSeconds: 30, scoringPreset: "ppr", rosterShape: "standard" }, mockLifecycleDeps(db));
    expect(created).toMatchObject({ ok: true });

    const mine = await myMockRooms(db, hostId, MOCK_TEST_CLOCK);

    expect(mine).toEqual([expect.objectContaining({ teamName: `User ${hostId}` })]);
  });

  it("never surfaces a room the caller has no seat in", async () => {
    await seedLobbyMock(db, { teamCount: 8, humans: 1 });
    const stranger = await seedUser("u_stranger");

    expect(await myMockRooms(db, stranger, MOCK_TEST_CLOCK)).toEqual([]);
  });

  it("counts every seat, not just the caller's own, in the fill total", async () => {
    const room = await seedLobbyMock(db, { teamCount: 8, humans: 3 });

    const mine = await myMockRooms(db, room.hostUserId, MOCK_TEST_CLOCK);

    expect(mine).toEqual([expect.objectContaining({ leagueId: room.leagueId, seatsOpen: 5 })]);
  });

  it("excludes a dissolved room from the caller's own list — a room that cleared itself is not history worth a row (D4)", async () => {
    const room = await seedLobbyMock(db, { teamCount: 8, humans: 1 });
    await db.update(drafts).set({ status: "dissolved" }).where(eq(drafts.id, room.draftId));

    expect(await myMockRooms(db, room.hostUserId, MOCK_TEST_CLOCK)).toEqual([]);
  });
});

describe("mockRoomSummary", () => {
  it("answers a stranger's preview of an open lobby room, with no other member ever named", async () => {
    const room = await seedLobbyMock(db, { teamCount: 8, humans: 2 });
    const stranger = await seedUser("u_summary_stranger");

    const result = await mockRoomSummary(db, room.shareCode, stranger, MOCK_TEST_CLOCK);

    expect(result).toEqual({
      ok: true,
      summary: expect.objectContaining({
        leagueId: room.leagueId,
        mode: "lobby",
        teamCount: 8,
        seatsOpen: 6,
        pickSeconds: 60,
        started: false,
        alreadySeated: false,
      }),
    });
    expect(JSON.stringify(result)).not.toContain(room.humanUserIds[1]);
  });

  it("tells a seated member they already hold a seat", async () => {
    const room = await seedLobbyMock(db, { teamCount: 8, humans: 2 });

    const result = await mockRoomSummary(db, room.shareCode, room.humanUserIds[1]!, MOCK_TEST_CLOCK);

    expect(result).toMatchObject({ ok: true, summary: { alreadySeated: true } });
  });

  it("marks a started draft as started, rather than offering a claim that would only be refused", async () => {
    const room = await seedLobbyMock(db, { teamCount: 8, humans: 1 });
    await db.update(drafts).set({ status: "in_progress" }).where(eq(drafts.id, room.draftId));
    const stranger = await seedUser("u_summary_late");

    const result = await mockRoomSummary(db, room.shareCode, stranger, MOCK_TEST_CLOCK);

    expect(result).toMatchObject({ ok: true, summary: { started: true } });
  });

  it("answers 404 for a code that names nothing, the same as claimMockSeat's own refusal", async () => {
    const stranger = await seedUser("u_summary_lost");

    expect(await mockRoomSummary(db, "NOPE99", stranger, MOCK_TEST_CLOCK)).toEqual({ ok: false, status: 404, reason: expect.any(String) });
  });

  it("answers 404 identically for a swept room as for a code that never existed — no existence oracle", async () => {
    const room = await seedLobbyMock(db, { teamCount: 8, humans: 1 });
    await db.delete(leagues).where(eq(leagues.id, room.leagueId));
    const stranger = await seedUser("u_summary_swept");

    const swept = await mockRoomSummary(db, room.shareCode, stranger, MOCK_TEST_CLOCK);
    const never = await mockRoomSummary(db, "NEVER01", stranger, MOCK_TEST_CLOCK);

    expect(swept).toEqual(never);
  });

  it("agrees with claimMockSeat's own re-entry answer for a seated member", async () => {
    const room = await seedLobbyMock(db, { teamCount: 8, humans: 1 });
    const claimant = await seedUser("u_summary_agree");
    await claimMockSeat(db, { code: room.shareCode, userId: claimant }, mockLifecycleDeps(db));

    const result = await mockRoomSummary(db, room.shareCode, claimant, MOCK_TEST_CLOCK);

    expect(result).toMatchObject({ ok: true, summary: { alreadySeated: true } });
  });
});
