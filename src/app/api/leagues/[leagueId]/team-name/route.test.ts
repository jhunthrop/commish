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
import { createTestDb } from "@research-ts/db/test-db";
import { truncateAll } from "@/db/test-db";
import { teams, users } from "@/db/schema";
import { STANDARD_ROSTER_SLOTS } from "@research-ts/domain/roster";
import { IDENTITY_CONFIG } from "@/identity";
import { getCurrentUser, requireCurrentUser } from "@/lib/auth/current-user";
import { LEAGUE_CONFIG } from "@/league";
import { createLeague } from "@/league-service/creation";
import { resetTeamNameRateLimit } from "./_shared";
import { PUT as putTeamName } from "./route";

const db = createTestDb();
const clock = { now: () => "2026-09-11T12:00:00.000Z" };
let nextId = 0;
const newId = () => `id_${++nextId}`;

const profile = (id: string) => ({
  id, email: `${id}@test.local`, displayName: `Manager ${id}`,
  experienceTier: "beginner" as const, avatarUrl: null, createdAt: "2026-09-11T12:00:00.000Z", isAdmin: false,
});
const signedInAs = (id: string) => {
  vi.mocked(getCurrentUser).mockResolvedValue(profile(id));
  vi.mocked(requireCurrentUser).mockResolvedValue(profile(id));
};

const put = (body: unknown) =>
  new Request("http://test/team-name", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

async function league(): Promise<string> {
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
  return created.leagueId;
}

const params = (leagueId: string) => ({ params: Promise.resolve({ leagueId }) });

beforeEach(async () => {
  await truncateAll(db);
  nextId = 0;
  resetTeamNameRateLimit();
  vi.mocked(getCurrentUser).mockReset();
  vi.mocked(requireCurrentUser).mockReset();
});

afterAll(async () => {
  await truncateAll(db);
});

describe("PUT /api/leagues/[leagueId]/team-name", () => {
  it("renames the caller's own team and answers the stored name", async () => {
    const leagueId = await league();
    signedInAs("u1");
    const response = await putTeamName(put({ name: "  Bay Bandits  " }), params(leagueId));
    expect(response.status).toBe(200);
    // The SCHEMA's trim, so the field shows what the room will actually call this manager.
    expect((await response.json()).data).toEqual({ name: "Bay Bandits" });

    const [row] = await db.select({ name: teams.name }).from(teams).where(eq(teams.userId, "u1"));
    expect(row?.name).toBe("Bay Bandits");
  });

  it("cannot be pointed at anybody else's seat, and leaves it untouched", async () => {
    const leagueId = await league();
    signedInAs("u2");
    await putTeamName(put({ name: "Renamed By Two" }), params(leagueId));

    const [mine] = await db.select({ name: teams.name }).from(teams).where(eq(teams.userId, "u1"));
    expect(mine?.name).toBe("Team One");
  });

  it("refuses a name past the schema's ceiling, in plain language", async () => {
    const leagueId = await league();
    signedInAs("u1");
    const response = await putTeamName(put({ name: "x".repeat(LEAGUE_CONFIG.maxNameLength + 1) }), params(leagueId));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain(String(LEAGUE_CONFIG.maxNameLength));
  });

  /**
   * FIX ROUND 1, MEDIUM 5. A team name is stored VERBATIM into rendered activity copy that is
   * never re-rendered (ruling 12), so a name changed in a loop writes a loop's worth of permanent
   * sentences into every member's feed. Same ceiling as the display name, for the same reason.
   */
  it("stops at the same per-user ceiling the display name carries, and says so as a 429", async () => {
    const leagueId = await league();
    signedInAs("u1");
    for (let n = 0; n < IDENTITY_CONFIG.profileRateLimit.maxRequests; n += 1) {
      const ok = await putTeamName(put({ name: `Name ${n}` }), params(leagueId));
      expect(ok.status).toBe(200);
    }
    const refused = await putTeamName(put({ name: "One too many" }), params(leagueId));
    expect(refused.status).toBe(429);
    expect((await refused.json()).error).toContain("Give it a minute");

    // The refused write never reached the database: the ceiling is checked before the body is
    // even parsed, so the last accepted name is still the stored one.
    const [row] = await db.select({ name: teams.name }).from(teams).where(eq(teams.userId, "u1"));
    expect(row?.name).toBe(`Name ${IDENTITY_CONFIG.profileRateLimit.maxRequests - 1}`);
  });

  it("keys the ceiling per user, so one manager cannot spend another's budget", async () => {
    const leagueId = await league();
    signedInAs("u1");
    for (let n = 0; n < IDENTITY_CONFIG.profileRateLimit.maxRequests; n += 1) {
      await putTeamName(put({ name: `Name ${n}` }), params(leagueId));
    }
    signedInAs("u2");
    const theirs = await putTeamName(put({ name: "Iron Owls" }), params(leagueId));
    expect(theirs.status).toBe(200);
  });
});
