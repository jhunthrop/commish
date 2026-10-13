import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";

vi.hoisted(() => {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://commish:commish@localhost:5433/commish_test";
  process.env.REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
});

vi.mock("@/lib/auth/current-user", () => ({
  getCurrentUser: vi.fn(),
}));

import { createTestDb } from "@research-ts/db/test-db";
import { truncateAll } from "@/db/test-db";
import { drafts, leagues, teams, users } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth/current-user";
import { INTEGRITY_CONFIG } from "@/integrity/config";
import { ENFORCEMENT_REFUSALS } from "@/league-service/enforcement";
import { POST } from "./route";

const db = createTestDb();

const signedInAs = (id: string | null) =>
  vi.mocked(getCurrentUser).mockResolvedValue(
    id === null
      ? null
      : { id, email: `${id}@test.local`, displayName: id, experienceTier: "beginner", avatarUrl: null, createdAt: "2026-09-01T00:00:00.000Z", isAdmin: false },
  );

function post(leagueId: string) {
  const request = new Request(`http://test/api/public/leagues/${leagueId}/join`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  });
  return POST(request, { params: Promise.resolve({ leagueId }) });
}

async function seedBeginnerPublicLeague(id: string): Promise<void> {
  await db.insert(users).values({ id: "owner", email: "owner@test.local", displayName: "Commissioner Casey" }).onConflictDoNothing();
  await db.insert(leagues).values({
    id,
    name: "Rookie Snake Room",
    format: "snake",
    teamCount: 12,
    stakeTier: 0,
    experienceTier: "beginner",
    isPublicMatchmade: true,
    commissionerUserId: "owner",
  });
  await db.insert(drafts).values({
    id: `${id}_draft`,
    leagueId: id,
    format: "snake",
    status: "scheduled",
    kickoffAt: new Date("2026-09-10T17:00:00.000Z"),
    auctionBudget: null,
  });
}

/** Gives `userId` `count` completed OTHER leagues, matching `@/league-service`'s own suites. */
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
});

afterAll(async () => {
  await truncateAll(db);
});

describe("POST /api/public/leagues/[leagueId]/join", () => {
  it("answers 401 JSON when nobody is signed in", async () => {
    signedInAs(null);
    const response = await post("lg1");
    expect(response.status).toBe(401);
  });

  it("seats a signed-in stranger who has room, and identity comes from the session alone", async () => {
    await seedBeginnerPublicLeague("lg_open");
    await db.insert(users).values({ id: "u_newcomer", email: "u_newcomer@test.local", displayName: "Newcomer" });
    signedInAs("u_newcomer");

    const response = await post("lg_open");
    expect(response.status).toBe(200);
    const body = (await response.json()) as { readonly ok: true; readonly data: { readonly leagueId: string } };
    expect(body.data.leagueId).toBe("lg_open");
  });

  it("answers 409 with the tier-block copy for a veteran against a beginner-tier public league", async () => {
    await seedBeginnerPublicLeague("lg_beginner");
    await giveCompletedSeasons("u_vet_route", INTEGRITY_CONFIG.participation.veteranSeasonCutoff);
    signedInAs("u_vet_route");

    const response = await post("lg_beginner");
    expect(response.status).toBe(409);
    const body = (await response.json()) as { readonly ok: false; readonly error: string };
    expect(body.error).toBe(ENFORCEMENT_REFUSALS.join);
  });
});
