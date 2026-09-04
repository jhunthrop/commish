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
import { createSheet } from "@/draft-hq/sheet/service";
import { GET } from "./route";

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

function req(url: string): Request {
  return new Request(url, { method: "GET" });
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

describe("GET /api/draft/sheets/default", () => {
  it("answers null when the caller has no format-default sheet", async () => {
    const response = await GET(req("http://test/api/draft/sheets/default"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, data: null });
  });

  it("finds the caller's format-default sheet", async () => {
    const sheet = await createSheet(db, "u1", { name: "Default" });
    const response = await GET(req("http://test/api/draft/sheets/default"));
    const body = (await response.json()) as { readonly data: { readonly id: string } | null };
    expect(body.data?.id).toBe(sheet.id);
  });

  it("403s a league-scoped lookup for a league the caller does not belong to", async () => {
    await db.insert(users).values({ id: "commish", email: "c@test.local", displayName: "c" });
    await db.insert(leagues).values({ id: "league-1", name: "L", format: "snake", teamCount: 12, rosterSlots: STANDARD_ROSTER_SLOTS, commissionerUserId: "commish" });
    const response = await GET(req("http://test/api/draft/sheets/default?leagueId=league-1"));
    expect(response.status).toBe(403);
  });

  it("finds the caller's own league-scoped sheet for a league they belong to", async () => {
    await db.insert(leagues).values({ id: "league-1", name: "L", format: "snake", teamCount: 12, rosterSlots: STANDARD_ROSTER_SLOTS, commissionerUserId: "u1" });
    await db.insert(teams).values({ id: "team-1", leagueId: "league-1", userId: "u1", name: "Team" });
    const sheet = await createSheet(db, "u1", { name: "League sheet", leagueId: "league-1" });
    const response = await GET(req("http://test/api/draft/sheets/default?leagueId=league-1"));
    const body = (await response.json()) as { readonly data: { readonly id: string } | null };
    expect(body.data?.id).toBe(sheet.id);
  });
});
