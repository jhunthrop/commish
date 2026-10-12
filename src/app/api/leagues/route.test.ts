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
import { leagues, scoringSettings, teams, users } from "@/db/schema";
import { STANDARD_ROSTER_SLOTS } from "@research-ts/domain/roster";
import { getCurrentUser, requireCurrentUser } from "@/lib/auth/current-user";
import { INTEGRITY_CONFIG } from "@/integrity/config";
import { ENFORCEMENT_REFUSALS } from "@/league-service/enforcement";
import { SUPERFLEX_ROSTER_SLOTS } from "@research-ts/domain/roster-shape";
import { describeScoring } from "@research-ts/scoring/describe";
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

  /**
   * Task 1 (superflex + canon defaults). §4.2's launch canon: "half-PPR default with PPR /
   * TE-premium / superflex toggles" — proved end to end, from a bare `{ "name": "…" }` request
   * through the route's own default resolution, not just at `LEAGUE_CONFIG` in isolation.
   */
  it("creates a half-PPR, standard-shape league by default, and leaves every toggle reachable", async () => {
    await db.insert(users).values({ id: "u_defaults", email: "u_defaults@test.local", displayName: "Defaults" });
    signedInAs("u_defaults");

    const response = await post({ name: "Sunday Money" });
    expect(response.status).toBe(201);
    const body = (await response.json()) as { readonly ok: true; readonly data: { readonly leagueId: string } };

    const [league] = await db.select().from(leagues).where(eq(leagues.id, body.data.leagueId));
    expect(league!.rosterSlots).toEqual(STANDARD_ROSTER_SLOTS);

    const [settings] = await db.select().from(scoringSettings).where(eq(scoringSettings.leagueId, body.data.leagueId));
    expect(describeScoring(settings!)).toBe("Half PPR");
  });

  it("creates a superflex league when the toggle is set, without changing anything else's default", async () => {
    await db.insert(users).values({ id: "u_superflex", email: "u_superflex@test.local", displayName: "Superflex" });
    signedInAs("u_superflex");

    const response = await post({ name: "Two QB League", rosterShape: "superflex" });
    expect(response.status).toBe(201);
    const body = (await response.json()) as { readonly ok: true; readonly data: { readonly leagueId: string } };

    const [league] = await db.select().from(leagues).where(eq(leagues.id, body.data.leagueId));
    expect(league!.rosterSlots).toEqual(SUPERFLEX_ROSTER_SLOTS);

    // The toggle sits on the roster shape alone — scoring still defaults to half-PPR.
    const [settings] = await db.select().from(scoringSettings).where(eq(scoringSettings.leagueId, body.data.leagueId));
    expect(describeScoring(settings!)).toBe("Half PPR");
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

  /**
   * FINAL REVIEW ROUND 2, R2 — the wire half of the create form's new designation control. Before
   * it existed, the form sent no `experienceTier` at all, so the route's own
   * `?? user.experienceTier` fallback silently declared every league for whatever the CREATOR had
   * self-reported at sign-up. A veteran whose profile said "New to fantasy" therefore always
   * created a `beginner` league and could never create a public one at all.
   */
  it("persists the designation the caller chose, rather than the creator's own self-reported tier", async () => {
    // A veteran whose PROFILE still says `beginner` — the exact account the missing control
    // stranded, and the one whose two outcomes now differ only by what the control sends.
    await giveCompletedSeasons("u_vet_designation", INTEGRITY_CONFIG.participation.veteranSeasonCutoff);
    await db.update(users).set({ experienceTier: "beginner" }).where(eq(users.id, "u_vet_designation"));
    signedInAs("u_vet_designation");

    // The control's own default: open to everyone. It succeeds where the old implicit fallback
    // could not, and the league stores what was chosen.
    const open = await post({ name: "Open Room", visibility: "public", experienceTier: "experienced" });
    expect(open.status).toBe(201);
    const openBody = (await open.json()) as { readonly ok: true; readonly data: { readonly leagueId: string } };
    const [openLeague] = await db.select().from(leagues).where(eq(leagues.id, openBody.data.leagueId));
    expect(openLeague).toMatchObject({ experienceTier: "experienced", isPublicMatchmade: true });

    // And the reserved choice still reaches the gate, for the same account in the same request
    // shape — so the control is what decides, not the profile.
    const reserved = await post({ name: "Rookie Room", visibility: "public", experienceTier: "beginner" });
    expect(reserved.status).toBe(409);
  });

  it("still falls back to the creator's own tier for an API caller that names none", async () => {
    // The fallback is not deleted, only no longer the form's only behaviour: `experienceTier` is
    // optional in `createLeagueSchema` and a scripted caller may still omit it. `currentUser`
    // above is the session this route reads its default from (`requireCurrentUser`, mocked), and
    // it reports `beginner` — so an omitted field lands there, exactly as it did before, while the
    // test above proves a NAMED field no longer does.
    await db.insert(users).values({ id: "u_fallback", email: "fallback@test.local", displayName: "Fallback" });
    signedInAs("u_fallback");

    const response = await post({ name: "Inherited Room" });
    expect(response.status).toBe(201);
    const body = (await response.json()) as { readonly ok: true; readonly data: { readonly leagueId: string } };
    const [league] = await db.select().from(leagues).where(eq(leagues.id, body.data.leagueId));
    expect(league).toMatchObject({ experienceTier: "beginner" });
  });
});
