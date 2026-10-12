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
import { createTestDb } from "@research/db/test-db";
import { truncateAll } from "@/db/test-db";
import { drafts, teams, users } from "@/db/schema";
import { STANDARD_ROSTER_SLOTS } from "@research/domain/roster";
import { getCurrentUser, requireCurrentUser } from "@/lib/auth/current-user";
import { LEAGUE_CONFIG } from "@/league";
import { createLeague } from "@/league-service/creation";
import { DELETE as deleteSeat } from "./route";

const db = createTestDb();
const clock = { now: () => "2026-08-23T12:00:00.000Z" };
let nextId = 0;
const newId = () => `id_${++nextId}`;

const profile = (id: string) => ({
  id, email: `${id}@test.local`, displayName: `Manager ${id}`,
  experienceTier: "beginner" as const, avatarUrl: null, createdAt: "2026-08-23T12:00:00.000Z", isAdmin: false,
});
const signedInAs = (id: string) => {
  vi.mocked(getCurrentUser).mockResolvedValue(profile(id));
  vi.mocked(requireCurrentUser).mockResolvedValue(profile(id));
};

const del = () => new Request("http://test/seat", { method: "DELETE" });

/** A two-manager league whose draft is still `scheduled` — the one shape this route's whole
 *  surface is about. */
async function scheduledLeague(): Promise<{ readonly leagueId: string; readonly draftId: string }> {
  await db.insert(users).values([
    { id: "u1", email: "u1@test.local", displayName: "Manager 1" },
    { id: "u2", email: "u2@test.local", displayName: "Manager 2" },
  ]);
  const created = await createLeague({ db, clock, newId }, {
    name: "Sunday Money", format: "snake", teamCount: LEAGUE_CONFIG.defaults.teamCount, scoringPreset: "ppr",
    auctionBudget: null, rosterSlots: STANDARD_ROSTER_SLOTS, owner: { kind: "member", userId: "u1", teamName: "Team One" },
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

describe("DELETE /api/leagues/[leagueId]/seat", () => {
  it("releases a non-commissioner member's own seat", async () => {
    const league = await scheduledLeague();
    signedInAs("u2");
    const response = await deleteSeat(del(), { params: Promise.resolve({ leagueId: league.leagueId }) });
    expect(response.status).toBe(200);
    expect((await response.json()).data).toEqual({ released: true });
    const rows = await db.select({ userId: teams.userId }).from(teams).where(eq(teams.leagueId, league.leagueId));
    expect(rows.map((row) => row.userId)).toEqual(["u1"]);
  });

  it("answers 403 for the member commissioner, naming that there is no way to hand the role off", async () => {
    const league = await scheduledLeague();
    signedInAs("u1");
    const response = await deleteSeat(del(), { params: Promise.resolve({ leagueId: league.leagueId }) });
    expect(response.status).toBe(403);
  });

  it("answers 403 for a stranger with no team in the league, before the service is ever asked", async () => {
    const league = await scheduledLeague();
    await db.insert(users).values({ id: "u3", email: "u3@test.local", displayName: "Manager 3" });
    signedInAs("u3");
    const response = await deleteSeat(del(), { params: Promise.resolve({ leagueId: league.leagueId }) });
    expect(response.status).toBe(403);
  });

  it("answers 404 for a league that doesn't exist", async () => {
    signedInAs("nobody");
    const response = await deleteSeat(del(), { params: Promise.resolve({ leagueId: "nope" }) });
    expect(response.status).toBe(404);
  });

  it("answers 409 once the draft has started", async () => {
    const league = await scheduledLeague();
    await db.update(drafts).set({ status: "in_progress" }).where(eq(drafts.leagueId, league.leagueId));
    signedInAs("u2");
    const response = await deleteSeat(del(), { params: Promise.resolve({ leagueId: league.leagueId }) });
    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe("This league's draft has already started, so there is no seat left to release.");
  });
});
