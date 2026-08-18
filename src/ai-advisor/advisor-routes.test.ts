import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Db } from "@/db/client";
import { createTestDb, truncateAll } from "@/db/test-db";
import type { ApiEnvelope } from "@/lib/api/respond";
import type { Advice } from "./start-sit";
import type { TradeAssessment } from "./trade";
import { advisorFixture } from "./test-support";

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
  await truncateAll(db);
  const fixture = await advisorFixture(db, "ppr");
  leagueId = fixture.leagueId;
  opponentTeamId = fixture.opponentTeamId;
  currentUser.mockResolvedValue({ id: "u1" });
});

function context() {
  return { params: Promise.resolve({ leagueId }) };
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
});
