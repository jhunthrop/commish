import { describe, it, expect, beforeEach } from "vitest";
import type { Db } from "@research/db/client";
import { createTestDb } from "@research/db/test-db";
import { truncateAll } from "@/db/test-db";
import type { LlmClient } from "@/lib/llm/client";
import type { TradeProposal } from "@/domain/trade";
import { assembleAdvisorContext } from "./context";
import { advisorFixture } from "@/league-service/test-support";
import { createTradeAnalyzer } from "./trade";

const db: Db = createTestDb();

const stub: LlmClient = {
  generateCompletion: async () => ({ text: "Fair enough.\nBoth sides give up similar weekly production.", inputTokens: 1, outputTokens: 1 }),
};

beforeEach(async () => {
  await truncateAll(db);
});

async function setup() {
  const fixture = await advisorFixture(db, "ppr");
  const context = await assembleAdvisorContext(db, { ...fixture, weekNumber: 4 });
  if (context === null || context.opponent === null) throw new Error("no context");
  // The analyzer only ever sees two valued sides, so building "theirs" from MY bench is just
  // as valid a fixture as the fixture's real opponent roster — kept here to keep this file's
  // proposal shape (rb_change for wr_volume) stable regardless of what the fixture opponent fields.
  const opponent = { ...context.opponent, players: context.me.players };
  const proposal: TradeProposal = {
    leagueId: context.leagueId,
    weekNumber: 4,
    from: { teamId: context.me.teamId, playerIds: ["rb_change"] },
    to: { teamId: opponent.teamId, playerIds: ["wr_volume"] },
  };
  return { context, opponent, proposal };
}

describe("createTradeAnalyzer", () => {
  it("returns the deterministic verdict alongside the model's prose", async () => {
    const { context, opponent, proposal } = await setup();
    const analyze = createTradeAnalyzer({ enabled: true, llm: stub });
    const assessment = await analyze({ context, opponent, proposal });

    expect(assessment).not.toBeNull();
    if (assessment === null) return;
    expect(assessment.verdict).toBe("favors_proposer");
    expect(assessment.givingValue).toBeGreaterThan(0);
    expect(assessment.receivingValue).toBeGreaterThan(0);
    expect(assessment.headline).toBe("Fair enough.");
    expect(assessment.degraded).toBe(false);
  });

  it("keeps the SAME verdict and flags with the model disabled — only the prose changes", async () => {
    const { context, opponent, proposal } = await setup();
    const withModel = await createTradeAnalyzer({ enabled: true, llm: stub })({ context, opponent, proposal });
    const without = await createTradeAnalyzer({ enabled: false, llm: stub })({ context, opponent, proposal });

    expect(without?.verdict).toBe(withModel?.verdict);
    expect(without?.flags).toEqual(withModel?.flags);
    expect(without?.givingValue).toBe(withModel?.givingValue);
    expect(without?.degraded).toBe(true);
    expect(without?.reasoning).not.toEqual(withModel?.reasoning);
  });

  it("refuses a proposal that isn't a trade", async () => {
    const { context, opponent, proposal } = await setup();
    const analyze = createTradeAnalyzer({ enabled: true, llm: stub });
    expect(await analyze({ context, opponent, proposal: { ...proposal, to: { teamId: opponent.teamId, playerIds: [] } } })).toBeNull();
  });

  it("refuses a proposal naming a player neither side actually has", async () => {
    const { context, opponent, proposal } = await setup();
    const analyze = createTradeAnalyzer({ enabled: true, llm: stub });
    expect(await analyze({ context, opponent, proposal: { ...proposal, from: { teamId: context.me.teamId, playerIds: ["ghost"] } } })).toBeNull();
  });

  it("falls back to deterministic reasoning when the model times out", async () => {
    const { context, opponent, proposal } = await setup();
    const analyze = createTradeAnalyzer({ enabled: true, timeoutMs: 10, llm: { generateCompletion: () => new Promise(() => {}) } });
    const assessment = await analyze({ context, opponent, proposal });
    expect(assessment?.degraded).toBe(true);
    expect(assessment?.verdict).toBe("favors_proposer");
  });
});
