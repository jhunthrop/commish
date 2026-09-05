import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://commish:commish@localhost:5433/commish_test";
  process.env.REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
});

vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: vi.fn() }));

import { createTestDb, truncateAll } from "@/db/test-db";
import { leagues, nflPlayers, playerCrosswalk, players, preseasonProjections, teams, users } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth/current-user";
import { STANDARD_ROSTER_SLOTS, type RosterSlotConfig } from "@/domain/roster";
import { BOARD_SOURCE } from "@/projections/preseason/board-store";
import { PRODUCT_SEASON } from "@/projections/preseason/current";
import { GET, POST } from "./route";

const db = createTestDb();

function signedInAs(id: string | null) {
  vi.mocked(getCurrentUser).mockResolvedValue(
    id === null
      ? null
      : { id, email: `${id}@test.local`, displayName: id, experienceTier: "beginner", avatarUrl: null, createdAt: "2026-09-01T00:00:00.000Z", isAdmin: false },
  );
}

function post(body: unknown): Request {
  return new Request("http://test/api/draft/sim", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}
function get(): Request {
  return new Request("http://test/api/draft/sim", { method: "GET" });
}

const GENERIC_BODY = { leagueId: null, slot: 1, rounds: 15, runs: 1000, sharpness: 0.5 };

beforeEach(async () => {
  await truncateAll(db);
  vi.mocked(getCurrentUser).mockReset();
});

afterAll(async () => {
  await truncateAll(db);
});

describe("POST /api/draft/sim", () => {
  it("401s a signed-out caller", async () => {
    signedInAs(null);
    expect((await POST(post(GENERIC_BODY))).status).toBe(401);
  });

  it("400s a malformed body", async () => {
    await db.insert(users).values({ id: "u1", email: "u1@test.local", displayName: "u1" });
    signedInAs("u1");
    expect((await POST(post({ ...GENERIC_BODY, runs: 3 }))).status).toBe(400); // 3 is not one of the offered run sizes
    expect((await POST(post({ ...GENERIC_BODY, sharpness: 2 }))).status).toBe(400); // out of [0,1]
  });

  it("403s a league the caller does not belong to", async () => {
    await db.insert(users).values([
      { id: "u1", email: "u1@test.local", displayName: "u1" },
      { id: "owner", email: "owner@test.local", displayName: "owner" },
    ]);
    await db.insert(leagues).values({ id: "league-1", name: "L", format: "snake", teamCount: 12, rosterSlots: STANDARD_ROSTER_SLOTS, commissionerUserId: "owner" });
    signedInAs("u1");
    expect((await POST(post({ ...GENERIC_BODY, leagueId: "league-1" }))).status).toBe(403);
  });

  it("above the sync threshold: queues the run without needing an evidence board seeded yet", async () => {
    await db.insert(users).values({ id: "u1", email: "u1@test.local", displayName: "u1" });
    signedInAs("u1");
    const response = await POST(post({ ...GENERIC_BODY, runs: 1000 }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.status).toBe("pending");
    expect(body.data.config.runs).toBe(1000);
  });

  it("enforces the per-user in-flight budget", async () => {
    await db.insert(users).values({ id: "u1", email: "u1@test.local", displayName: "u1" });
    signedInAs("u1");
    // Three distinct configs (distinct `rounds`) so each queues a genuinely different run rather
    // than hitting the cache.
    for (let i = 0; i < 3; i += 1) {
      const response = await POST(post({ ...GENERIC_BODY, runs: 1000, rounds: 10 + i }));
      expect(response.status).toBe(200);
    }
    const fourth = await POST(post({ ...GENERIC_BODY, runs: 1000, rounds: 20 }));
    expect(fourth.status).toBe(429);
  });

  it("runs synchronously at or under the sync threshold and returns a real, honest failure when no board exists yet", async () => {
    await db.insert(users).values({ id: "u1", email: "u1@test.local", displayName: "u1" });
    signedInAs("u1");
    const response = await POST(post({ ...GENERIC_BODY, runs: 100 }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.status).toBe("failed");
    expect(body.data.error).toMatch(/fewer than/);
  });

  it("runs synchronously end to end against a real, minimally-seeded evidence board", async () => {
    await db.insert(users).values({ id: "u1", email: "u1@test.local", displayName: "u1" });
    // A one-slot, two-team league: only 2 evidence-ranked players are needed for a full draft.
    const tinySlots: readonly RosterSlotConfig[] = [{ slot: "QB", count: 1, eligiblePositions: ["QB"] }];
    await db.insert(leagues).values({ id: "league-1", name: "L", format: "snake", teamCount: 2, rosterSlots: tinySlots, commissionerUserId: "u1" });
    await db.insert(teams).values({ id: "team-1", leagueId: "league-1", userId: "u1", name: "Team" });

    await db.insert(nflPlayers).values([
      { id: "nfl-1", name: "Player One", position: "QB" },
      { id: "nfl-2", name: "Player Two", position: "QB" },
    ]);
    await db.insert(players).values([
      { id: "p1", name: "Player One", position: "QB", nflTeam: "SF", adp: 1 },
      { id: "p2", name: "Player Two", position: "QB", nflTeam: "DAL", adp: 2 },
    ]);
    await db.insert(playerCrosswalk).values([
      { playerId: "p1", nflPlayerId: "nfl-1", method: "espn_id", resolvedAt: new Date() },
      { playerId: "p2", nflPlayerId: "nfl-2", method: "espn_id", resolvedAt: new Date() },
    ]);
    const asOf = new Date("2026-08-01T00:00:00.000Z");
    await db.insert(preseasonProjections).values([
      { season: PRODUCT_SEASON, source: BOARD_SOURCE, playerId: "nfl-1", rank: 1, positionRank: 1, projectedPoints: 300, valueOverReplacement: 50, valueRank: 1, expectedGames: 17, floorPoints: 250, medianPoints: 300, ceilingPoints: 350, tier: 0, asOf },
      { season: PRODUCT_SEASON, source: BOARD_SOURCE, playerId: "nfl-2", rank: 2, positionRank: 2, projectedPoints: 280, valueOverReplacement: 30, valueRank: 2, expectedGames: 17, floorPoints: 230, medianPoints: 280, ceilingPoints: 330, tier: 0, asOf },
    ]);

    signedInAs("u1");
    const response = await POST(post({ leagueId: "league-1", slot: 1, rounds: 1, runs: 100, sharpness: 0.5 }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.status).toBe("succeeded");
    expect(body.data.summary.runs).toBe(100);
    expect(body.data.summary.availability).toHaveLength(1);

    // A repeat of the identical request is a cache hit against the same succeeded row.
    const repeat = await POST(post({ leagueId: "league-1", slot: 1, rounds: 1, runs: 100, sharpness: 0.5 }));
    const repeatBody = await repeat.json();
    expect(repeatBody.data.id).toBe(body.data.id);
  });
});

describe("GET /api/draft/sim", () => {
  it("401s a signed-out caller", async () => {
    signedInAs(null);
    expect((await GET(get())).status).toBe(401);
  });

  it("lists nothing for a caller with no sims yet", async () => {
    await db.insert(users).values({ id: "u1", email: "u1@test.local", displayName: "u1" });
    signedInAs("u1");
    const response = await GET(get());
    const body = await response.json();
    expect(body.data).toEqual([]);
  });
});
