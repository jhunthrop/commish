import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";

vi.hoisted(() => {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://commish:commish@localhost:5433/commish_test";
  process.env.REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
});

vi.mock("@/lib/auth/current-user", () => ({
  getCurrentUser: vi.fn(),
  requireCurrentUser: vi.fn(),
}));

import { eq } from "drizzle-orm";
import { createTestDb, truncateAll } from "@/db/test-db";
import { leagues, teams, users } from "@/db/schema";
import { getCurrentUser, requireCurrentUser } from "@/lib/auth/current-user";
import { INTEGRITY_CONFIG } from "@/integrity/config";
import { ENFORCEMENT_REFUSALS } from "@/league-service/enforcement";
import { POST } from "./route";

const db = createTestDb();

const currentUser = (id: string) => ({
  id,
  email: `${id}@test.local`,
  displayName: id,
  experienceTier: "beginner" as const,
  avatarUrl: null,
  createdAt: "2026-09-01T00:00:00.000Z",
  isAdmin: false,
});

/** `withCurrentUser` reads `getCurrentUser`; the route itself separately calls
 *  `requireCurrentUser` for the display-name/experience-tier defaults — both mocked here so
 *  neither reaches a real WorkOS session. */
const signedInAs = (id: string | null) => {
  const user = id === null ? null : currentUser(id);
  vi.mocked(getCurrentUser).mockResolvedValue(user);
  vi.mocked(requireCurrentUser).mockImplementation(async () => {
    if (user === null) throw new Error("Not authenticated.");
    return user;
  });
};

function post(body: unknown) {
  const request = new Request("http://test/api/leagues", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return POST(request);
}

/** Gives `userId` `count` OTHER completed leagues — matches `@/league-service`'s own suites
 *  (`browse.test.ts`, `join.test.ts`, `creation.test.ts`, `enforcement.test.ts`). */
async function giveCompletedSeasons(userId: string, count: number): Promise<void> {
  await db.insert(users).values({ id: userId, email: `${userId}@test.local`, displayName: userId }).onConflictDoNothing();
  for (let i = 0; i < count; i++) {
    const leagueId = `${userId}_history_${i}`;
    await db.insert(leagues).values({
      id: leagueId,
      name: leagueId,
      format: "snake",
      teamCount: 1,
      commissionerUserId: userId,
      seasonCompletedAt: new Date("2025-01-01T00:00:00.000Z"),
    });
    await db.insert(teams).values({ id: `${leagueId}_team`, leagueId, userId, name: "Team" });
  }
}

beforeEach(async () => {
  await truncateAll(db);
  vi.mocked(getCurrentUser).mockReset();
  vi.mocked(requireCurrentUser).mockReset();
});

afterAll(async () => {
  await truncateAll(db);
});

describe("POST /api/leagues", () => {
  it("answers 401 JSON when nobody is signed in", async () => {
    signedInAs(null);
    const response = await post({ name: "Sunday Money" });
    expect(response.status).toBe(401);
  });

  it("creates a league from just a name, and answers 201 with the ids a client needs next", async () => {
    await db.insert(users).values({ id: "u1", email: "u1@test.local", displayName: "u1" });
    signedInAs("u1");

    const response = await post({ name: "Sunday Money" });
    expect(response.status).toBe(201);
    const body = (await response.json()) as { readonly ok: true; readonly data: { readonly leagueId: string; readonly teamId: string; readonly draftId: string } };
    expect(body.data.leagueId).toBeTruthy();
    expect(body.data.teamId).toBeTruthy();
    expect(body.data.draftId).toBeTruthy();

    const [league] = await db.select().from(leagues).where(eq(leagues.id, body.data.leagueId));
    expect(league).toMatchObject({ name: "Sunday Money", commissionerUserId: "u1" });
  });

  it("answers 409 with the tier-refusal copy, not a 500, for a veteran creating a public beginner league", async () => {
    // The fix this task's own commit made: `CreateLeagueResult`'s `status` field was added so the
    // route can forward the real refusal code instead of hardcoding 500 for every failure.
    await giveCompletedSeasons("u_vet_route", INTEGRITY_CONFIG.participation.veteranSeasonCutoff);
    signedInAs("u_vet_route");

    const response = await post({ name: "Rookie Room", visibility: "public", experienceTier: "beginner" });
    expect(response.status).toBe(409);
    const body = (await response.json()) as { readonly ok: false; readonly error: string };
    expect(body.error).toBe(ENFORCEMENT_REFUSALS.create);
  });
});
