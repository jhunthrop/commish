import { describe, expect, it, vi } from "vitest";
import { buildPlayerFacts, type PlayerFactsInput } from "./facts";
import { CapsuleGenerationError, generateCapsuleBody, postChatCompletion } from "./write";

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

/** Twenty-plus words — anything shorter is treated by `postChatCompletion` as a degenerate
 *  (reasoning-model) completion and retried as transport weather, never returned. */
const LONG_BODY =
  "Rashad Long is a clear buy at his current price, our number says 248 season points against board rank 14, and the range from 178 to 275 keeps him firmly in the RB6 conversation this season plainly frankly truly clearly simply further notably steadily really overall plainly frankly truly clearly simply further notably steadily really overall plainly frankly truly clearly simply further notably steadily really overall plainly frankly truly clearly simply further notably steadily really overall plainly frankly truly clearly simply further notably steadily really overall plainly frankly truly clearly simply further notably steadily.";

describe("generateCapsuleBody", () => {
  it("returns the completion text and usage on a clean 200", async () => {
    const facts = buildPlayerFacts(baseInput());
    const fetchMock = vi.fn().mockResolvedValue(
      okResponse({ choices: [{ message: { content: LONG_BODY } }], usage: { prompt_tokens: 400, completion_tokens: 60, total_tokens: 460, cost: 0.00005 } }),
    );
    const result = await generateCapsuleBody(facts, "compact", { apiKey: "test-key", fetch: fetchMock });
    expect(result.text).toBe(LONG_BODY);
    expect(result.usage).toEqual({ promptTokens: 400, completionTokens: 60, totalTokens: 460, costUsd: 0.00005 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("sends the model id, system voice rules, and the rendered fact sheet", async () => {
    const facts = buildPlayerFacts(baseInput());
    const fetchMock = vi.fn().mockResolvedValue(okResponse({ choices: [{ message: { content: LONG_BODY } }] }));
    await generateCapsuleBody(facts, "compact", { apiKey: "test-key", fetch: fetchMock });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const payload = JSON.parse(init.body as string) as { model: string; messages: { role: string; content: string }[] };
    expect(payload.model).toBe("zai/glm-5.3-flash");
    expect(payload.messages[0]!.role).toBe("system");
    expect(payload.messages[1]!.content).toContain("Rashad Long");
  });

  /** THE CMC STRUCTURE (color v2, Task 3) — pins the prompt shape itself rather than any live
   *  model's obedience to it: a compact request must ask for exactly one rank and one worry, and
   *  a full request must walk the five-beat structure (volume/role case with ranks first, role
   *  depth, honest worry, the call, the two tail outcomes) rather than the old four-beat shape. */
  it("asks the compact size for exactly one rank and one worry, never a second of either", async () => {
    const facts = buildPlayerFacts(baseInput());
    const fetchMock = vi.fn().mockResolvedValue(okResponse({ choices: [{ message: { content: LONG_BODY } }] }));
    await generateCapsuleBody(facts, "compact", { apiKey: "test-key", fetch: fetchMock });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const payload = JSON.parse(init.body as string) as { messages: { role: string; content: string }[] };
    expect(payload.messages[1]!.content).toContain("ONE rank from the fact sheet");
    expect(payload.messages[1]!.content).toContain("ONE honest worry");
    expect(payload.messages[1]!.content).toContain("Do not stack a second rank or a second worry");
  });

  it("walks the full size through the five-beat CMC structure: ranks first, role depth, the honest worry, the call, the two tail outcomes", async () => {
    const facts = buildPlayerFacts(baseInput());
    const fetchMock = vi.fn().mockResolvedValue(okResponse({ choices: [{ message: { content: LONG_BODY } }] }));
    await generateCapsuleBody(facts, "full", { apiKey: "test-key", fetch: fetchMock });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const payload = JSON.parse(init.body as string) as { messages: { role: string; content: string }[] };
    const prompt = payload.messages[1]!.content;
    expect(prompt).toContain("the volume or role case, leading with the fact sheet's own ranks");
    expect(prompt).toContain("the role depth");
    expect(prompt).toContain("the honest worry");
    expect(prompt).toContain("the two outcomes the \"most seasons\" band's own two tails point to");
  });

  it("system voice rules ban reciting ranks as a list and require the two tail outcomes in the writer's own words", async () => {
    const facts = buildPlayerFacts(baseInput());
    const fetchMock = vi.fn().mockResolvedValue(okResponse({ choices: [{ message: { content: LONG_BODY } }] }));
    await generateCapsuleBody(facts, "full", { apiKey: "test-key", fetch: fetchMock });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const payload = JSON.parse(init.body as string) as { messages: { role: string; content: string }[] };
    const systemPrompt = payload.messages[0]!.content;
    expect(systemPrompt).toContain("never a bare recitation of three or four numbers back to back");
    expect(systemPrompt).toContain("league-winning at the top of that range and a team-crusher at the bottom");
    expect(systemPrompt).toContain("never words to copy verbatim");
  });

  it("recovers from a raw control character in the JSON body via the tolerant parse path", async () => {
    const facts = buildPlayerFacts(baseInput());
    const dirtyJson = `{"choices":[{"message":{"content":"Text with a \x01 stray byte, plus enough surrounding words that the degenerate completion guard never mistakes this tolerant parse fixture for an empty reasoning model answer."}}]}`;
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

  /** THE DEGENERATE-COMPLETION GUARD (live-fire 2026-09-05): a reasoning model can spend its whole
   *  completion budget thinking and return one word of prose while still billing. Under twenty
   *  words is transport weather, retried — and the billed spend of the discarded attempt is never
   *  dropped from the ledger. */
  it("retries a near-empty completion and folds its billed usage into the winning attempt's", async () => {
    vi.useFakeTimers();
    try {
      const facts = buildPlayerFacts(baseInput());
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(okResponse({ choices: [{ message: { content: "Draft him." } }], usage: { prompt_tokens: 300, completion_tokens: 900, total_tokens: 1200, cost: 0.00005 } }))
        .mockResolvedValueOnce(okResponse({ choices: [{ message: { content: LONG_BODY } }], usage: { prompt_tokens: 300, completion_tokens: 80, total_tokens: 380, cost: 0.00005 } }));
      const promise = generateCapsuleBody(facts, "compact", { apiKey: "test-key", fetch: fetchMock });
      await vi.advanceTimersByTimeAsync(1_500);
      const result = await promise;
      expect(result.text).toBe(LONG_BODY);
      expect(result.usage.costUsd).toBeCloseTo(0.0001, 10);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("carries the billed usage out on the error when every near-empty retry exhausts", async () => {
    vi.useFakeTimers();
    try {
      const facts = buildPlayerFacts(baseInput());
      // A fresh Response per call — a reused instance would throw on its second body read.
      const fetchMock = vi
        .fn()
        .mockImplementation(async () => okResponse({ choices: [{ message: { content: "Draft him." } }], usage: { prompt_tokens: 300, completion_tokens: 900, total_tokens: 1200, cost: 0.00005 } }));
      const promise = generateCapsuleBody(facts, "compact", { apiKey: "test-key", fetch: fetchMock }).catch((error: unknown) => error);
      await vi.advanceTimersByTimeAsync(1_500);
      const error = await promise;
      expect(error).toBeInstanceOf(CapsuleGenerationError);
      const generationError = error as CapsuleGenerationError;
      expect(generationError.retryable).toBe(true);
      expect(generationError.billedUsage?.costUsd).toBeCloseTo(0.0001, 10);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  /**
   * THE 429 BACKOFF CLASSIFICATION (sweep resilience, color v2, Task 4) — a 429 gets its OWN
   * three-retry, doubling-from-twenty-seconds track, distinct from every other transport failure's
   * original one-retry budget. Real time is never spent here: `vi.useFakeTimers` lets the test
   * advance through 20s/40s/80s of backoff instantly while still exercising the exact `setTimeout`
   * calls `postChatCompletion` makes.
   */
  it("retries a 429 up to three times with exponential backoff (20s, 40s, 80s) and succeeds once it clears", async () => {
    vi.useFakeTimers();
    try {
      const facts = buildPlayerFacts(baseInput());
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(new Response("rate limited", { status: 429 }))
        .mockResolvedValueOnce(new Response("rate limited", { status: 429 }))
        .mockResolvedValueOnce(new Response("rate limited", { status: 429 }))
        .mockResolvedValueOnce(okResponse({ choices: [{ message: { content: LONG_BODY } }] }));
      const promise = generateCapsuleBody(facts, "compact", { apiKey: "test-key", fetch: fetchMock });
      await vi.advanceTimersByTimeAsync(20_000);
      await vi.advanceTimersByTimeAsync(40_000);
      await vi.advanceTimersByTimeAsync(80_000);
      const result = await promise;
      expect(result.text).toBe(LONG_BODY);
      expect(fetchMock).toHaveBeenCalledTimes(4);
    } finally {
      vi.useRealTimers();
    }
  });

  it("exhausts three backoff retries (four attempts total) on a persistent 429 and throws a retryable error", async () => {
    vi.useFakeTimers();
    try {
      const facts = buildPlayerFacts(baseInput());
      const fetchMock = vi.fn().mockResolvedValue(new Response("rate limited", { status: 429 }));
      const assertion = expect(generateCapsuleBody(facts, "compact", { apiKey: "test-key", fetch: fetchMock })).rejects.toMatchObject({ retryable: true });
      await vi.advanceTimersByTimeAsync(20_000);
      await vi.advanceTimersByTimeAsync(40_000);
      await vi.advanceTimersByTimeAsync(80_000);
      await assertion;
      expect(fetchMock).toHaveBeenCalledTimes(4);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps a 5xx on its original, shorter one-retry budget, never borrowing the 429 track's extra attempts", async () => {
    vi.useFakeTimers();
    try {
      const facts = buildPlayerFacts(baseInput());
      const fetchMock = vi.fn().mockResolvedValue(new Response("server error", { status: 500 }));
      const assertion = expect(generateCapsuleBody(facts, "compact", { apiKey: "test-key", fetch: fetchMock })).rejects.toMatchObject({ retryable: true });
      // The non-429 track's own delay is `baseDelayMs * attempt` = 1_500ms — nowhere near a 429's
      // twenty-second first backoff, and only one retry is ever offered before this throws.
      await vi.advanceTimersByTimeAsync(1_500);
      await assertion;
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("never retries a plain refusal (401) — a retry would only repeat it", async () => {
    const facts = buildPlayerFacts(baseInput());
    const fetchMock = vi.fn().mockResolvedValue(new Response("unauthorized", { status: 401 }));
    await expect(generateCapsuleBody(facts, "compact", { apiKey: "test-key", fetch: fetchMock })).rejects.toMatchObject({ retryable: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("quotes a prior attempt's violations into the retry's own user message", async () => {
    const facts = buildPlayerFacts(baseInput());
    const fetchMock = vi.fn().mockResolvedValue(okResponse({ choices: [{ message: { content: LONG_BODY } }] }));
    await generateCapsuleBody(facts, "compact", { apiKey: "test-key", fetch: fetchMock }, { body: "Old bad body.", violations: ['The number "37" does not trace to any supplied fact.'] });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const payload = JSON.parse(init.body as string) as { messages: { role: string; content: string }[] };
    expect(payload.messages[1]!.content).toContain("does not trace to any supplied fact");
    expect(payload.messages[1]!.content).toContain("Old bad body.");
  });
});

/**
 * THE RATE THIS ENGINE TALKS AT (acceptance round, task 10) — a live run threw 16 throttles in 100
 * players and then spent three and a half minutes a player in backoff, because a player's three
 * calls fire concurrently and a per-minute limit cares about the burst, not the average.
 */
describe("the gateway call spacing", () => {
  const MESSAGES = [{ role: "user", content: "anything" }];

  it("spaces two calls by the configured gap, whoever asked for them", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => okResponse({ choices: [{ message: { content: LONG_BODY } }] }));
    const deps = { apiKey: "test-key", fetch: fetchMock, callSpacingMs: 60 };

    const startedAt = Date.now();
    await postChatCompletion(MESSAGES, 200, deps);
    await postChatCompletion(MESSAGES, 200, deps);
    await postChatCompletion(MESSAGES, 200, deps);

    // Three calls at a 60ms gap spend two gaps waiting. Asserted with slack rather than at the
    // exact 120ms boundary: a timer may fire a millisecond early, and a test that fails on that is
    // measuring the event loop rather than the limiter.
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(100);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("does not pace an injected fetch by default, because a fixture is not the gateway", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => okResponse({ choices: [{ message: { content: LONG_BODY } }] }));
    const startedAt = Date.now();
    await postChatCompletion(MESSAGES, 200, { apiKey: "test-key", fetch: fetchMock });
    await postChatCompletion(MESSAGES, 200, { apiKey: "test-key", fetch: fetchMock });
    expect(Date.now() - startedAt).toBeLessThan(1_000);
  });
});

describe("Retry-After", () => {
  const MESSAGES = [{ role: "user", content: "anything" }];

  it("waits the gateway's own number instead of guessing at the backoff", async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(new Response("rate limited", { status: 429, headers: { "retry-after": "2" } }))
        .mockResolvedValueOnce(okResponse({ choices: [{ message: { content: LONG_BODY } }] }));

      const promise = postChatCompletion(MESSAGES, 200, { apiKey: "test-key", fetch: fetchMock, callSpacingMs: 0 });
      // Two seconds is what the gateway asked for. The backoff track's own first step is twenty.
      await vi.advanceTimersByTimeAsync(2_000);
      const result = await promise;

      expect(result.content).toBe(LONG_BODY);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("ignores a header it cannot trust and keeps its own backoff", async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(new Response("rate limited", { status: 429, headers: { "retry-after": "3600" } }))
        .mockResolvedValueOnce(okResponse({ choices: [{ message: { content: LONG_BODY } }] }));

      const promise = postChatCompletion(MESSAGES, 200, { apiKey: "test-key", fetch: fetchMock, callSpacingMs: 0 });
      // An hour is past the backoff track's own longest wait, so the track's twenty seconds stands.
      await vi.advanceTimersByTimeAsync(20_000);
      const result = await promise;

      expect(result.content).toBe(LONG_BODY);
    } finally {
      vi.useRealTimers();
    }
  });
});
