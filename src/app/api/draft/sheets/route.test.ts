import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://commish:commish@localhost:5433/commish_test";
  process.env.REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
});

vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: vi.fn() }));

import { createTestDb, truncateAll } from "@/db/test-db";
import { leagues, teams, users } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth/current-user";
import { STANDARD_ROSTER_SLOTS } from "@/domain/roster";
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
  return new Request("http://test/api/draft/sheets", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}
function get(): Request {
  return new Request("http://test/api/draft/sheets", { method: "GET" });
}

beforeEach(async () => {
  await truncateAll(db);
  vi.mocked(getCurrentUser).mockReset();
});

afterAll(async () => {
  await truncateAll(db);
});

describe("GET /api/draft/sheets", () => {
  it("401s a signed-out caller", async () => {
    signedInAs(null);
    expect((await GET(get())).status).toBe(401);
  });

  it("answers an empty list for a caller with no sheets", async () => {
    await db.insert(users).values({ id: "u1", email: "u1@test.local", displayName: "u1" });
    signedInAs("u1");
    const response = await GET(get());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, data: [] });
  });
});

describe("POST /api/draft/sheets", () => {
  it("creates a sheet for the signed-in caller", async () => {
    await db.insert(users).values({ id: "u1", email: "u1@test.local", displayName: "u1" });
    signedInAs("u1");
    const response = await POST(post({ name: "My board" }));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { readonly data: { readonly name: string; readonly userId: string } };
    expect(body.data.name).toBe("My board");
    expect(body.data.userId).toBe("u1");
  });

  it("400s an empty name", async () => {
    await db.insert(users).values({ id: "u1", email: "u1@test.local", displayName: "u1" });
    signedInAs("u1");
    expect((await POST(post({ name: "" }))).status).toBe(400);
  });

  it("403s a league-scoped sheet for a league the caller does not belong to", async () => {
    await db.insert(users).values([
      { id: "u1", email: "u1@test.local", displayName: "u1" },
      { id: "someone-else", email: "other@test.local", displayName: "other" },
    ]);
    await db.insert(leagues).values({ id: "league-1", name: "L", format: "snake", teamCount: 12, rosterSlots: STANDARD_ROSTER_SLOTS, commissionerUserId: "someone-else" });
    signedInAs("u1");
    expect((await POST(post({ name: "League sheet", leagueId: "league-1" }))).status).toBe(403);
  });

  it("creates a league-scoped sheet for a league the caller actually fields a team in", async () => {
    await db.insert(users).values({ id: "u1", email: "u1@test.local", displayName: "u1" });
    await db.insert(leagues).values({ id: "league-1", name: "L", format: "snake", teamCount: 12, rosterSlots: STANDARD_ROSTER_SLOTS, commissionerUserId: "u1" });
    await db.insert(teams).values({ id: "team-1", leagueId: "league-1", userId: "u1", name: "Team" });
    signedInAs("u1");
    const response = await POST(post({ name: "League sheet", leagueId: "league-1" }));
    expect(response.status).toBe(200);
  });
});
