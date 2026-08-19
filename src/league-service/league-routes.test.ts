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
import { leagues, users } from "@/db/schema";
import { getCurrentUser, requireCurrentUser } from "@/lib/auth/current-user";
import { GET as listLeagues, POST as postLeague } from "@/app/api/leagues/route";
import { POST as postInvite } from "@/app/api/leagues/[leagueId]/invites/route";
import { POST as postAccept } from "@/app/api/invites/[code]/accept/route";

const db = createTestDb();

const profile = (id: string) => ({
  id, email: `${id}@test.local`, displayName: `Manager ${id}`,
  experienceTier: "beginner" as const, avatarUrl: null, createdAt: "2026-08-17T12:00:00.000Z",
});
const signedInAs = (id: string | null) => {
  vi.mocked(getCurrentUser).mockResolvedValue(id === null ? null : profile(id));
  vi.mocked(requireCurrentUser).mockResolvedValue(profile(id ?? "u1"));
};
const post = (url: string, body: unknown) =>
  new Request(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

beforeEach(async () => {
  await truncateAll(db);
  vi.mocked(getCurrentUser).mockReset();
  vi.mocked(requireCurrentUser).mockReset();
  await db.insert(users).values([
    { id: "u1", email: "u1@test.local", displayName: "Manager u1" },
    { id: "u2", email: "u2@test.local", displayName: "Manager u2" },
  ]);
});

afterAll(async () => {
  await truncateAll(db);
});

async function createDefaultLeague(userId = "u1") {
  signedInAs(userId);
  const response = await postLeague(post("http://test/api/leagues", { name: "Sunday Money" }));
  expect(response.status).toBe(201);
  return (await response.json()).data as { leagueId: string; teamId: string; draftId: string };
}

describe("POST /api/leagues", () => {
  it("answers 401 JSON when nobody is signed in", async () => {
    signedInAs(null);
    const response = await postLeague(post("http://test/api/leagues", { name: "Sunday Money" }));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ ok: false, error: "Not signed in." });
  });

  it("creates a complete league from nothing but a name", async () => {
    const created = await createDefaultLeague();
    expect(created.leagueId).toBeTruthy();
    expect(created.teamId).toBeTruthy();
    expect(created.draftId).toBeTruthy();
  });

  it("answers 400 naming the field for a body it cannot use", async () => {
    signedInAs("u1");
    const response = await postLeague(post("http://test/api/leagues", { name: "" }));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("name");
  });

  it("refuses a league smaller than the configured minimum, in plain language", async () => {
    signedInAs("u1");
    const response = await postLeague(post("http://test/api/leagues", { name: "Too Small", teamCount: 2 }));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("teamCount: A league needs at least 4 teams.");
  });

  it("refuses a league larger than the configured maximum, in plain language", async () => {
    signedInAs("u1");
    const response = await postLeague(post("http://test/api/leagues", { name: "Too Big", teamCount: 24 }));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("teamCount: A league can have at most 16 teams.");
  });

  it("creates an invite-only league by default and takes the creator's own experience tier", async () => {
    signedInAs("u1");
    const response = await postLeague(post("http://test/api/leagues", { name: "Sunday Money" }));
    expect(response.status).toBe(201);
    const { leagueId } = (await response.json()).data as { leagueId: string };
    const [row] = await db.select().from(leagues).where(eq(leagues.id, leagueId));
    expect(row).toMatchObject({ isPublicMatchmade: false, stakeTier: 0, experienceTier: "beginner" });
  });

  it("lists the league publicly when the creator asks for it, at the stake tier they chose", async () => {
    signedInAs("u1");
    const response = await postLeague(
      post("http://test/api/leagues", { name: "Open Room", visibility: "public", stakeTier: 2 }),
    );
    expect(response.status).toBe(201);
    const { leagueId } = (await response.json()).data as { leagueId: string };
    const [row] = await db.select().from(leagues).where(eq(leagues.id, leagueId));
    expect(row).toMatchObject({ isPublicMatchmade: true, stakeTier: 2 });
  });

  it("rejects a stake tier nothing configures, naming the field", async () => {
    signedInAs("u1");
    const response = await postLeague(post("http://test/api/leagues", { name: "Too Rich", stakeTier: 9 }));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("stakeTier");
  });
});

describe("GET /api/leagues", () => {
  it("lists only the leagues the caller fields a team in", async () => {
    const created = await createDefaultLeague("u1");

    signedInAs("u2");
    expect((await (await listLeagues(new Request("http://test/api/leagues"))).json()).data).toEqual({ leagues: [] });

    signedInAs("u1");
    const body = (await (await listLeagues(new Request("http://test/api/leagues"))).json()).data;
    expect(body.leagues).toHaveLength(1);
    expect(body.leagues[0]).toMatchObject({
      id: created.leagueId, name: "Sunday Money", teamCount: 12, filledTeams: 1,
      isCommissioner: true, myTeamId: created.teamId, draftId: created.draftId, draftStatus: "scheduled",
    });
  });
});

describe("invites", () => {
  it("is commissioner-only", async () => {
    const created = await createDefaultLeague("u1");
    signedInAs("u2");
    const response = await postInvite(post(`http://test/api/leagues/${created.leagueId}/invites`, {}), {
      params: Promise.resolve({ leagueId: created.leagueId }),
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ ok: false, error: "Only the commissioner can do that." });
  });

  it("mints a link the commissioner can share, and lets a stranger join with it", async () => {
    const created = await createDefaultLeague("u1");
    signedInAs("u1");
    const invite = (await (await postInvite(post(`http://test/api/leagues/${created.leagueId}/invites`, {}), {
      params: Promise.resolve({ leagueId: created.leagueId }),
    })).json()).data as { code: string; path: string };
    expect(invite.path).toBe(`/app/join/${invite.code}`);

    signedInAs("u2");
    const joined = await postAccept(post(`http://test/api/invites/${invite.code}/accept`, {}), {
      params: Promise.resolve({ code: invite.code }),
    });
    expect(joined.status).toBe(200);
    expect((await joined.json()).data).toMatchObject({ leagueId: created.leagueId, alreadyMember: false });

    const body = (await (await listLeagues(new Request("http://test/api/leagues"))).json()).data;
    expect(body.leagues[0]).toMatchObject({ id: created.leagueId, isCommissioner: false, filledTeams: 2 });
  });

  it("answers 404 with an actionable message for a code that isn't real", async () => {
    signedInAs("u2");
    const response = await postAccept(post("http://test/api/invites/NOSUCH12/accept", {}), {
      params: Promise.resolve({ code: "NOSUCH12" }),
    });
    expect(response.status).toBe(404);
    expect((await response.json()).error).toBe("That invite link isn't valid. Ask your commissioner for a new one.");
  });

  it("answers 404 for an invite on a league that doesn't exist", async () => {
    signedInAs("u1");
    const response = await postInvite(post("http://test/api/leagues/nope/invites", {}), {
      params: Promise.resolve({ leagueId: "nope" }),
    });
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ ok: false, error: "That league doesn't exist." });
  });
});
