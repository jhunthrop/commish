import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://commish:commish@localhost:5433/commish_test";
  process.env.REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
});

vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: vi.fn() }));

import { createTestDb } from "@research-ts/db/test-db";
import { truncateAll } from "@/db/test-db";
import { nflPlayers, playerCrosswalk, players, preseasonProjections } from "@research-ts/db/schema";
import { users } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth/current-user";
import { createSheet } from "@/draft-hq/sheet/service";
import { BOARD_SOURCE } from "@research-ts/projections/preseason/board-store";
import { PRODUCT_SEASON } from "@research-ts/projections/preseason/current";
import { POST } from "./route";

const db = createTestDb();

function signedInAs(id: string) {
  vi.mocked(getCurrentUser).mockResolvedValue({
    id,
    email: `${id}@test.local`,
    displayName: id,
    experienceTier: "beginner",
    avatarUrl: null,
    createdAt: "2026-09-01T00:00:00.000Z",
    isAdmin: false,
  });
}

function req(body: unknown): Request {
  return new Request("http://test/api/draft/sheets/x/seed", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}
function ctx(sheetId: string) {
  return { params: Promise.resolve({ sheetId }) };
}

beforeEach(async () => {
  await truncateAll(db);
  vi.mocked(getCurrentUser).mockReset();
  await db.insert(users).values({ id: "u1", email: "u1@test.local", displayName: "u1" });
  signedInAs("u1");
});

afterAll(async () => {
  await truncateAll(db);
});

describe("POST /api/draft/sheets/[sheetId]/seed", () => {
  it("seeds from the board in rank order", async () => {
    await db.insert(nflPlayers).values([
      { id: "00-1", name: "Top Guy", position: "RB" },
      { id: "00-2", name: "Second Guy", position: "WR" },
    ]);
    await db.insert(players).values([
      { id: "p1", name: "Top Guy", position: "RB", nflTeam: "SF" },
      { id: "p2", name: "Second Guy", position: "WR", nflTeam: "DAL" },
    ]);
    await db.insert(playerCrosswalk).values([
      { playerId: "p1", nflPlayerId: "00-1", method: "espn_id", resolvedAt: new Date() },
      { playerId: "p2", nflPlayerId: "00-2", method: "espn_id", resolvedAt: new Date() },
    ]);
    await db.insert(preseasonProjections).values([
      {
        season: PRODUCT_SEASON,
        source: BOARD_SOURCE,
        playerId: "00-1",
        rank: 1,
        positionRank: 1,
        projectedPoints: 300,
        valueOverReplacement: 300,
        valueRank: 1,
        expectedGames: 17,
        floorPoints: 280,
        medianPoints: 300,
        ceilingPoints: 320,
        tier: 0,
        asOf: new Date("2026-08-01T00:00:00Z"),
        momentKind: "live",
      },
      {
        season: PRODUCT_SEASON,
        source: BOARD_SOURCE,
        playerId: "00-2",
        rank: 2,
        positionRank: 1,
        projectedPoints: 280,
        valueOverReplacement: 280,
        valueRank: 2,
        expectedGames: 17,
        floorPoints: 260,
        medianPoints: 280,
        ceilingPoints: 300,
        tier: 0,
        asOf: new Date("2026-08-01T00:00:00Z"),
        momentKind: "live",
      },
    ]);

    const sheet = await createSheet(db, "u1", { name: "Sheet" });
    const response = await POST(req({ source: "board" }), ctx(sheet.id));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { readonly data: { readonly entries: readonly { readonly playerId: string; readonly rank: number }[] } };
    expect(body.data.entries.map((entry) => entry.playerId)).toEqual(["p1", "p2"]);
  });

  it("422s a mock-history seed with no completed mocks to draw from", async () => {
    const sheet = await createSheet(db, "u1", { name: "Sheet" });
    const response = await POST(req({ source: "mocks" }), ctx(sheet.id));
    expect(response.status).toBe(422);
  });

  it("404s a sheet that is not the caller's own", async () => {
    await db.insert(users).values({ id: "u2", email: "u2@test.local", displayName: "u2" });
    const sheet = await createSheet(db, "u2", { name: "Not mine" });
    expect((await POST(req({ source: "board" }), ctx(sheet.id))).status).toBe(404);
  });
});
