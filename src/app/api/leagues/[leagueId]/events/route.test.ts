import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";

// The route handler uses the process-wide getDb(); point it at the test infrastructure
// before any module is imported. vi.hoisted runs before the import graph.
vi.hoisted(() => {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://commish:commish@localhost:5433/commish_test";
  process.env.REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
});

vi.mock("@/lib/auth/current-user", () => ({
  getCurrentUser: vi.fn(),
}));

import { eq } from "drizzle-orm";
import { createTestDb, truncateAll } from "@/db/test-db";
import { leagues, users } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth/current-user";
import { seedDraftFixture, SPRINT_ROSTER_SLOTS } from "@/draft-service/test-support";
import { GET } from "./route";

const db = createTestDb();
const LEAGUE_ID = "league_events";
const params = Promise.resolve({ leagueId: LEAGUE_ID });

const signedInAs = (id: string | null) =>
  vi.mocked(getCurrentUser).mockResolvedValue(
    id === null
      ? null
      : { id, email: `${id}@test.local`, displayName: id, experienceTier: "beginner", avatarUrl: null, createdAt: "2026-09-01T00:00:00.000Z" },
  );

function request(): Request {
  return new Request(`http://test/api/leagues/${LEAGUE_ID}/events`);
}

async function fixture() {
  return seedDraftFixture(db, {
    draftId: "draft_events",
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
  vi.mocked(getCurrentUser).mockReset();
});

afterAll(async () => {
  await truncateAll(db);
});

describe("GET /api/leagues/[leagueId]/events", () => {
  it("answers 401 JSON — never a redirect — when nobody is signed in", async () => {
    signedInAs(null);
    const response = await GET(request(), { params });
    expect(response.status).toBe(401);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.json()).toEqual({ ok: false, error: "Not signed in." });
  });

  it("answers 404 for a league that doesn't exist", async () => {
    signedInAs("someone");
    const response = await GET(request(), { params });
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ ok: false, error: "That league doesn't exist." });
  });

  it("answers 403 for a signed-in user with no team in this league", async () => {
    await fixture();
    signedInAs("stranger");
    const response = await GET(request(), { params });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ ok: false, error: "You don't have a team in this league." });
  });

  it("opens the stream for a member with a team in the league", async () => {
    const f = await fixture();
    signedInAs(f.userIds[1]!);
    const response = await GET(request(), { params });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    await response.body?.cancel();
  });

  it("opens the stream for a commissioner with no team of their own", async () => {
    const f = await fixture();
    const commissionerId = "league_events_commish_no_team";
    await db.insert(users).values({ id: commissionerId, email: `${commissionerId}@test.local`, displayName: commissionerId });
    await db.update(leagues).set({ commissionerUserId: commissionerId }).where(eq(leagues.id, f.leagueId));
    signedInAs(commissionerId);

    const response = await GET(request(), { params });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    await response.body?.cancel();
  });
});
