import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Db } from "@/db/client";
import { createTestDb, truncateAll } from "@/db/test-db";
import type { LlmClient } from "@/lib/llm/client";
import { assembleAdvisorContext, type AdvisorContext } from "./context";
import { createStartSitAdvisor } from "./start-sit";
import { advisorFixture } from "@/league-service/test-support";

const db: Db = createTestDb();

/** A stub, never a live call: the suite must never depend on a model or an API key. */
function stubLlm(reply: string): LlmClient {
  return {
    generateCompletion: async () => ({ text: reply, inputTokens: 1, outputTokens: 1 }),
  };
}

function echoingLlm(): { llm: LlmClient; readonly prompts: string[] } {
  const prompts: string[] = [];
  return {
    prompts,
    llm: {
      generateCompletion: async (input) => {
        prompts.push(input.user);
        return { text: `Start ${input.user.includes("points_per_reception: 1") ? "Volume Slot" : "Deep Threat"}.\nBecause of the scoring.`, inputTokens: 1, outputTokens: 1 };
      },
    },
  };
}

async function contextFor(preset: "ppr" | "standard", suffix: string): Promise<AdvisorContext> {
  const fixture = await advisorFixture(db, preset, suffix);
  const context = await assembleAdvisorContext(db, { ...fixture, weekNumber: 4 });
  if (context === null) throw new Error("no context");
  return context;
}

beforeEach(async () => {
  await truncateAll(db);
});

describe("createStartSitAdvisor", () => {
  it("returns the model's headline and reasoning when it answers cleanly", async () => {
    const advise = createStartSitAdvisor({ enabled: true, llm: stubLlm("Start Volume Slot.\nTen catches a week is ten points a week here.") });
    const advice = await advise({ context: await contextFor("ppr", "_a"), question: "Who do I start at WR?" });
    expect(advice.headline).toBe("Start Volume Slot.");
    expect(advice.reasoning).toBe("Ten catches a week is ten points a week here.");
    expect(advice.degraded).toBe(false);
  });

  it("gives a complete, league-specific answer with the model disabled", async () => {
    const llm = { generateCompletion: vi.fn() } as unknown as LlmClient;
    const advise = createStartSitAdvisor({ enabled: false, llm });
    const advice = await advise({ context: await contextFor("ppr", "_b"), question: "Who do I start at WR?" });
    expect(advice.degraded).toBe(true);
    expect(advice.headline.length).toBeGreaterThan(0);
    expect(advice.reasoning).toContain("Volume Slot");
    // Disabled means the model is never called at all — no key is ever required.
    expect((llm.generateCompletion as unknown as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  it("falls back when the model throws", async () => {
    const advise = createStartSitAdvisor({
      enabled: true,
      llm: {
        generateCompletion: async () => {
          throw new Error("upstream 529");
        },
      },
    });
    const advice = await advise({ context: await contextFor("ppr", "_c"), question: "Who do I start?" });
    expect(advice.degraded).toBe(true);
  });

  it("falls back when the model is too slow", async () => {
    const advise = createStartSitAdvisor({
      enabled: true,
      timeoutMs: 10,
      llm: { generateCompletion: () => new Promise(() => {}) },
    });
    const advice = await advise({ context: await contextFor("ppr", "_d"), question: "Who do I start?" });
    expect(advice.degraded).toBe(true);
  });

  it("falls back on an empty answer rather than showing a blank card", async () => {
    const advise = createStartSitAdvisor({ enabled: true, llm: stubLlm("   ") });
    const advice = await advise({ context: await contextFor("ppr", "_e"), question: "Who do I start?" });
    expect(advice.degraded).toBe(true);
  });

  it("gives DIFFERENT advice to a PPR league and a standard league for the same roster", async () => {
    const echo = echoingLlm();
    const advise = createStartSitAdvisor({ enabled: true, llm: echo.llm });
    const ppr = await advise({ context: await contextFor("ppr", "_f"), question: "Who do I start at WR?" });
    const standard = await advise({ context: await contextFor("standard", "_g"), question: "Who do I start at WR?" });

    expect(ppr.headline).not.toEqual(standard.headline);
    expect(ppr.headline).toContain("Volume Slot");
    expect(standard.headline).toContain("Deep Threat");
    expect(echo.prompts[0]).not.toEqual(echo.prompts[1]);
  });

  it("gives different BASELINE advice per league too, with no model at all", async () => {
    const llm = { generateCompletion: async () => ({ text: "", inputTokens: 0, outputTokens: 0 }) };
    const advise = createStartSitAdvisor({ enabled: false, llm });
    const ppr = await advise({ context: await contextFor("ppr", "_h"), question: "Who do I start at WR?" });
    const standard = await advise({ context: await contextFor("standard", "_i"), question: "Who do I start at WR?" });
    expect(ppr.reasoning).not.toEqual(standard.reasoning);
  });
});
