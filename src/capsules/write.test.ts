import { describe, expect, it, vi } from "vitest";
import { buildPlayerFacts, type PlayerFactsInput } from "./facts";
import { CapsuleGenerationError, generateCapsuleBody } from "./write";

function baseInput(): PlayerFactsInput {
  return {
    identity: { id: "p1", name: "Rashad Long", position: "RB", team: "SF" },
    productSeason: 2026,
    reasons: [],
    laws: [],
    market: { adp: 12.5, positionAdp: "RB6", boardRank: 14 },
    projection: { projectedPoints: 248, floorPoints: 178, medianPoints: 240, ceilingPoints: 275 },
    byeWeek: 9,
    season: null,
    injury: { state: "unknown" },
    news: [],
    lastSeasonStory: null,
    booksNumbers: { propsLines: [], teamVegasWinTotal: null },
    usage: null,
    trend: null,
  };
}

function okResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 });
}

describe("generateCapsuleBody", () => {
  it("returns the completion text and usage on a clean 200", async () => {
    const facts = buildPlayerFacts(baseInput());
    const fetchMock = vi.fn().mockResolvedValue(
      okResponse({ choices: [{ message: { content: "Rashad Long is a buy." } }], usage: { prompt_tokens: 400, completion_tokens: 60, total_tokens: 460, cost: 0.00005 } }),
    );
    const result = await generateCapsuleBody(facts, "compact", { apiKey: "test-key", fetch: fetchMock });
    expect(result.text).toBe("Rashad Long is a buy.");
    expect(result.usage).toEqual({ promptTokens: 400, completionTokens: 60, totalTokens: 460, costUsd: 0.00005 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("sends the model id, system voice rules, and the rendered fact sheet", async () => {
    const facts = buildPlayerFacts(baseInput());
    const fetchMock = vi.fn().mockResolvedValue(okResponse({ choices: [{ message: { content: "Body text here." } }] }));
    await generateCapsuleBody(facts, "compact", { apiKey: "test-key", fetch: fetchMock });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const payload = JSON.parse(init.body as string) as { model: string; messages: { role: string; content: string }[] };
    expect(payload.model).toBe("zai/glm-5.3-flash");
    expect(payload.messages[0]!.role).toBe("system");
    expect(payload.messages[1]!.content).toContain("Rashad Long");
  });

  it("recovers from a raw control character in the JSON body via the tolerant parse path", async () => {
    const facts = buildPlayerFacts(baseInput());
    const dirtyJson = `{"choices":[{"message":{"content":"Text with a \x01 stray byte."}}]}`;
    const fetchMock = vi.fn().mockResolvedValue(new Response(dirtyJson, { status: 200 }));
    const result = await generateCapsuleBody(facts, "compact", { apiKey: "test-key", fetch: fetchMock });
    expect(result.text).toContain("stray byte");
  });

  it("treats an empty completion as a generation failure, retries once, then throws", async () => {
    const facts = buildPlayerFacts(baseInput());
    const fetchMock = vi.fn().mockResolvedValue(okResponse({ choices: [{ message: { content: "   " } }] }));
    await expect(generateCapsuleBody(facts, "compact", { apiKey: "test-key", fetch: fetchMock })).rejects.toThrow(CapsuleGenerationError);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries once on a 429 and succeeds if the retry clears", async () => {
    const facts = buildPlayerFacts(baseInput());
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("rate limited", { status: 429 }))
      .mockResolvedValueOnce(okResponse({ choices: [{ message: { content: "Recovered text." } }] }));
    const result = await generateCapsuleBody(facts, "compact", { apiKey: "test-key", fetch: fetchMock });
    expect(result.text).toBe("Recovered text.");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("exhausts its retry on a persistent 429 and throws a retryable error", async () => {
    const facts = buildPlayerFacts(baseInput());
    const fetchMock = vi.fn().mockResolvedValue(new Response("rate limited", { status: 429 }));
    await expect(generateCapsuleBody(facts, "compact", { apiKey: "test-key", fetch: fetchMock })).rejects.toMatchObject({ retryable: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("never retries a plain refusal (401) — a retry would only repeat it", async () => {
    const facts = buildPlayerFacts(baseInput());
    const fetchMock = vi.fn().mockResolvedValue(new Response("unauthorized", { status: 401 }));
    await expect(generateCapsuleBody(facts, "compact", { apiKey: "test-key", fetch: fetchMock })).rejects.toMatchObject({ retryable: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("quotes a prior attempt's violations into the retry's own user message", async () => {
    const facts = buildPlayerFacts(baseInput());
    const fetchMock = vi.fn().mockResolvedValue(okResponse({ choices: [{ message: { content: "Fixed body." } }] }));
    await generateCapsuleBody(facts, "compact", { apiKey: "test-key", fetch: fetchMock }, { body: "Old bad body.", violations: ['The number "37" does not trace to any supplied fact.'] });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const payload = JSON.parse(init.body as string) as { messages: { role: string; content: string }[] };
    expect(payload.messages[1]!.content).toContain("does not trace to any supplied fact");
    expect(payload.messages[1]!.content).toContain("Old bad body.");
  });
});
