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
import type { Db } from "@research/db/client";
import { createTestDb } from "@research/db/test-db";
import { truncateAll } from "@/db/test-db";
import { drafts, leagues, users } from "@/db/schema";
import { listLeaguesForUser, toSummary } from "./read";
import { LEAGUE_CONFIG } from "@/league";
import { getCurrentUser, requireCurrentUser } from "@/lib/auth/current-user";
import { GET as listLeagues, POST as postLeague } from "@/app/api/leagues/route";
import { POST as postInvite } from "@/app/api/leagues/[leagueId]/invites/route";
import { POST as postAccept } from "@/app/api/invites/[code]/accept/route";
import { GET as getInvitePreview } from "@/app/api/invites/[code]/route";
import { resetInvitePreviewRateLimit } from "@/app/api/invites/[code]/_shared";
import { POST as postPublicJoin } from "@/app/api/public/leagues/[leagueId]/join/route";

const db = createTestDb();

const profile = (id: string) => ({
  id, email: `${id}@test.local`, displayName: `Manager ${id}`,
  experienceTier: "beginner" as const, avatarUrl: null, createdAt: "2026-08-17T12:00:00.000Z", isAdmin: false,
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
  resetInvitePreviewRateLimit();
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

  it("falls back on every '??' guard a league's own membership rows can never actually violate through real Postgres", async () => {
    // `myLeaguesOverview`'s `ids` — the set every other query is scoped to — comes directly from
    // the caller's own team rows, so a REAL Postgres read can never hand `listLeaguesForUser` a
    // league with no matching team/draft/myTeamByLeague entry. A stub `Db` whose four
    // independent SELECTs disagree with each other is the only way to prove the fallbacks below
    // that call are real code, not merely present — mirrors `home.test.ts`'s identical proof for
    // `crossLeagueHome`, which extends the very same shared read.
    interface Thenable {
      then(resolve: (value: readonly unknown[]) => void): void;
      where(): Thenable;
      orderBy(): Thenable;
      innerJoin(): Thenable;
    }
    function thenableChain(data: readonly unknown[]): Thenable {
      const chain: Thenable = {
        then: (resolve) => resolve(data),
        where: () => chain,
        orderBy: () => chain,
        // The `users` join on the SAME `teams` statement (2026-09-11) — one more link in the
        // chain, the same held response.
        innerJoin: () => chain,
      };
      return chain;
    }
    const responses: (readonly unknown[])[] = [
      [{ leagueId: "lg_real", teamId: "team_real" }], // myLeaguesOverview: "mine"
      [
        { id: "lg_real", name: "Real League", format: "snake", teamCount: 2, stakeTier: 0, isPublicMatchmade: false, experienceTier: "beginner", commissionerUserId: "u1", houseRung: null, rosterSlots: [], createdAt: new Date() },
        // A league Postgres could never actually return here — its id is absent from `ids`.
        { id: "lg_phantom", name: "Phantom League", format: "snake", teamCount: 2, stakeTier: 0, isPublicMatchmade: false, experienceTier: "beginner", commissionerUserId: "u1", houseRung: null, rosterSlots: [], createdAt: new Date() },
      ], // leagueRows
      [{ id: "team_real", leagueId: "lg_real", name: "Real Team", userId: "u1", managerName: "Manager One", managerAvatar: null }], // teamRows — none for lg_phantom
      [], // draftRows — none for either league
    ];
    let call = 0;
    const stubDb = {
      select: () => ({
        from: () => {
          const data = responses[call] ?? [];
          call += 1;
          return thenableChain(data);
        },
      }),
    } as unknown as Db;

    const summaries = await listLeaguesForUser(stubDb, "u1");
    const phantom = summaries.find((league) => league.id === "lg_phantom");
    expect(phantom).toMatchObject({ filledTeams: 0, myTeamId: null, draftId: null, draftStatus: null });
  });
});

describe("toSummary", () => {
  it("falls back to the raw team id when a name can't be found for it in the map it was handed", () => {
    // Every real caller (`leagueHome`, `crossLeagueHome`) builds `nameById` from the SAME
    // league's `teams` rows the matchup itself references, so a real matchup's team is always
    // in it — this proves the fallback directly, against the pure function, rather than trying
    // to engineer that mismatch through either caller's own DB reads.
    const row = { leagueId: "lg_x", weekNumber: 1, homeTeamId: "team_ghost_home", awayTeamId: "team_ghost_away", homeScore: null, awayScore: null };
    const summary = toSummary(row, new Map(), "scheduled");
    expect(summary.homeTeamName).toBe("team_ghost_home");
    expect(summary.awayTeamName).toBe("team_ghost_away");
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
    expect((await response.json()).error).toBe("That invite link is not valid. Ask your commissioner for a new one.");
  });

  it("answers 404 for an invite on a league that doesn't exist", async () => {
    signedInAs("u1");
    const response = await postInvite(post("http://test/api/leagues/nope/invites", {}), {
      params: Promise.resolve({ leagueId: "nope" }),
    });
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ ok: false, error: "That league does not exist." });
  });
});

describe("GET /api/invites/[code]", () => {
  it("names what an invite is agreeing to, with no session required", async () => {
    const created = await createDefaultLeague("u1");
    signedInAs("u1");
    const invite = (await (await postInvite(post(`http://test/api/leagues/${created.leagueId}/invites`, {}), {
      params: Promise.resolve({ leagueId: created.leagueId }),
    })).json()).data as { code: string };

    // No signed-in caller at all — this route answers a stranger holding the link.
    signedInAs(null);
    const response = await getInvitePreview(new Request(`http://test/api/invites/${invite.code}`), {
      params: Promise.resolve({ code: invite.code }),
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
    // Task 1: the create route's default scoring preset flipped from PPR to half-PPR.
    expect(body.data).toMatchObject({
      name: "Sunday Money",
      format: "snake",
      teamCount: 12,
      filledTeams: 1,
      scoringLabel: "Half PPR",
      commissionerName: "Manager u1",
    });
  });

  it("answers 404 with the same refusal accept gives, leaking nothing about any real league", async () => {
    const created = await createDefaultLeague("u1");
    signedInAs(null);
    const response = await getInvitePreview(new Request("http://test/api/invites/NOSUCH12"), {
      params: Promise.resolve({ code: "NOSUCH12" }),
    });
    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body).toEqual({ ok: false, error: "That invite link is not valid. Ask your commissioner for a new one." });
    expect(JSON.stringify(body)).not.toContain(created.leagueId);
  });

  it("refuses a caller looping the endpoint past the per-IP ceiling, before the query ever runs", async () => {
    const request = () =>
      new Request("http://test/api/invites/NOSUCH12", { headers: { "x-forwarded-for": "203.0.113.9" } });
    for (let i = 0; i < LEAGUE_CONFIG.invite.previewRateLimit.maxRequests; i += 1) {
      expect((await getInvitePreview(request(), { params: Promise.resolve({ code: "NOSUCH12" }) })).status).toBe(404);
    }
    const limited = await getInvitePreview(request(), { params: Promise.resolve({ code: "NOSUCH12" }) });
    expect(limited.status).toBe(429);

    // A DIFFERENT caller (a different forwarded-for) spends its own budget, not this one's.
    const other = await getInvitePreview(
      new Request("http://test/api/invites/NOSUCH12", { headers: { "x-forwarded-for": "203.0.113.99" } }),
      { params: Promise.resolve({ code: "NOSUCH12" }) },
    );
    expect(other.status).toBe(404);
  });
});

describe("POST /api/public/leagues/[leagueId]/join", () => {
  async function openLeague(): Promise<string> {
    await db.insert(leagues).values({
      id: "open", name: "Rookie Snake Room", format: "snake", teamCount: 12,
      stakeTier: 0, experienceTier: "beginner", isPublicMatchmade: true, commissionerUserId: "u1",
    });
    await db.insert(drafts).values({
      id: "open_draft", leagueId: "open", format: "snake", status: "scheduled",
      kickoffAt: new Date("2026-09-10T17:00:00.000Z"), auctionBudget: null,
    });
    return "open";
  }

  it("answers 401 JSON when nobody is signed in, never a redirect", async () => {
    const leagueId = await openLeague();
    signedInAs(null);
    const response = await postPublicJoin(post(`http://test/api/public/leagues/${leagueId}/join`, {}), {
      params: Promise.resolve({ leagueId }),
    });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ ok: false, error: "Not signed in." });
  });

  it("seats a signed-in visitor and hands back the league and team to land in", async () => {
    const leagueId = await openLeague();
    signedInAs("u2");
    const response = await postPublicJoin(post(`http://test/api/public/leagues/${leagueId}/join`, {}), {
      params: Promise.resolve({ leagueId }),
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.data).toMatchObject({ leagueId, alreadyMember: false });
    expect(typeof body.data.teamId).toBe("string");
  });

  it("refuses a private league with a 404 and a plain-language next step, identically to a league that doesn't exist", async () => {
    await db.insert(leagues).values({
      id: "private", name: "Group Chat Only", format: "snake", teamCount: 12,
      stakeTier: 0, experienceTier: "beginner", isPublicMatchmade: false, commissionerUserId: "u1",
    });
    // Every real league gets a `drafts` row at creation (`drafts_league_id_idx` is UNIQUE) —
    // seeded here so this fixture matches production and the assertion below is about
    // PRIVACY, not an artifact of `joinLeagueInTx`'s shared draft-status refusal (Phase 4,
    // Task 9 fix round) collapsing a genuinely-unreachable missing-draft case into a refusal.
    await db.insert(drafts).values({
      id: "private_draft", leagueId: "private", format: "snake", status: "scheduled",
      kickoffAt: new Date("2026-09-10T17:00:00.000Z"), auctionBudget: null,
    });
    signedInAs("u2");
    const response = await postPublicJoin(post("http://test/api/public/leagues/private/join", {}), {
      params: Promise.resolve({ leagueId: "private" }),
    });
    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.error).toContain("invite link");

    // Not a 403: this route must not tell a caller apart "this id names a real, private
    // league" from "this id names nothing" — see `publicJoinPrecondition`'s docblock.
    const missing = await postPublicJoin(post("http://test/api/public/leagues/nope/join", {}), {
      params: Promise.resolve({ leagueId: "nope" }),
    });
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual(body);
  });
});
