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
import { teams, users } from "@/db/schema";
import { STANDARD_ROSTER_SLOTS } from "@/domain/roster";
import { getCurrentUser, requireCurrentUser } from "@/lib/auth/current-user";
import { LEAGUE_CONFIG } from "@/league";
import { createLeague } from "@/league-service/creation";
import { GET as getSlotPreference, PUT as putSlotPreference } from "./route";

const db = createTestDb();
const clock = { now: () => "2026-08-17T12:00:00.000Z" };
let nextId = 0;
const newId = () => `id_${++nextId}`;

const profile = (id: string) => ({
  id, email: `${id}@test.local`, displayName: `Manager ${id}`,
  experienceTier: "beginner" as const, avatarUrl: null, createdAt: "2026-08-17T12:00:00.000Z", isAdmin: false,
});
const signedInAs = (id: string) => {
  vi.mocked(getCurrentUser).mockResolvedValue(profile(id));
  vi.mocked(requireCurrentUser).mockResolvedValue(profile(id));
};

const get = () => new Request("http://test/slot-preference");
const put = (body: unknown) =>
  new Request("http://test/slot-preference", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

async function scheduledLeague(): Promise<{ readonly leagueId: string; readonly draftId: string }> {
  await db.insert(users).values([
    { id: "u1", email: "u1@test.local", displayName: "Manager 1" },
    { id: "u2", email: "u2@test.local", displayName: "Manager 2" },
  ]);
  const created = await createLeague({ db, clock, newId }, {
    name: "Sunday Money", format: "snake", teamCount: LEAGUE_CONFIG.defaults.teamCount, scoringPreset: "ppr",
    auctionBudget: null, rosterSlots: STANDARD_ROSTER_SLOTS, commissionerUserId: "u1", teamName: "Team One",
    experienceTier: "beginner", stakeTier: 0, isPublicMatchmade: false,
  });
  if (!created.ok) throw new Error(created.reason);
  await db.insert(teams).values({ id: "team_2", leagueId: created.leagueId, userId: "u2", name: "Team Two" });
  return { leagueId: created.leagueId, draftId: created.draftId };
}

beforeEach(async () => {
  await truncateAll(db);
  nextId = 0;
  vi.mocked(getCurrentUser).mockReset();
  vi.mocked(requireCurrentUser).mockReset();
});

afterAll(async () => {
  await truncateAll(db);
});

describe("GET /api/leagues/[leagueId]/slot-preference", () => {
  it("answers the caller's own ranking, empty and editable before anyone has ranked anything", async () => {
    const league = await scheduledLeague();
    signedInAs("u1");
    const response = await getSlotPreference(get(), { params: Promise.resolve({ leagueId: league.leagueId }) });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toEqual({
      slotCount: LEAGUE_CONFIG.defaults.teamCount,
      ranking: [],
      assignedSlot: null,
      canEdit: true,
    });
  });

  it("answers 404, never 403, for a caller with no team in this league", async () => {
    const league = await scheduledLeague();
    await db.insert(users).values({ id: "u3", email: "u3@test.local", displayName: "Manager 3" });
    signedInAs("u3");
    const response = await getSlotPreference(get(), { params: Promise.resolve({ leagueId: league.leagueId }) });
    expect(response.status).toBe(404);
  });

  it("answers 404 for a league that doesn't exist", async () => {
    signedInAs("nobody");
    const response = await getSlotPreference(get(), { params: Promise.resolve({ leagueId: "nope" }) });
    expect(response.status).toBe(404);
  });
});

describe("PUT /api/leagues/[leagueId]/slot-preference", () => {
  it("saves the caller's own ranking and echoes it back", async () => {
    const league = await scheduledLeague();
    signedInAs("u2");
    const response = await putSlotPreference(put({ ranking: [1, 3] }), {
      params: Promise.resolve({ leagueId: league.leagueId }),
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.ranking).toEqual([1, 3]);

    const reread = await getSlotPreference(get(), { params: Promise.resolve({ leagueId: league.leagueId }) });
    expect((await reread.json()).data.ranking).toEqual([1, 3]);
  });

  it("answers the service's own refusal verbatim for a slot number outside the league's range", async () => {
    const league = await scheduledLeague();
    signedInAs("u1");
    const response = await putSlotPreference(put({ ranking: [999] }), {
      params: Promise.resolve({ leagueId: league.leagueId }),
    });
    expect(response.status).toBe(422);
    expect((await response.json()).error).toBe(`Pick from slots 1 to ${LEAGUE_CONFIG.defaults.teamCount}.`);
  });

  it("answers 404, never 403, for a caller with no team in this league", async () => {
    const league = await scheduledLeague();
    await db.insert(users).values({ id: "u3", email: "u3@test.local", displayName: "Manager 3" });
    signedInAs("u3");
    const response = await putSlotPreference(put({ ranking: [1] }), {
      params: Promise.resolve({ leagueId: league.leagueId }),
    });
    expect(response.status).toBe(404);
  });

  it("answers 400 for a body that isn't the right shape", async () => {
    const league = await scheduledLeague();
    signedInAs("u1");
    const response = await putSlotPreference(put({ ranking: "not an array" }), {
      params: Promise.resolve({ leagueId: league.leagueId }),
    });
    expect(response.status).toBe(400);
  });
});
