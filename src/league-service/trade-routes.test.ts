import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";

vi.hoisted(() => {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://commish:commish@localhost:5433/commish_test";
  process.env.REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
});

vi.mock("@/lib/auth/current-user", () => ({
  getCurrentUser: vi.fn(),
}));

import { createTestDb, truncateAll } from "@/db/test-db";
import { leagues, players, rosterSlots, teams, tradeProposals, users } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth/current-user";
import type { RosterSlotConfig } from "@/domain/roster";
import { TRADE_CONFIG } from "@/trades/config";
import { proposalFingerprint } from "./trades";
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

/** One open, unexpired `team_a` -> `team_b` offer, inserted directly. */
async function openTrade(): Promise<{ readonly id: string }> {
  const proposedAt = new Date("2026-09-01T00:00:00.000Z");
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
  weekNumber: 1,
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
    expect((await response.json()).error).toBe("You don't have a team in this league.");
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
    expect((await response.json()).error).toBe("You don't have a team in this league.");
  });

  it("answers 400 naming the field for a malformed body", async () => {
    await seedRouteLeague();
    signedInAs("u_alice");
    const response = await post("lg_1", { ...validProposeBody, weekNumber: 0 });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("weekNumber");
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
    expect((await response.json()).error).toBe("You can't trade with your own team.");
  });

  it("answers 429 once the caller is over the trade ceiling", async () => {
    await seedRouteLeague();
    signedInAs("u_alice");
    for (let i = 0; i < TRADE_CONFIG.rateLimit.maxRequests; i += 1) {
      await post("lg_1", { ...validProposeBody, weekNumber: 0 }); // malformed on purpose: cheap, never writes
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

  it("refuses the accept arm cleanly, with product copy, until Task 5 wires it", async () => {
    await seedRouteLeague();
    const trade = await openTrade();
    signedInAs("u_bob");
    const response = await postDecision("lg_1", trade.id, { action: "accept" });
    expect(response.status).toBe(501);
    const body = await response.json();
    expect(body.ok).toBe(false);
    expect(body.error).toContain("isn't available");
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
    expect((await response.json()).error).toBe("We couldn't find that offer.");
  });
});
