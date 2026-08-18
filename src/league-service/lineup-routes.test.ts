import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";

vi.hoisted(() => {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://commish:commish@localhost:5433/commish_test";
  process.env.REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
});

vi.mock("@/lib/auth/current-user", () => ({
  getCurrentUser: vi.fn(),
  requireCurrentUser: vi.fn(),
}));

import { createTestDb, truncateAll } from "@/db/test-db";
import { users } from "@/db/schema";
import { getCurrentUser, requireCurrentUser } from "@/lib/auth/current-user";
import { GET as getLineupRoute, PUT as putLineup } from "@/app/api/leagues/[leagueId]/teams/me/lineup/route";
import { scoreWeek } from "./results";
import { twoTeamLeague, validSwap } from "./test-support";

const db = createTestDb();

const profile = (id: string) => ({
  id, email: `${id}@test.local`, displayName: `Manager ${id}`,
  experienceTier: "beginner" as const, avatarUrl: null, createdAt: "2026-08-17T12:00:00.000Z",
});
const signedInAs = (id: string) => {
  vi.mocked(getCurrentUser).mockResolvedValue(profile(id));
  vi.mocked(requireCurrentUser).mockResolvedValue(profile(id));
};
const put = (body: unknown) =>
  new Request("http://test/lineup", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

const wrongPositions = [
  { slot: "QB" as const, slotIndex: 0, playerId: "rb1" },
  { slot: "RB" as const, slotIndex: 0, playerId: "qb1" },
  { slot: "BENCH" as const, slotIndex: 0, playerId: "qb2" },
  { slot: "BENCH" as const, slotIndex: 1, playerId: "rb2" },
];

beforeEach(async () => {
  await truncateAll(db);
  vi.mocked(getCurrentUser).mockReset();
  vi.mocked(requireCurrentUser).mockReset();
});

afterAll(async () => {
  await truncateAll(db);
});

describe("PUT /api/leagues/[leagueId]/teams/me/lineup", () => {
  it("answers 403 for a member with no team of their own", async () => {
    const league = await twoTeamLeague(db);
    // A third user who is neither the commissioner nor fields a team here.
    await db.insert(users).values({ id: "u3", email: "u3@test.local", displayName: "Manager 3" });
    signedInAs("u3");
    const params = Promise.resolve({ leagueId: league.leagueId });
    const response = await putLineup(put({ weekNumber: 1, slots: validSwap }), { params });
    expect(response.status).toBe(403);
    expect((await response.json()).error).toBe("You don't have a team in this league.");
  });

  it("saves the caller's own lineup and answers with the new one", async () => {
    const league = await twoTeamLeague(db);
    signedInAs("u1");
    const params = Promise.resolve({ leagueId: league.leagueId });
    const response = await putLineup(put({ weekNumber: 1, slots: validSwap }), { params });
    expect(response.status).toBe(200);
    const body = (await response.json()).data;
    expect(body.starters.map((s: { playerId: string }) => s.playerId)).toEqual(["qb2", "rb1"]);
    expect(body.locked).toBe(false);
  });

  it("answers 422 with validateLineup's reason for an ineligible slot", async () => {
    const league = await twoTeamLeague(db);
    signedInAs("u1");
    const params = Promise.resolve({ leagueId: league.leagueId });
    const response = await putLineup(put({ weekNumber: 1, slots: wrongPositions }), { params });
    expect(response.status).toBe(422);
    expect((await response.json()).error).toBe("RB is not eligible for the QB slot.");
  });

  it("answers 409 once the week is final", async () => {
    const league = await twoTeamLeague(db);
    await scoreWeek(db, league.leagueId, 1);
    signedInAs("u1");
    const params = Promise.resolve({ leagueId: league.leagueId });
    const response = await putLineup(put({ weekNumber: 1, slots: validSwap }), { params });
    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe("Week 1 is final, so its lineup can't change.");
  });

  it("answers 400 naming the field for a malformed body", async () => {
    const league = await twoTeamLeague(db);
    signedInAs("u1");
    const params = Promise.resolve({ leagueId: league.leagueId });
    const response = await putLineup(put({ weekNumber: 0, slots: [] }), { params });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("weekNumber");
  });
});

describe("GET /api/leagues/[leagueId]/teams/me/lineup", () => {
  it("returns the drafted default for a week nobody has edited", async () => {
    const league = await twoTeamLeague(db);
    signedInAs("u1");
    const params = Promise.resolve({ leagueId: league.leagueId });
    const response = await getLineupRoute(new Request(`http://test/api/leagues/${league.leagueId}/teams/me/lineup?week=1`), { params });
    expect(response.status).toBe(200);
    expect((await response.json()).data.starters).toHaveLength(2);
  });
});
