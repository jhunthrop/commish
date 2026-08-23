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
import { drafts, teams, users } from "@/db/schema";
import { STANDARD_ROSTER_SLOTS } from "@/domain/roster";
import { getCurrentUser, requireCurrentUser } from "@/lib/auth/current-user";
import { LEAGUE_CONFIG } from "@/league";
import { createLeague } from "@/league-service/creation";
import { GET as getDraftSchedule, PUT as putDraftSchedule } from "./route";

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
/** The route's `PUT` runs `setDraftKickoff` against the real wall clock (no test-injectable
 *  clock crosses the HTTP boundary — see `_shared.ts`'s own `systemClock` idiom), so a
 *  "successful move" case needs a moment that is safely in the future AND safely inside
 *  `LEAGUE_CONFIG.defaults.maxDraftDaysAhead` relative to whenever this test actually
 *  runs, rather than a literal that could age past either bound. */
const NEAR_FUTURE = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString();

const get = () => new Request("http://test/draft-schedule");
const put = (body: unknown) =>
  new Request("http://test/draft-schedule", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

/** A two-manager league whose draft is still `scheduled` — unlike `twoTeamLeague`
 *  (`@/league-service/test-support`), which deliberately marks its draft `complete` for the
 *  season fixtures that build on it, this route's whole surface is a `scheduled` draft. */
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

describe("GET /api/leagues/[leagueId]/draft-schedule", () => {
  it("answers the draft's schedule for any league member", async () => {
    const league = await scheduledLeague();
    signedInAs("u1");
    const response = await getDraftSchedule(get(), { params: Promise.resolve({ leagueId: league.leagueId }) });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toMatchObject({ draftId: league.draftId, leagueId: league.leagueId, status: "scheduled", isPublicMatchmade: false });
  });

  it("answers 403 for a stranger with no team in the league", async () => {
    const league = await scheduledLeague();
    await db.insert(users).values({ id: "u3", email: "u3@test.local", displayName: "Manager 3" });
    signedInAs("u3");
    const response = await getDraftSchedule(get(), { params: Promise.resolve({ leagueId: league.leagueId }) });
    expect(response.status).toBe(403);
  });

  it("answers 404 for a league that doesn't exist", async () => {
    signedInAs("nobody");
    const response = await getDraftSchedule(get(), { params: Promise.resolve({ leagueId: "nope" }) });
    expect(response.status).toBe(404);
  });
});

describe("PUT /api/leagues/[leagueId]/draft-schedule", () => {
  it("lets the commissioner move the time", async () => {
    const league = await scheduledLeague();
    signedInAs("u1");
    const response = await putDraftSchedule(put({ kickoffAt: NEAR_FUTURE }), {
      params: Promise.resolve({ leagueId: league.leagueId }),
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.kickoffAt).toBe(NEAR_FUTURE);
    const [row] = await db.select({ kickoffAt: drafts.kickoffAt }).from(drafts).where(eq(drafts.leagueId, league.leagueId));
    expect(row!.kickoffAt.toISOString()).toBe(NEAR_FUTURE);
  });

  it("answers 404 to a member who is not the commissioner, never 403", async () => {
    const league = await scheduledLeague();
    signedInAs("u2");
    const response = await putDraftSchedule(put({ kickoffAt: NEAR_FUTURE }), {
      params: Promise.resolve({ leagueId: league.leagueId }),
    });
    expect(response.status).toBe(404);
  });

  it("answers 403 for a stranger with no team in the league", async () => {
    const league = await scheduledLeague();
    await db.insert(users).values({ id: "u3", email: "u3@test.local", displayName: "Manager 3" });
    signedInAs("u3");
    const response = await putDraftSchedule(put({ kickoffAt: NEAR_FUTURE }), {
      params: Promise.resolve({ leagueId: league.leagueId }),
    });
    expect(response.status).toBe(403);
  });

  it("answers 400 for a body that isn't a valid ISO instant", async () => {
    const league = await scheduledLeague();
    signedInAs("u1");
    const response = await putDraftSchedule(put({ kickoffAt: "not a date" }), {
      params: Promise.resolve({ leagueId: league.leagueId }),
    });
    expect(response.status).toBe(400);
  });

  it("answers the service's own refusal verbatim for a time in the past", async () => {
    const league = await scheduledLeague();
    signedInAs("u1");
    const response = await putDraftSchedule(put({ kickoffAt: "2020-01-01T00:00:00.000Z" }), {
      params: Promise.resolve({ leagueId: league.leagueId }),
    });
    expect(response.status).toBe(422);
    expect((await response.json()).error).toBe("Pick a time in the future so everyone has a chance to show up.");
  });
});
