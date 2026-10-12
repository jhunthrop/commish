import { processTradeReviews } from "./trade-review";
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";

vi.hoisted(() => {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://commish:commish@localhost:5433/commish_test";
  process.env.REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
});

vi.mock("@/lib/auth/current-user", () => ({
  getCurrentUser: vi.fn(),
}));

import { eq } from "drizzle-orm";
import { createTestDb } from "@research/db/test-db";
import { truncateAll } from "@/db/test-db";
import { players, playerStatLines } from "@research/db/schema";
import { leagues, rosterSlots, teams, tradeProposals, users } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth/current-user";
import type { RosterSlotConfig } from "@research/domain/roster";
import { TRADE_CONFIG } from "@/trades/config";
import { proposalFingerprint } from "./trades";
import { seasonCurrentWeek } from "./test-support";
import { GET, POST } from "@/app/api/leagues/[leagueId]/trades/route";
import { POST as POST_DECISION } from "@/app/api/leagues/[leagueId]/trades/[tradeId]/route";
import { resetTradeRateLimit } from "@/app/api/leagues/[leagueId]/trades/_shared";

const db = createTestDb();

const SLOTS: readonly RosterSlotConfig[] = [
  { slot: "QB", count: 1, eligiblePositions: ["QB"] },
  { slot: "RB", count: 1, eligiblePositions: ["RB"] },
  { slot: "BENCH", count: 2, eligiblePositions: ["QB", "RB", "WR", "TE", "K", "DEF"] },
];

const signedInAs = (id: string | null) =>
  vi.mocked(getCurrentUser).mockResolvedValue(
    id === null
      ? null
      : { id, email: `${id}@test.local`, displayName: id, experienceTier: "beginner", avatarUrl: null, createdAt: "2026-09-01T00:00:00.000Z", isAdmin: false },
  );

/** One league, two full teams — `team_a` (u_alice) and `team_b` (u_bob) — for the routes to
 *  negotiate a trade over. Kept lighter than `trades.test.ts`'s own fixture: routing is what
 *  this file proves, not every service-level refusal (already Task 3's `trades.test.ts`'s job). */
async function seedRouteLeague(): Promise<void> {
  await db.insert(users).values([
    { id: "u_alice", email: "u_alice@test.local", displayName: "Alice" },
    { id: "u_bob", email: "u_bob@test.local", displayName: "Bob" },
    { id: "u_carol", email: "u_carol@test.local", displayName: "Carol" },
  ]);
  await db.insert(leagues).values({ id: "lg_1", name: "Route League", format: "snake", teamCount: 2, commissionerUserId: "u_alice", rosterSlots: SLOTS });
  await db.insert(teams).values([
    { id: "team_a", leagueId: "lg_1", userId: "u_alice", name: "Team Alice" },
    { id: "team_b", leagueId: "lg_1", userId: "u_bob", name: "Team Bob" },
  ]);
  await db.insert(players).values([
    { id: "p_qb_a", name: "QB Alpha", position: "QB", nflTeam: "KC" },
    { id: "p_rb_a", name: "RB Alpha", position: "RB", nflTeam: "DAL" },
    { id: "p_qb_b", name: "QB Bravo", position: "QB", nflTeam: "BUF" },
    { id: "p_rb_b", name: "RB Bravo", position: "RB", nflTeam: "NYJ" },
  ]);
  await db.insert(rosterSlots).values([
    { teamId: "team_a", slot: "QB", slotIndex: 0, playerId: "p_qb_a" },
    { teamId: "team_a", slot: "RB", slotIndex: 0, playerId: "p_rb_a" },
    { teamId: "team_b", slot: "QB", slotIndex: 0, playerId: "p_qb_b" },
    { teamId: "team_b", slot: "RB", slotIndex: 0, playerId: "p_rb_b" },
  ]);
}

/** One open, unexpired `team_a` -> `team_b` offer, inserted directly.
 *
 *  PROPOSED AT THE REAL NOW, never at a hardcoded instant (integrity cleanup, 2026-09-10): the
 *  routes under test read the real `Date` to decide whether an offer is still open, so "unexpired"
 *  is a claim about the wall clock. This used to pin `proposedAt` to "2026-09-01T00:00:00Z", which
 *  put `expiresAt` at `TRADE_CONFIG.proposalTtlHours` (72) past it — true while that was within
 *  three days of the day it was written, and false every day after, at which point four tests in
 *  this file started answering 409 for an offer their own fixture calls open. Anchoring to `now`
 *  keeps the fixture's stated intent true on any day it runs. */
async function openTrade(): Promise<{ readonly id: string }> {
  const proposedAt = new Date();
  const expiresAt = new Date(proposedAt.getTime() + TRADE_CONFIG.proposalTtlHours * 60 * 60 * 1000);
  const proposerAssets = [{ kind: "player" as const, playerId: "p_rb_a" }];
  const counterpartyAssets = [{ kind: "player" as const, playerId: "p_rb_b" }];
  const id = "route_trade_1";
  await db.insert(tradeProposals).values({
    id,
    leagueId: "lg_1",
    proposerTeamId: "team_a",
    counterpartyTeamId: "team_b",
    weekNumber: 1,
    proposerAssets,
    counterpartyAssets,
    fingerprint: proposalFingerprint({ leagueId: "lg_1", proposerTeamId: "team_a", counterpartyTeamId: "team_b", proposerAssets, counterpartyAssets }),
    note: null,
    status: "open",
    proposedAt,
    expiresAt,
  });
  return { id };
}

function get(leagueId: string) {
  return GET(new Request(`http://test/api/leagues/${leagueId}/trades`), { params: Promise.resolve({ leagueId }) });
}

function post(leagueId: string, body: unknown) {
  const request = new Request(`http://test/api/leagues/${leagueId}/trades`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return POST(request, { params: Promise.resolve({ leagueId }) });
}

function postDecision(leagueId: string, tradeId: string, body: unknown) {
  const request = new Request(`http://test/api/leagues/${leagueId}/trades/${tradeId}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return POST_DECISION(request, { params: Promise.resolve({ leagueId, tradeId }) });
}

const validProposeBody = {
  counterpartyTeamId: "team_b",
  proposerAssets: [{ kind: "player", playerId: "p_rb_a" }],
  counterpartyAssets: [{ kind: "player", playerId: "p_rb_b" }],
  note: null,
};

beforeEach(async () => {
  await truncateAll(db);
  vi.mocked(getCurrentUser).mockReset();
  resetTradeRateLimit();
});

afterAll(async () => {
  await truncateAll(db);
});

describe("GET /api/leagues/[leagueId]/trades", () => {
  it("answers 401 JSON when nobody is signed in", async () => {
    signedInAs(null);
    const response = await get("lg_1");
    expect(response.status).toBe(401);
  });

  it("answers 403 for a member with no team of their own", async () => {
    await seedRouteLeague();
    signedInAs("u_carol");
    const response = await get("lg_1");
    expect(response.status).toBe(403);
    expect((await response.json()).error).toBe("You do not have a team in this league.");
  });

  it("answers the caller's own inbox/outbox/history", async () => {
    await seedRouteLeague();
    await openTrade();
    signedInAs("u_bob");
    const response = await get("lg_1");
    expect(response.status).toBe(200);
    const body = (await response.json()).data;
    expect(body.meTeamId).toBe("team_b");
    expect(body.inbox).toHaveLength(1);
  });
});

describe("POST /api/leagues/[leagueId]/trades", () => {
  it("answers 401 JSON when nobody is signed in", async () => {
    signedInAs(null);
    const response = await post("lg_1", validProposeBody);
    expect(response.status).toBe(401);
  });

  it("answers 403 for a member with no team of their own", async () => {
    await seedRouteLeague();
    signedInAs("u_carol");
    const response = await post("lg_1", validProposeBody);
    expect(response.status).toBe(403);
    expect((await response.json()).error).toBe("You do not have a team in this league.");
  });

  it("answers 400 naming the field for a malformed body", async () => {
    await seedRouteLeague();
    signedInAs("u_alice");
    const response = await post("lg_1", { ...validProposeBody, counterpartyTeamId: "" });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("counterpartyTeamId");
  });

  /** Final review, CRITICAL 1, at the route rather than only at the schema: the boundary itself
   *  refuses a body that names the valuation week, so no client can reach `proposeTrade` with
   *  one. Nothing is written. */
  it("answers 400 for a body that names a week, and writes nothing", async () => {
    await seedRouteLeague();
    signedInAs("u_alice");
    const response = await post("lg_1", { ...validProposeBody, weekNumber: 8 });
    expect(response.status).toBe(400);
    expect(await db.select().from(tradeProposals)).toEqual([]);
  });

  it("proposes a trade and answers 201 with the new offer's id and the proposer's own verdict", async () => {
    await seedRouteLeague();
    signedInAs("u_alice");
    const response = await post("lg_1", validProposeBody);
    expect(response.status).toBe(201);
    const body = (await response.json()).data;
    expect(body.tradeId).toEqual(expect.any(String));
    expect(body.verdict).toMatchObject({ verdict: expect.any(String) });
  });

  it("passes a service-level refusal straight through, unwrapped from the envelope", async () => {
    await seedRouteLeague();
    signedInAs("u_alice");
    const response = await post("lg_1", { ...validProposeBody, counterpartyTeamId: "team_a" });
    expect(response.status).toBe(422);
    expect((await response.json()).error).toBe("You cannot trade with your own team.");
  });

  it("answers 429 once the caller is over the trade ceiling", async () => {
    await seedRouteLeague();
    signedInAs("u_alice");
    for (let i = 0; i < TRADE_CONFIG.rateLimit.maxRequests; i += 1) {
      await post("lg_1", { ...validProposeBody, counterpartyTeamId: "" }); // malformed on purpose: cheap, never writes
    }
    const response = await post("lg_1", validProposeBody);
    expect(response.status).toBe(429);
  });
});

describe("POST /api/leagues/[leagueId]/trades/[tradeId]", () => {
  it("answers 401 JSON when nobody is signed in", async () => {
    signedInAs(null);
    const response = await postDecision("lg_1", "trade_1", { action: "reject" });
    expect(response.status).toBe(401);
  });

  it("answers 403 for a member with no team of their own", async () => {
    await seedRouteLeague();
    signedInAs("u_carol");
    const response = await postDecision("lg_1", "trade_1", { action: "reject" });
    expect(response.status).toBe(403);
  });

  it("answers 400 for an action outside the closed set", async () => {
    await seedRouteLeague();
    signedInAs("u_bob");
    const response = await postDecision("lg_1", "trade_1", { action: "counter" });
    expect(response.status).toBe(400);
  });

  it("lets the counterparty accept — the yes opens league review, and the finalizer moves the rosters", async () => {
    await seedRouteLeague();
    const trade = await openTrade();
    signedInAs("u_bob");
    const response = await postDecision("lg_1", trade.id, { action: "accept" });
    expect(response.status).toBe(200);
    const body = (await response.json()).data;
    expect(body).toMatchObject({ tradeId: trade.id, status: "under_review" });

    // Nothing moved yet: the league has its window.
    let teamARoster = await db.select().from(rosterSlots).where(eq(rosterSlots.teamId, "team_a"));
    expect(teamARoster.some((row) => row.playerId === "p_rb_b")).toBe(false);

    // The lazy finalizer, a day later, executes the unvetoed trade.
    const later = { now: () => new Date(Date.now() + 25 * 3_600_000).toISOString() };
    await processTradeReviews(db, later);
    teamARoster = await db.select().from(rosterSlots).where(eq(rosterSlots.teamId, "team_a"));
    const teamBRoster = await db.select().from(rosterSlots).where(eq(rosterSlots.teamId, "team_b"));
    expect(teamARoster.some((row) => row.playerId === "p_rb_b")).toBe(true);
    expect(teamBRoster.some((row) => row.playerId === "p_rb_a")).toBe(true);
  });

  it("answers a held status, on the wire, when the accept holds rather than executes (Plan D, Task 5)", async () => {
    await seedRouteLeague();
    await db.update(leagues).set({ isPublicMatchmade: true }).where(eq(leagues.id, "lg_1"));
    // Well past INTEGRITY_CONFIG.trade.autoHoldThreshold (35) — the same fixture shape
    // `trades.test.ts`'s own `seedLopsidedStatLines` uses.
    await db.insert(playerStatLines).values([1, 2, 3].map((week) => ({ playerId: "p_rb_a", week, rushingYards: 300, rushingTouchdowns: 5 })));
    await seasonCurrentWeek(db, { leagueId: "lg_1", homeTeamId: "team_a", awayTeamId: "team_b", week: 4 });
    const trade = await openTrade();
    signedInAs("u_bob");
    const response = await postDecision("lg_1", trade.id, { action: "accept" });
    expect(response.status).toBe(200);
    const body = (await response.json()).data;
    expect(body).toEqual({ tradeId: trade.id, status: "held" });

    // Nothing moved.
    const teamARoster = await db.select().from(rosterSlots).where(eq(rosterSlots.teamId, "team_a"));
    expect(teamARoster.some((row) => row.playerId === "p_rb_a")).toBe(true);
  });

  it("passes a service-level refusal straight through when the wrong party tries to accept", async () => {
    await seedRouteLeague();
    const trade = await openTrade();
    signedInAs("u_alice"); // the PROPOSER, not the counterparty
    const response = await postDecision("lg_1", trade.id, { action: "accept" });
    expect(response.status).toBe(404);
    expect((await response.json()).error).toBe("We could not find that offer.");
  });

  it("lets the counterparty reject, and answers the settled status", async () => {
    await seedRouteLeague();
    const trade = await openTrade();
    signedInAs("u_bob");
    const response = await postDecision("lg_1", trade.id, { action: "reject" });
    expect(response.status).toBe(200);
    const body = (await response.json()).data;
    expect(body).toEqual({ tradeId: trade.id, status: "rejected" });
  });

  it("lets the proposer withdraw, and answers the settled status", async () => {
    await seedRouteLeague();
    const trade = await openTrade();
    signedInAs("u_alice");
    const response = await postDecision("lg_1", trade.id, { action: "withdraw" });
    expect(response.status).toBe(200);
    const body = (await response.json()).data;
    expect(body).toEqual({ tradeId: trade.id, status: "withdrawn" });
  });

  it("passes a service-level refusal straight through for a decision on the wrong offer", async () => {
    await seedRouteLeague();
    signedInAs("u_bob");
    const response = await postDecision("lg_1", "trade_ghost", { action: "reject" });
    expect(response.status).toBe(404);
    expect((await response.json()).error).toBe("We could not find that offer.");
  });

  it("404s a real tradeId acted on through the WRONG league's URL, indistinguishably from a bogus one (F1)", async () => {
    await seedRouteLeague();
    const trade = await openTrade();
    // A second league, with a member who is NOT a party to the first league's trade at all.
    await db.insert(users).values({ id: "u_dave", email: "u_dave@test.local", displayName: "Dave" });
    await db.insert(leagues).values({ id: "lg_2", name: "Other League", format: "snake", teamCount: 2, commissionerUserId: "u_dave" });
    await db.insert(teams).values({ id: "team_other", leagueId: "lg_2", userId: "u_dave", name: "Other Team" });
    signedInAs("u_dave");

    const wrongLeague = await postDecision("lg_2", trade.id, { action: "reject" });
    const ghost = await postDecision("lg_2", "trade_totally_ghost", { action: "reject" });
    expect(wrongLeague.status).toBe(404);
    expect(await wrongLeague.json()).toEqual(await ghost.json());

    // The RIGHT league's URL still acts on the very same offer.
    signedInAs("u_bob");
    const rightLeague = await postDecision("lg_1", trade.id, { action: "reject" });
    expect(rightLeague.status).toBe(200);
  });
});
