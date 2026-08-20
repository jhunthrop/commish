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

import { eq } from "drizzle-orm";
import Redis from "ioredis";
import { countingDb, createTestDb, truncateAll } from "@/db/test-db";
import { drafts, leagues, players, playerStatLines, rosterSlots, teams, users } from "@/db/schema";
import type { Player } from "@/domain/player";
import { PPR_SCORING, type ScoringSettings } from "@/domain/scoring";
import { getCurrentUser, requireCurrentUser } from "@/lib/auth/current-user";
import { POST as postLeague } from "@/app/api/leagues/route";
import { GET as getLeague } from "@/app/api/leagues/[leagueId]/route";
import { GET as getMatchups } from "@/app/api/leagues/[leagueId]/matchups/[week]/route";
import { GET as browsePublic } from "@/app/api/public/leagues/route";
import { resetBrowseRateLimit } from "@/app/api/public/leagues/_shared";
import { listPublicLeagues, PUBLIC_LEAGUE_FIELDS } from "@/league-service/browse";
import { MATCHMAKING_CONFIG } from "@/matchmaking/config";
import { STATS_INGESTION_CONFIG } from "@/stats-pipeline/config";
import { finalizeWeek } from "@/stats-pipeline/finalize";
import type { ReferenceCache } from "@/stats-pipeline/reference-cache";
import { BASELINE_LEAGUE_HOME_QUERIES, leagueHome, matchupWeek } from "./read";
import { writeSchedule } from "./schedule";

const db = createTestDb();

/**
 * `GET /matchups/[week]` is now wired to the process-wide `getReferenceCache()`
 * (`@/league-service/reference-cache-instance.ts`), a REAL Redis connection — `truncateAll`
 * clears Postgres between tests but has nothing to do with Redis, and the player index lives
 * under one GLOBAL key (`STATS_INGESTION_CONFIG.keys.playerIndex`, never scoped by league), so a
 * value one test's `playableSeason` cached would otherwise outlive that test and answer a LATER
 * one with a stale roster. `fileParallelism: false` (`vitest.config.mts`) is what makes a
 * beforeEach/afterAll `del` here — mirroring `reference-cache.test.ts`'s own `control` connection
 * — sufficient rather than racy.
 */
const redisControl = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379");

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
  await redisControl.del(STATS_INGESTION_CONFIG.keys.playerIndex);
  vi.mocked(getCurrentUser).mockReset();
  vi.mocked(requireCurrentUser).mockReset();
  resetBrowseRateLimit();
  await db.insert(users).values([
    { id: "u1", email: "u1@test.local", displayName: "Manager u1" },
    { id: "u2", email: "u2@test.local", displayName: "Manager u2" },
  ]);
});

afterAll(async () => {
  await truncateAll(db);
  await redisControl.del(STATS_INGESTION_CONFIG.keys.playerIndex);
  redisControl.disconnect();
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
  // `finalizeWeek` refuses an undrafted league (Plan B Task 5's guard) — this fixture stands
  // in for a season already underway, so the draft it's built on is done.
  await db.update(drafts).set({ status: "complete" }).where(eq(drafts.leagueId, leagueId));
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
      currentWeek: 1, myMatchup: null, commissionerUserId: "u1",
    });
    expect(body.standings).toHaveLength(1);
    expect(body.rosterSlots.length).toBeGreaterThan(0);
  });

  // Step 15's audit: standings and the members list both need the owner, not just the team —
  // and both must carry it without a second query duplicating what `listTeamCards` already read.
  it("carries the owner's name and face through to both the members list and the standings row", async () => {
    const created = await createDefaultLeague("u1");
    await db.insert(teams).values({ id: "team_2", leagueId: created.leagueId, userId: "u2", name: "Team Two" });
    signedInAs("u1");
    const body = (await (await getLeague(leagueRequest(created.leagueId), {
      params: Promise.resolve({ leagueId: created.leagueId }),
    })).json()).data;

    const mine = body.teams.find((team: { id: string }) => team.id === created.teamId);
    expect(mine).toMatchObject({ ownerUserId: "u1", ownerDisplayName: "Manager u1" });
    const other = body.teams.find((team: { id: string }) => team.id === "team_2");
    expect(other).toMatchObject({ ownerUserId: "u2", ownerDisplayName: "Manager u2" });

    const standingsRow = body.standings.find((row: { teamId: string }) => row.teamId === created.teamId);
    expect(standingsRow).toMatchObject({ ownerDisplayName: "Manager u1" });
    expect(standingsRow.ownerAvatar).toBeNull();
  });

  it("costs the same bounded number of queries whether or not the standings and members list carry the owner", async () => {
    const created = await createDefaultLeague("u1");
    await db.insert(teams).values({ id: "team_2", leagueId: created.leagueId, userId: "u2", name: "Team Two" });

    const counting = countingDb(db);
    const home = await leagueHome(counting.db, created.leagueId, "u1");
    expect(home?.teams).toHaveLength(2);
    expect(home?.standings).toHaveLength(2);
    // `BASELINE_LEAGUE_HOME_QUERIES` (`./read`) — the same bound whichever league is asked, and
    // `leagueStandings` no longer runs a second `teams` query of its own for names.
    expect(counting.selectCount()).toBeLessThanOrEqual(BASELINE_LEAGUE_HOME_QUERIES);
  });

  // Task 8: the terms panel that renders on the invite page also renders inside the league, fed
  // by this same read — gating it on `isCommissioner` would make the surface pointless, since
  // the terms are what everybody in the league is playing under, not a commissioner-only fact.
  it("gives every member the league's terms, not just the commissioner", async () => {
    const created = await createDefaultLeague("u1");
    await db.insert(teams).values({ id: "team_2", leagueId: created.leagueId, userId: "u2", name: "Team Two" });

    const asMember = await leagueHome(db, created.leagueId, "u2");
    expect(asMember!.terms.scoringLabel).toBe("PPR");
    expect(asMember!.terms.commissionerName).toBe("Manager u1");
    expect(asMember!.isCommissioner).toBe(false);
  });

  // The terms are assembled from rows `leagueHome` already holds — the league, its scoring
  // settings and its teams — not fetched a second time the way a naive "reuse `invitePreview`"
  // implementation would.
  it("costs no extra round trip beyond the terms' own scoring-settings read", async () => {
    const created = await createDefaultLeague("u1");
    const counting = countingDb(db);
    await leagueHome(counting.db, created.leagueId, "u1");
    expect(counting.selectCount()).toBe(BASELINE_LEAGUE_HOME_QUERIES);
  });

  it("answers 404 for a league that doesn't exist", async () => {
    signedInAs("u1");
    const response = await getLeague(leagueRequest("nope"), { params: Promise.resolve({ leagueId: "nope" }) });
    expect(response.status).toBe(404);
  });
});

describe("GET /api/leagues/[leagueId]/matchups/[week]", () => {
  it("shows both lineups once finalizeWeek has settled the week", async () => {
    const created = await createDefaultLeague("u1");
    await playableSeason(created.leagueId, created.teamId);

    signedInAs("u1");
    const scored = await finalizeWeek(db, created.leagueId, 1);
    expect(scored).toEqual({ ok: true, weekNumber: 1, matchupsScored: 1 });

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

/**
 * A stand-in `ReferenceCache` that records whether its OWN `load` argument was ever invoked —
 * mirroring `reference-cache.test.ts`'s `vi.fn(load)` idiom one remove out, since `matchupWeek`
 * builds `load` itself rather than taking one from the caller. A `hit` value is returned WITHOUT
 * ever calling `load` (a cache hit, `loadCalls` stays 0); omitting one always calls through and
 * returns its result (a miss) — structurally identical to `matchupWeek`'s own unexported no-op
 * default, `players: (load) => load()` / `scoringSettings: (_, load) => load()`, which is what
 * makes this the faithful stand-in for "no cache injected at all".
 */
function recordingReferenceCache(hit: { readonly players?: readonly Player[]; readonly scoringSettings?: ScoringSettings } = {}): {
  readonly cache: Pick<ReferenceCache, "players" | "scoringSettings">;
  readonly loadCalls: { players: number; scoringSettings: number };
} {
  const loadCalls = { players: 0, scoringSettings: 0 };
  const cache: Pick<ReferenceCache, "players" | "scoringSettings"> = {
    players: async (load) => {
      if (hit.players !== undefined) return hit.players;
      loadCalls.players += 1;
      return load();
    },
    scoringSettings: async (_leagueId, load) => {
      if (hit.scoringSettings !== undefined) return hit.scoringSettings;
      loadCalls.scoringSettings += 1;
      return load();
    },
  };
  return { cache, loadCalls };
}

describe("matchupWeek's reference cache", () => {
  it("calls load on a miss, and skips it entirely on a hit", async () => {
    const created = await createDefaultLeague("u1");
    await playableSeason(created.leagueId, created.teamId);

    // MISS: structurally the no-op default's own behavior — `load` runs, and its result (the
    // TRUE roster and settings) is what the response reflects.
    const miss = recordingReferenceCache();
    const missBody = await matchupWeek(db, created.leagueId, 1, "u1", miss.cache);
    expect(miss.loadCalls).toEqual({ players: 1, scoringSettings: 1 });
    const trueQb = [...missBody!.matchups[0]!.home.starters, ...missBody!.matchups[0]!.away.starters].find(
      (entry) => entry.playerId === "qb1",
    );
    expect(trueQb).toMatchObject({ playerName: "QB One", points: 24 });

    // HIT: `load` never runs at all. A decoy player index (wrong name) and decoy scoring rules
    // (touchdowns worth 0) prove the response came from the CACHE, not from a DB read that just
    // happened to agree with it.
    const decoyPlayers: readonly Player[] = [{ id: "qb1", name: "Cached Impostor", position: "QB", nflTeam: "KC" }];
    const decoySettings: ScoringSettings = { leagueId: created.leagueId, ...PPR_SCORING, pointsPerPassingTouchdown: 0 };
    const hit = recordingReferenceCache({ players: decoyPlayers, scoringSettings: decoySettings });
    const hitBody = await matchupWeek(db, created.leagueId, 1, "u1", hit.cache);
    expect(hit.loadCalls).toEqual({ players: 0, scoringSettings: 0 });
    const cachedQb = [...hitBody!.matchups[0]!.home.starters, ...hitBody!.matchups[0]!.away.starters].find(
      (entry) => entry.playerId === "qb1",
    );
    // 300 * 0.04 + 3 * 0 = 12, not the true 24 — the decoy settings drove the math.
    expect(cachedQb).toMatchObject({ playerName: "Cached Impostor", points: 12 });
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

  it("answers a signed-in and a signed-out caller with a byte-identical body", async () => {
    await db.insert(leagues).values({
      id: "open", name: "Rookie Snake Room", format: "snake", teamCount: 12,
      stakeTier: 0, experienceTier: "beginner", isPublicMatchmade: true, commissionerUserId: "u1",
    });
    await db.insert(drafts).values({
      id: "open_draft", leagueId: "open", format: "snake", status: "scheduled",
      kickoffAt: new Date("2026-09-10T17:00:00.000Z"), auctionBudget: null,
    });

    signedInAs(null);
    const signedOutBody = await (await browsePublic(new Request("http://test/api/public/leagues"))).text();
    signedInAs("u1");
    const signedInBody = await (await browsePublic(new Request("http://test/api/public/leagues"))).text();
    // Pins the property to a BEHAVIOUR (the two responses are literally identical bytes), not
    // to a reading of the handler's imports — a later refactor that starts branching on the
    // caller's identity would fail this even if it never touched `getCurrentUser` by name.
    expect(signedInBody).toEqual(signedOutBody);
  });

  it("refuses a caller looping the endpoint past the per-IP ceiling, before the query ever runs", async () => {
    signedInAs(null);
    const request = () => new Request("http://test/api/public/leagues", { headers: { "x-forwarded-for": "203.0.113.9" } });
    for (let i = 0; i < MATCHMAKING_CONFIG.browseRateLimit.maxRequests; i += 1) {
      expect((await browsePublic(request())).status).toBe(200);
    }
    const callsBeforeLimit = vi.mocked(listPublicLeagues).mock.calls.length;
    const limited = await browsePublic(request());
    expect(limited.status).toBe(429);
    // The rate limit runs BEFORE the query: a limited request never reaches `listPublicLeagues`.
    expect(vi.mocked(listPublicLeagues).mock.calls.length).toBe(callsBeforeLimit);

    // A DIFFERENT caller (a different forwarded-for) spends its own budget, not this one's.
    const other = await browsePublic(new Request("http://test/api/public/leagues", { headers: { "x-forwarded-for": "203.0.113.99" } }));
    expect(other.status).toBe(200);
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
