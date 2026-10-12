import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://commish:commish@localhost:5433/commish_test";
  process.env.REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
});

vi.mock("@/lib/auth/current-user", () => ({
  getCurrentUser: vi.fn(),
  requireCurrentUser: vi.fn(),
}));

import { createTestDb } from "@research/db/test-db";
import { truncateAll } from "@/db/test-db";
import { nflPlayers, playerCrosswalk, players, preseasonProjections } from "@research/db/schema";
import { BOARD_SOURCE } from "@research/projections/preseason/board-store";
import { PRODUCT_SEASON } from "@research/projections/preseason/current";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getDraftStore } from "@/draft-service";
import { seedDraftFixture, SPRINT_ROSTER_SLOTS } from "@/draft-service/test-support";
import { resetAdvisorMemoForTests } from "@/draft-service/assistant/memo";
import { GET as getAssistant } from "./route";

const db = createTestDb();
const DRAFT_ID = "draft_assistant_api";
const params = Promise.resolve({ draftId: DRAFT_ID });
const url = `http://test/api/drafts/${DRAFT_ID}/assistant`;

const signedInAs = (id: string | null) =>
  vi.mocked(getCurrentUser).mockResolvedValue(
    id === null ? null : { id, email: `${id}@test.local`, displayName: id, experienceTier: "beginner", avatarUrl: null, createdAt: "2026-09-01T00:00:00.000Z", isAdmin: false },
  );

async function fixture() {
  const f = await seedDraftFixture(db, {
    draftId: DRAFT_ID, leagueId: "league_assistant_api", format: "snake", teamCount: 2,
    slotConfig: SPRINT_ROSTER_SLOTS, kickoffAt: new Date("2026-09-10T17:00:00.000Z"), auctionBudget: null,
  });
  const asOf = new Date("2026-09-01T00:00:00.000Z");
  const positions = ["QB", "RB", "WR", "QB", "RB", "WR"] as const; // 2-team sprint roster: one of each per team
  await db.insert(nflPlayers).values(positions.map((position, i) => ({ id: `nfl-p${i}`, name: `Player ${i}`, position })));
  await db.insert(players).values(positions.map((position, i) => ({ id: `p${i}`, name: `Player ${i}`, position, nflTeam: "SF" })));
  await db.insert(playerCrosswalk).values(positions.map((_, i) => ({ playerId: `p${i}`, nflPlayerId: `nfl-p${i}`, method: "espn_id", resolvedAt: new Date() })));
  await db.insert(preseasonProjections).values(
    positions.map((position, i) => ({
      season: PRODUCT_SEASON, source: BOARD_SOURCE, playerId: `nfl-p${i}`, rank: i + 1, positionRank: 1, projectedPoints: 300 - i * 10,
      valueOverReplacement: 0, valueRank: i + 1, expectedGames: 17, floorPoints: 0, medianPoints: 0, ceilingPoints: 0, tier: 0, asOf,
    })),
  );
  return f;
}

beforeEach(async () => {
  await truncateAll(db);
  getDraftStore().invalidate(DRAFT_ID);
  resetAdvisorMemoForTests();
  vi.mocked(getCurrentUser).mockReset();
});

describe("GET /api/drafts/[draftId]/assistant", () => {
  it("answers 401 JSON when nobody is signed in", async () => {
    await fixture();
    signedInAs(null);
    const response = await getAssistant(new Request(url), { params });
    expect(response.status).toBe(401);
  });

  it("answers 403 for a signed-in stranger with no team in this league", async () => {
    await fixture();
    signedInAs("stranger");
    const response = await getAssistant(new Request(url), { params });
    expect(response.status).toBe(403);
  });

  it("answers 409 when the draft has not started yet", async () => {
    const f = await fixture();
    signedInAs(f.userIds[0]!);
    const response = await getAssistant(new Request(url), { params });
    expect(response.status).toBe(409);
    expect((await response.json()).ok).toBe(false);
  });

  it("answers 200 with the on-clock seat's advisor view once the draft is running", async () => {
    const f = await fixture();
    const started = await getDraftStore().startDraft(DRAFT_ID);
    if (!started.ok) throw new Error(started.reason);
    const onClockUserId = f.userIds[f.teamIds.indexOf(started.state.draftOrder[0]!)]!;
    signedInAs(onClockUserId);

    const response = await getAssistant(new Request(url), { params });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.data.pickNumber).toBe(1);
    expect(body.data.onTheClock).toBe(true);
    expect(body.data.pick.playerId).toMatch(/^p\d$/);
    expect(typeof body.data.pick.why).toBe("string");
    expect(body.data.picksUntilYourTurn).toBe(0);
    expect(body.data.stamp.computedAtPick).toBe(1);
    expect(body.data.runs).toBeGreaterThan(0);
    expect(body.data.odds.pickNumber).toBe(4);
    expect(Object.keys(body.data.odds.survived).length).toBe(6);
    expect(body.data.voice).toBeUndefined();
    expect(body.data.plan).toBeUndefined();
  });
});
