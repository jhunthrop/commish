import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";

vi.hoisted(() => {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://commish:commish@localhost:5433/commish_test";
  process.env.REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
});

vi.mock("@/lib/auth/current-user", () => ({
  getCurrentUser: vi.fn(),
}));

import Redis from "ioredis";
import { createTestDb, truncateAll } from "@/db/test-db";
import { getCurrentUser } from "@/lib/auth/current-user";
import { seedDraftFixture, SPRINT_ROSTER_SLOTS } from "@/draft-service/test-support";
import { PRESENCE_CONFIG, createPresenceStore } from "@/lib/realtime/presence";
import { GET } from "./route";

const db = createTestDb();
const LEAGUE_ID = "league_presence_route";
const params = Promise.resolve({ leagueId: LEAGUE_ID });
const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379");
const store = createPresenceStore(redis);

const signedInAs = (id: string | null) =>
  vi.mocked(getCurrentUser).mockResolvedValue(
    id === null
      ? null
      : { id, email: `${id}@test.local`, displayName: id, experienceTier: "beginner", avatarUrl: null, createdAt: "2026-09-01T00:00:00.000Z", isAdmin: false },
  );

function request(): Request {
  return new Request(`http://test/api/leagues/${LEAGUE_ID}/presence`);
}

async function fixture() {
  return seedDraftFixture(db, {
    draftId: "draft_presence_route",
    leagueId: LEAGUE_ID,
    format: "snake",
    teamCount: 2,
    slotConfig: SPRINT_ROSTER_SLOTS,
    kickoffAt: new Date("2026-09-10T17:00:00.000Z"),
    auctionBudget: null,
  });
}

beforeEach(async () => {
  await truncateAll(db);
  await redis.del(PRESENCE_CONFIG.key(LEAGUE_ID));
  vi.mocked(getCurrentUser).mockReset();
});

afterAll(async () => {
  await truncateAll(db);
  await redis.del(PRESENCE_CONFIG.key(LEAGUE_ID));
  redis.disconnect();
});

describe("GET /api/leagues/[leagueId]/presence", () => {
  it("answers 401 JSON when nobody is signed in", async () => {
    signedInAs(null);
    const response = await GET(request(), { params });
    expect(response.status).toBe(401);
  });

  it("answers 403 for a signed-in stranger: who is in the room is the room's own fact", async () => {
    await fixture();
    signedInAs("stranger");
    const response = await GET(request(), { params });
    expect(response.status).toBe(403);
  });

  it("answers the members the presence store holds inside the ttl, and nobody stale", async () => {
    const seeded = await fixture();
    const member = seeded.userIds[0]!;
    signedInAs(member);
    const now = Date.now();
    await store.markPresent(LEAGUE_ID, member, "conn-1", now);
    await store.markPresent(LEAGUE_ID, "user_long_gone", "conn-2", now - PRESENCE_CONFIG.ttlMs - 5_000);
    const response = await GET(request(), { params });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, data: { userIds: [member] } });
  });

  it("answers an empty list for a room nobody has opened, never an error", async () => {
    const seeded = await fixture();
    signedInAs(seeded.userIds[0]!);
    const response = await GET(request(), { params });
    expect(await response.json()).toEqual({ ok: true, data: { userIds: [] } });
  });
});
