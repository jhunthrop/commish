import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";

vi.hoisted(() => {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://commish:commish@localhost:5433/commish_test";
  process.env.REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
});

vi.mock("@/lib/auth/current-user", () => ({
  getCurrentUser: vi.fn(),
  requireCurrentUser: vi.fn(),
}));

// Wraps the real implementation by default (every existing test below hits the real DB
// through it unchanged); only the 500-boundary test overrides it for one call.
vi.mock("@/league-service/browse", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/league-service/browse")>();
  return { ...actual, listPublicLeagues: vi.fn(actual.listPublicLeagues) };
});

import { createTestDb, truncateAll } from "@/db/test-db";
import { drafts, leagues, players, playerStatLines, rosterSlots, teams, users } from "@/db/schema";
import { getCurrentUser, requireCurrentUser } from "@/lib/auth/current-user";
import { POST as postLeague } from "@/app/api/leagues/route";
import { GET as getLeague } from "@/app/api/leagues/[leagueId]/route";
import { GET as getMatchups } from "@/app/api/leagues/[leagueId]/matchups/[week]/route";
import { POST as postScore } from "@/app/api/leagues/[leagueId]/weeks/[week]/score/route";
import { GET as browsePublic } from "@/app/api/public/leagues/route";
import { listPublicLeagues, PUBLIC_LEAGUE_FIELDS } from "@/league-service/browse";
import { leagueHome, matchupWeek } from "./read";
import { writeSchedule } from "./schedule";

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

/** A second team, a two-week schedule, and one scoreable quarterback per side. */
async function playableSeason(leagueId: string, homeTeamId: string) {
  await db.insert(teams).values({ id: "team_2", leagueId, userId: "u2", name: "Team Two" });
  await db.insert(players).values([
    { id: "qb1", name: "QB One", position: "QB", nflTeam: "KC" },
    { id: "qb2", name: "QB Two", position: "QB", nflTeam: "SF" },
  ]);
  await db.insert(playerStatLines).values([
    { playerId: "qb1", week: 1, passingYards: 300, passingTouchdowns: 3 },
    { playerId: "qb2", week: 1, passingYards: 100 },
  ]);
  await db.insert(rosterSlots).values([
    { teamId: homeTeamId, slot: "QB", slotIndex: 0, playerId: "qb1" },
    { teamId: "team_2", slot: "QB", slotIndex: 0, playerId: "qb2" },
  ]);
  await db.transaction((tx) => writeSchedule(tx, { leagueId, teamIds: [homeTeamId, "team_2"], weeks: 2 }));
}

const leagueRequest = (leagueId: string) => new Request(`http://test/api/leagues/${leagueId}`);

describe("GET /api/leagues/[leagueId]", () => {
  it("answers 403 for a signed-in stranger", async () => {
    const created = await createDefaultLeague("u1");
    signedInAs("u2");
    const response = await getLeague(leagueRequest(created.leagueId), {
      params: Promise.resolve({ leagueId: created.leagueId }),
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ ok: false, error: "You don't have a team in this league." });
  });

  it("returns standings, the roster shape and the draft's state for a member", async () => {
    const created = await createDefaultLeague("u1");
    signedInAs("u1");
    const body = (await (await getLeague(leagueRequest(created.leagueId), {
      params: Promise.resolve({ leagueId: created.leagueId }),
    })).json()).data;
    expect(body).toMatchObject({
      leagueId: created.leagueId, name: "Sunday Money", isCommissioner: true,
      myTeamId: created.teamId, draftId: created.draftId, draftStatus: "scheduled",
      currentWeek: 1, myMatchup: null,
    });
    expect(body.standings).toHaveLength(1);
    expect(body.rosterSlots.length).toBeGreaterThan(0);
  });

  it("answers 404 for a league that doesn't exist", async () => {
    signedInAs("u1");
    const response = await getLeague(leagueRequest("nope"), { params: Promise.resolve({ leagueId: "nope" }) });
    expect(response.status).toBe(404);
  });
});

describe("POST /api/leagues/[leagueId]/weeks/[week]/score", () => {
  it("is commissioner-only and rejects a week that isn't in the season", async () => {
    const created = await createDefaultLeague("u1");
    signedInAs("u2");
    const denied = await postScore(new Request("http://test", { method: "POST" }), {
      params: Promise.resolve({ leagueId: created.leagueId, week: "1" }),
    });
    expect(denied.status).toBe(403);

    signedInAs("u1");
    const missing = await postScore(new Request("http://test", { method: "POST" }), {
      params: Promise.resolve({ leagueId: created.leagueId, week: "1" }),
    });
    expect(missing.status).toBe(404);
    expect((await missing.json()).error).toBe("That week isn't part of this league's season.");
  });

  it("answers 400 for a week that isn't a number", async () => {
    const created = await createDefaultLeague("u1");
    signedInAs("u1");
    const response = await postScore(new Request("http://test", { method: "POST" }), {
      params: Promise.resolve({ leagueId: created.leagueId, week: "banana" }),
    });
    expect(response.status).toBe(400);
  });

  it("scores the week for the commissioner, and the matchup page shows both lineups", async () => {
    const created = await createDefaultLeague("u1");
    await playableSeason(created.leagueId, created.teamId);

    signedInAs("u1");
    const scored = await postScore(new Request("http://test", { method: "POST" }), {
      params: Promise.resolve({ leagueId: created.leagueId, week: "1" }),
    });
    expect(scored.status).toBe(200);
    expect((await scored.json()).data).toEqual({ weekNumber: 1, matchupsScored: 1 });

    const body = (await (await getMatchups(new Request(`http://test/api/leagues/${created.leagueId}/matchups/1`), {
      params: Promise.resolve({ leagueId: created.leagueId, week: "1" }),
    })).json()).data;
    expect(body).toMatchObject({ leagueId: created.leagueId, weekNumber: 1, totalWeeks: 2, myTeamId: created.teamId });
    expect(body.matchups).toHaveLength(1);
    const [detail] = body.matchups;
    expect(detail.final).toBe(true);
    // 300 * 0.04 + 3 * 4 = 24 against 100 * 0.04 = 4, whichever side drew home.
    expect([detail.home.score, detail.away.score].sort((a: number, b: number) => b - a)).toEqual([24, 4]);
    const scoringQb = [...detail.home.starters, ...detail.away.starters].find(
      (entry: { playerId: string | null }) => entry.playerId === "qb1",
    );
    expect(scoringQb).toMatchObject({ slot: "QB", playerName: "QB One", position: "QB", points: 24 });
    // The league's default roster shape has a bench, and it is reported separately.
    expect(detail.home.bench.length).toBeGreaterThan(0);
  });

  it("answers 400 for a matchup week that isn't a number, and an empty week outside the season", async () => {
    const created = await createDefaultLeague("u1");
    signedInAs("u1");
    const bad = await getMatchups(new Request("http://test/api/leagues/x/matchups/banana"), {
      params: Promise.resolve({ leagueId: created.leagueId, week: "banana" }),
    });
    expect(bad.status).toBe(400);

    const empty = await getMatchups(new Request("http://test/api/leagues/x/matchups/3"), {
      params: Promise.resolve({ leagueId: created.leagueId, week: "3" }),
    });
    expect(empty.status).toBe(200);
    expect((await empty.json()).data).toMatchObject({ weekNumber: 3, matchups: [] });
  });

  it("answers 404 when the matchup page is asked for a league that doesn't exist", async () => {
    signedInAs("u1");
    const response = await getMatchups(new Request("http://test/api/leagues/nope/matchups/1"), {
      params: Promise.resolve({ leagueId: "nope", week: "1" }),
    });
    expect(response.status).toBe(404);
  });
});

describe("the read models' own guards", () => {
  it("answer null for a league that doesn't exist — the routes' 404 never reaches them", async () => {
    expect(await leagueHome(db, "nope", "u1")).toBeNull();
    expect(await matchupWeek(db, "nope", 1, "u1")).toBeNull();
  });
});

describe("GET /api/public/leagues", () => {
  it("answers a signed-OUT visitor, because public browse is deliberately unauthenticated", async () => {
    signedInAs(null);
    await db.insert(leagues).values({
      id: "open", name: "Rookie Snake Room", format: "snake", teamCount: 12,
      stakeTier: 0, experienceTier: "beginner", isPublicMatchmade: true, commissionerUserId: "u1",
    });
    await db.insert(drafts).values({
      id: "open_draft", leagueId: "open", format: "snake", status: "scheduled",
      kickoffAt: new Date("2026-09-10T17:00:00.000Z"), auctionBudget: null,
    });

    const response = await browsePublic(new Request("http://test/api/public/leagues"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.data.leagues).toHaveLength(1);
    expect(Object.keys(body.data.leagues[0]).sort()).toEqual([...PUBLIC_LEAGUE_FIELDS].sort());
  });

  it("narrows on the query string and shrugs off a format the engine cannot run", async () => {
    signedInAs(null);
    await db.insert(leagues).values([
      { id: "s", name: "Rookie Snake Room", format: "snake", teamCount: 12, stakeTier: 0, experienceTier: "beginner", isPublicMatchmade: true, commissionerUserId: "u1" },
      { id: "a", name: "Sharks Auction", format: "auction", teamCount: 12, stakeTier: 3, experienceTier: "experienced", isPublicMatchmade: true, commissionerUserId: "u1" },
    ]);
    await db.insert(drafts).values([
      { id: "s_draft", leagueId: "s", format: "snake", status: "scheduled", kickoffAt: new Date("2026-09-10T17:00:00.000Z"), auctionBudget: null },
      { id: "a_draft", leagueId: "a", format: "auction", status: "scheduled", kickoffAt: new Date("2026-09-10T17:00:00.000Z"), auctionBudget: 200 },
    ]);

    const narrowed = await browsePublic(new Request("http://test/api/public/leagues?format=auction"));
    expect((await narrowed.json()).data.leagues.map((l: { id: string }) => l.id)).toEqual(["a"]);

    // A hand-edited URL naming a format we do not run is answered with the unfiltered list.
    const junk = await browsePublic(new Request("http://test/api/public/leagues?format=dynasty"));
    expect((await junk.json()).data.leagues).toHaveLength(2);
  });

  it("answers a generic 500 and never leaks the raw error — with no session read at all", async () => {
    vi.mocked(listPublicLeagues).mockRejectedValueOnce(new Error("raw exception text that must never reach the client"));
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const response = await browsePublic(new Request("http://test/api/public/leagues"));
      expect(response.status).toBe(500);
      const body = await response.json();
      expect(body).toEqual({ ok: false, error: "Something went wrong on our side. Please try again." });
      expect(JSON.stringify(body)).not.toContain("raw exception text");
      expect(consoleSpy).toHaveBeenCalled();
      // The 500 boundary caught the throw before any identity check could even run.
      expect(getCurrentUser).not.toHaveBeenCalled();
    } finally {
      consoleSpy.mockRestore();
    }
  });
});
