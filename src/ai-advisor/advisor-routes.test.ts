import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Db } from "@/db/client";
import { createTestDb, truncateAll } from "@/db/test-db";
import { leagues, users } from "@/db/schema";
import type { ApiEnvelope } from "@/lib/api/respond";
import { NO_TEAM_MESSAGE } from "@/lib/leagues/membership";
import type { Advice } from "./start-sit";
import type { TradeAssessment } from "./trade";
import { ADVISOR_CONFIG } from "./config";
import { advisorFixture, foreignLeague } from "./test-support";

const db: Db = createTestDb();
const currentUser = vi.fn<() => Promise<{ readonly id: string } | null>>();

vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: () => db };
});
vi.mock("@/lib/auth/current-user", () => ({
  getCurrentUser: () => currentUser(),
  requireCurrentUser: async () => {
    const user = await currentUser();
    if (user === null) throw new Error("not signed in");
    return user;
  },
}));
// No live model, ever: the shared client is stubbed and `isLLMEnabled` is forced off, so these
// routes exercise the degraded path — which is the path that must always work.
vi.mock("@/lib/llm/client", () => ({
  isLLMEnabled: () => false,
  getLlmClient: () => ({ generateCompletion: async () => ({ text: "", inputTokens: 0, outputTokens: 0 }) }),
}));

const { POST: START_SIT } = await import("@/app/api/leagues/[leagueId]/advisor/start-sit/route");
const { POST: TRADE } = await import("@/app/api/leagues/[leagueId]/advisor/trade/route");
const { resetAdvisorRateLimit } = await import("@/app/api/leagues/[leagueId]/advisor/_shared");

function post(body: unknown): Request {
  return new Request("http://localhost/api/leagues/l/advisor", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

let leagueId = "";
let opponentTeamId = "";

beforeEach(async () => {
  // The advisor's request ceiling lives in module memory for the whole file, so a case that
  // spends it must not change what the next case sees.
  resetAdvisorRateLimit();
  await truncateAll(db);
  const fixture = await advisorFixture(db, "ppr");
  leagueId = fixture.leagueId;
  opponentTeamId = fixture.opponentTeamId;
  currentUser.mockResolvedValue({ id: "u1" });
});

function context() {
  return { params: Promise.resolve({ leagueId }) };
}

/**
 * A league whose commissioner never fielded a team of their own. `requireLeagueMember` lets a
 * commissioner through even with no team — being commissioner is membership on its own — so
 * each route's own `actor.teamId === null` guard is the only thing standing between a
 * teamless commissioner and advice for a team that doesn't exist. Inserted directly rather
 * than via `advisorFixture`/`createLeague`, which always seat their caller on a team.
 */
async function teamlessCommissionerLeague(): Promise<string> {
  const commissionerId = "u_commish_only";
  await db.insert(users).values({ id: commissionerId, email: `${commissionerId}@test.local`, displayName: "Commish Only" });
  const teamlessLeagueId = "league_teamless_commissioner";
  await db.insert(leagues).values({ id: teamlessLeagueId, name: "No Team Yet", format: "snake", teamCount: 2, commissionerUserId: commissionerId });
  currentUser.mockResolvedValue({ id: commissionerId });
  return teamlessLeagueId;
}

describe("POST /api/leagues/[leagueId]/advisor/start-sit", () => {
  it("answers 401 JSON when nobody is signed in", async () => {
    currentUser.mockResolvedValue(null);
    expect((await START_SIT(post({ weekNumber: 4, question: "Who do I start?" }), context())).status).toBe(401);
  });

  it("answers 403 for a signed-in stranger", async () => {
    currentUser.mockResolvedValue({ id: "u_stranger" });
    expect((await START_SIT(post({ weekNumber: 4, question: "Who do I start?" }), context())).status).toBe(403);
  });

  it("gives a complete answer with no API key configured, marked as degraded", async () => {
    const body = (await (await START_SIT(post({ weekNumber: 4, question: "Who do I start at WR?" }), context())).json()) as ApiEnvelope<Advice>;
    expect(body.ok).toBe(true);
    if (!body.ok) return;
    expect(body.data.degraded).toBe(true);
    expect(body.data.headline.length).toBeGreaterThan(0);
    expect(body.data.reasoning.length).toBeGreaterThan(0);
  });

  it("rejects an empty question and one past the length cap", async () => {
    expect((await START_SIT(post({ weekNumber: 4, question: "   " }), context())).status).toBe(400);
    expect((await START_SIT(post({ weekNumber: 4, question: "x".repeat(5_000) }), context())).status).toBe(400);
  });

  it("names the offending field in a 400", async () => {
    const response = await START_SIT(post({ weekNumber: 4, question: "   " }), context());
    const body = (await response.json()) as ApiEnvelope<never>;
    expect(body.ok).toBe(false);
    if (body.ok) return;
    expect(body.error).toContain("question");
  });

  it("rejects a week outside the season", async () => {
    expect((await START_SIT(post({ weekNumber: 0, question: "Who?" }), context())).status).toBe(400);
  });

  it("answers 403 for a commissioner who never fielded a team of their own", async () => {
    const teamlessLeagueId = await teamlessCommissionerLeague();
    const response = await START_SIT(post({ weekNumber: 4, question: "Who?" }), { params: Promise.resolve({ leagueId: teamlessLeagueId }) });
    expect(response.status).toBe(403);
    const body = (await response.json()) as ApiEnvelope<never>;
    expect(body.ok).toBe(false);
    if (body.ok) return;
    expect(body.error).toBe(NO_TEAM_MESSAGE);
  });
});

describe("POST /api/leagues/[leagueId]/advisor/trade", () => {
  it("assesses a real proposal against the opponent's actual roster, without storing or executing anything", async () => {
    const response = await TRADE(
      post({ weekNumber: 4, counterpartyTeamId: opponentTeamId, give: ["rb_change"], receive: ["wr_volume"] }),
      context(),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as ApiEnvelope<TradeAssessment>;
    expect(body.ok).toBe(true);
    if (!body.ok) return;
    expect(body.data.verdict).toBeDefined();
    expect(body.data.flags).toBeDefined();
    expect(body.data.givingValue).toBeGreaterThanOrEqual(0);
    expect(body.data.receivingValue).toBeGreaterThanOrEqual(0);
    expect(body.data.degraded).toBe(true);
  });

  it("422s a proposal naming a player neither side actually holds", async () => {
    const response = await TRADE(
      post({ weekNumber: 4, counterpartyTeamId: opponentTeamId, give: ["ghost_player"], receive: ["wr_volume"] }),
      context(),
    );
    expect(response.status).toBe(422);
  });

  it("422s a proposal naming a REAL player who is rostered only in a different league", async () => {
    const foreign = await foreignLeague(db);
    const response = await TRADE(
      post({ weekNumber: 4, counterpartyTeamId: opponentTeamId, give: [foreign.playerId], receive: ["wr_volume"] }),
      context(),
    );
    expect(response.status).toBe(422);
  });

  // The counterparty is an AUTHORIZATION input, not just a lookup key: `getLineup` filters by
  // teamId alone, so without a league check a team id from ANOTHER league assembles that team's
  // real roster and the analyzer answers with per-week valuations for its named players — a
  // cross-league oracle, and those names go into the prompt. `receive` deliberately names a
  // player that team really holds, so the pre-fix answer was a genuine 200, not a shape error.
  it("404s a counterparty team that is real but belongs to a DIFFERENT league", async () => {
    const foreign = await foreignLeague(db);
    const response = await TRADE(
      post({ weekNumber: 4, counterpartyTeamId: foreign.teamId, give: ["rb_change"], receive: ["wr_deep"] }),
      context(),
    );
    expect(response.status).toBe(404);
  });

  it("rejects more players per side than the config allows", async () => {
    const many = ["a", "b", "c", "d", "e", "f"];
    expect(
      (await TRADE(post({ weekNumber: 4, counterpartyTeamId: opponentTeamId, give: many, receive: ["x"] }), context())).status,
    ).toBe(400);
  });

  it("names the offending field in a 400", async () => {
    const many = ["a", "b", "c", "d", "e", "f"];
    const response = await TRADE(post({ weekNumber: 4, counterpartyTeamId: opponentTeamId, give: many, receive: ["x"] }), context());
    const body = (await response.json()) as ApiEnvelope<never>;
    expect(body.ok).toBe(false);
    if (body.ok) return;
    expect(body.error).toContain("give");
  });

  it("404s a counterparty team that isn't in this league", async () => {
    expect(
      (await TRADE(post({ weekNumber: 4, counterpartyTeamId: "not_here", give: ["rb_change"], receive: ["x"] }), context())).status,
    ).toBe(404);
  });

  it("refuses a trade with yourself", async () => {
    const mine = (await (await START_SIT(post({ weekNumber: 4, question: "x" }), context())).json()) as ApiEnvelope<Advice>;
    expect(mine.ok).toBe(true);
    const response = await TRADE(
      post({ weekNumber: 4, counterpartyTeamId: "__self__", give: ["rb_change"], receive: ["wr_volume"] }),
      context(),
    );
    expect(response.status).toBe(404);
  });

  it("answers 403 for a commissioner who never fielded a team of their own", async () => {
    const teamlessLeagueId = await teamlessCommissionerLeague();
    const response = await TRADE(
      post({ weekNumber: 4, counterpartyTeamId: opponentTeamId, give: ["rb_change"], receive: ["wr_volume"] }),
      { params: Promise.resolve({ leagueId: teamlessLeagueId }) },
    );
    expect(response.status).toBe(403);
    const body = (await response.json()) as ApiEnvelope<never>;
    expect(body.ok).toBe(false);
    if (body.ok) return;
    expect(body.error).toBe(NO_TEAM_MESSAGE);
  });
});

/**
 * The ceiling is per USER and shared by both advisor routes, because both spend the same two
 * scarce things: a full context assembly and one model call. Signed in as the rival manager so
 * these cases spend their own budget rather than the one every other case in this file uses.
 */
describe("the advisor's per-user request ceiling", () => {
  it("refuses a member looping the endpoint, in plain language, once the window's budget is gone", async () => {
    currentUser.mockResolvedValue({ id: "u2" });
    for (let i = 0; i < ADVISOR_CONFIG.maxRequestsPerWindow; i += 1) {
      expect((await START_SIT(post({ weekNumber: 4, question: "Who do I start?" }), context())).status).toBe(200);
    }

    const response = await START_SIT(post({ weekNumber: 4, question: "Who do I start?" }), context());
    expect(response.status).toBe(429);
    const body = (await response.json()) as ApiEnvelope<never>;
    expect(body.ok).toBe(false);
    if (body.ok) return;
    expect(body.error).toBe("You've asked for a lot of advice at once. Give it a minute and try again.");
  });

  it("spends ONE budget across both advisor routes, not one each", async () => {
    currentUser.mockResolvedValue({ id: "u2" });
    for (let i = 0; i < ADVISOR_CONFIG.maxRequestsPerWindow; i += 1) {
      expect((await START_SIT(post({ weekNumber: 4, question: "Who do I start?" }), context())).status).toBe(200);
    }

    const trade = post({ weekNumber: 4, counterpartyTeamId: opponentTeamId, give: ["wr_volume"], receive: ["wr_deep"] });
    expect((await TRADE(trade, context())).status).toBe(429);
  });
});
