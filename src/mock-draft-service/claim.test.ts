import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { DbTx } from "@research-ts/db/client";
import { createTestDb, expectRejectionMatching, recordStatements } from "@research-ts/db/test-db";
import { truncateAll } from "@/db/test-db";
import { drafts, mockRooms, teams, users } from "@/db/schema";
import { copyViolations } from "@/integrity/copy-rules";
import { MOCK_CONFIG } from "@/mock-draft/config";
import { claimMockSeat, claimMockSeatInTx, MOCK_REFUSALS } from "./claim";
import { MOCK_TEST_CLOCK, expectNoSeatClaimed, mockLifecycleDeps, seedLobbyMock } from "./test-support";

const db = createTestDb();
const NOW_MS = Date.parse(MOCK_TEST_CLOCK.now());

beforeEach(async () => {
  await truncateAll(db);
});

async function seedClaimant(id: string): Promise<string> {
  await db.insert(users).values({ id, email: `${id}@test.local`, displayName: `Claimant ${id}` });
  return id;
}

describe("claimMockSeat", () => {
  it("seats a stranger holding the share code, and hands back the room's own ids", async () => {
    const room = await seedLobbyMock(db, { teamCount: 8, humans: 1 });
    const userId = await seedClaimant("u_claimer");

    const out = await claimMockSeat(db, { code: room.shareCode, userId }, mockLifecycleDeps(db));

    expect(out).toMatchObject({ ok: true, alreadySeated: false, leagueId: room.leagueId, draftId: room.draftId });
    const [team] = await db.select({ name: teams.name }).from(teams).where(eq(teams.userId, userId));
    expect(team).toMatchObject({ name: "Claimant u_claimer" });
  });

  it("refuses the thirteenth claim with no seat taken and no row written", async () => {
    const room = await seedLobbyMock(db, { teamCount: 12, humans: 12 });
    const userId = await seedClaimant("u13");

    const out = await claimMockSeat(db, { code: room.shareCode, userId }, mockLifecycleDeps(db));

    expect(out).toEqual({ ok: false, status: 409, reason: MOCK_REFUSALS.full });
    await expectNoSeatClaimed(db, room.leagueId, "u13");
  });

  it("treats a second claim by the same person as re-entry, not an error", async () => {
    const room = await seedLobbyMock(db, { teamCount: 8, humans: 1 });
    const userId = await seedClaimant("u_twice");
    const deps = mockLifecycleDeps(db);

    const first = await claimMockSeat(db, { code: room.shareCode, userId }, deps);
    const second = await claimMockSeat(db, { code: room.shareCode, userId }, deps);

    expect(first).toMatchObject({ ok: true, alreadySeated: false });
    expect(second).toMatchObject({ ok: true, alreadySeated: true });
    expect((second as { teamId: string }).teamId).toBe((first as { teamId: string }).teamId);
  });

  it("welcomes a seated member back even after the draft starts — re-entry answers before the started refusal", async () => {
    const room = await seedLobbyMock(db, { teamCount: 8, humans: 2 });
    await db.update(drafts).set({ status: "in_progress" }).where(eq(drafts.id, room.draftId));

    const out = await claimMockSeat(db, { code: room.shareCode, userId: room.humanUserIds[1]! }, mockLifecycleDeps(db));

    expect(out).toMatchObject({ ok: true, alreadySeated: true, draftId: room.draftId });
  });

  it("refuses a stranger once the draft has started, with no seat taken", async () => {
    const room = await seedLobbyMock(db, { teamCount: 8, humans: 1 });
    const userId = await seedClaimant("u_late");
    await db.update(drafts).set({ status: "in_progress" }).where(eq(drafts.id, room.draftId));

    const out = await claimMockSeat(db, { code: room.shareCode, userId }, mockLifecycleDeps(db));

    expect(out).toEqual({ ok: false, status: 409, reason: MOCK_REFUSALS.started });
    await expectNoSeatClaimed(db, room.leagueId, userId);
  });

  it("answers 404 for a code that names nothing", async () => {
    const userId = await seedClaimant("u_lost");
    const out = await claimMockSeat(db, { code: "NOPE42", userId }, mockLifecycleDeps(db));
    expect(out).toEqual({ ok: false, status: 404, reason: MOCK_REFUSALS.missing });
  });

  it("pulls starts_at forward to now + earlyStartGraceSeconds the instant the last seat goes human-held", async () => {
    const room = await seedLobbyMock(db, { teamCount: 2, humans: 1 });
    const userId = await seedClaimant("u_filler");

    const out = await claimMockSeat(db, { code: room.shareCode, userId }, mockLifecycleDeps(db));

    expect(out).toMatchObject({ ok: true });
    const [row] = await db.select({ startsAt: mockRooms.startsAt }).from(mockRooms).where(eq(mockRooms.leagueId, room.leagueId));
    expect(row!.startsAt.getTime()).toBe(NOW_MS + MOCK_CONFIG.earlyStartGraceSeconds * 1000);
  });

  it("never pushes an earlier window BACK: the stamp is guarded, forward-only", async () => {
    const room = await seedLobbyMock(db, { teamCount: 2, humans: 1, startsAtOffsetMs: -1000 });
    const userId = await seedClaimant("u_filler_late");

    const out = await claimMockSeat(db, { code: room.shareCode, userId }, mockLifecycleDeps(db));

    expect(out).toMatchObject({ ok: true });
    const [row] = await db.select({ startsAt: mockRooms.startsAt }).from(mockRooms).where(eq(mockRooms.leagueId, room.leagueId));
    expect(row!.startsAt.getTime()).toBe(NOW_MS - 1000);
  });

  it("leaves the window alone while seats remain open", async () => {
    const room = await seedLobbyMock(db, { teamCount: 8, humans: 1 });
    const userId = await seedClaimant("u_second");

    await claimMockSeat(db, { code: room.shareCode, userId }, mockLifecycleDeps(db));

    const [row] = await db.select({ startsAt: mockRooms.startsAt }).from(mockRooms).where(eq(mockRooms.leagueId, room.leagueId));
    expect(row!.startsAt.getTime()).toBe(NOW_MS + MOCK_CONFIG.fillWindowSeconds * 1000);
  });

  it("writes not one audit, notice or money statement for a claim — ruling 2, held by the statement log", async () => {
    const room = await seedLobbyMock(db, { teamCount: 8, humans: 1 });
    const userId = await seedClaimant("u_quiet");

    const statements = await recordStatements(db, async (logged) => {
      const out = await claimMockSeat(logged, { code: room.shareCode, userId }, mockLifecycleDeps(logged));
      expect(out).toMatchObject({ ok: true });
    });

    expect(statements.filter((s) => /"(audit_\w+|member_notices|money_\w+)"/.test(s))).toHaveLength(0);
  });

  it("surfaces the driver's own error when the claimant does not exist, with no seat row behind it", async () => {
    const room = await seedLobbyMock(db, { teamCount: 8, humans: 1 });
    await expectRejectionMatching(claimMockSeat(db, { code: room.shareCode, userId: "u_ghost" }, mockLifecycleDeps(db)), /foreign key/i);
    await expectNoSeatClaimed(db, room.leagueId, "u_ghost");
  });
});

/**
 * The two guards real Postgres cannot reach — a `mock_rooms` row whose league (or draft)
 * vanished between the un-locked share-code read and the `leagues FOR UPDATE` — put into exactly
 * that state with a narrow stub `DbTx`, the `lockAnchor` discipline the coverage gate's own
 * docblock (`vitest.config.mts`) prescribes. READ COMMITTED gives each statement its own
 * snapshot, so the interleaving is real even though no test can schedule it.
 */
describe("claimMockSeatInTx — the vanished-room guards", () => {
  function stubTx(results: readonly (readonly unknown[])[]): DbTx {
    let i = 0;
    const step = () => {
      const rows = results[i++] ?? [];
      const chain = {
        from: () => chain,
        where: () => chain,
        for: () => chain,
        then: (resolve: (rows: readonly unknown[]) => void) => resolve(rows),
      };
      return chain;
    };
    return { select: step } as unknown as DbTx;
  }

  const deps = { clock: MOCK_TEST_CLOCK, newId: () => "team_stub" };

  it("answers 404 when the league is gone by the time the lock is asked for", async () => {
    const out = await claimMockSeatInTx(stubTx([[{ leagueId: "lg" }], []]), { code: "C", userId: "u" }, deps);
    expect(out).toEqual({ ok: false, status: 404, reason: MOCK_REFUSALS.missing });
  });

  it("answers 404 when the draft row is gone under the lock", async () => {
    const out = await claimMockSeatInTx(stubTx([[{ leagueId: "lg" }], [{ id: "lg", teamCount: 8 }], []]), { code: "C", userId: "u" }, deps);
    expect(out).toEqual({ ok: false, status: 404, reason: MOCK_REFUSALS.missing });
  });
});

describe("MOCK_REFUSALS — the practice door's own sentences", () => {
  it.each(Object.entries(MOCK_REFUSALS))("%s passes the house copy rules", (_key, sentence) => {
    expect(copyViolations(sentence)).toEqual([]);
  });
});
