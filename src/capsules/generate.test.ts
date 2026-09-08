import { describe, expect, it, vi } from "vitest";
import { buildPlayerFacts, type PlayerFactsInput } from "./facts";
import { describeCapsuleFallback, generateCapsule, type CapsuleSizeResult } from "./generate";

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

function okResponse(content: string): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content } }], usage: { prompt_tokens: 300, completion_tokens: 80, total_tokens: 380, cost: 0.00005 } }), { status: 200 });
}

/** The narrative call is a THIRD request per player alongside the two reads, and it is the only
 *  one whose user message asks for a JSON object — every mock below routes on that, so a test
 *  counting a size's own attempts never counts the narrative's. */
function isNarrativeRequest(init: RequestInit): boolean {
  const payload = JSON.parse(init.body as string) as { messages: { content: string }[] };
  return payload.messages[1]!.content.includes("Return ONE JSON object");
}

/** A grounded narrative: one slot, every number and name off the fact sheet. */
const NARRATIVE_JSON = JSON.stringify({ call: "He is the engine of that SF offense and the price has not caught up." });

/** Twenty-plus words (the degenerate-completion guard retries anything shorter as transport
 *  weather) that still FAIL validation: "999" traces to no supplied fact. */
const BAD_COMPLETION =
  "He will score 999 touchdowns this year for this SF offense, an absurd fabricated number that nobody on the fact sheet has ever hit, and the market simply cannot price a season like that.";

const GOOD_COMPACT =
  "Rashad Long is a clear buy for this SF offense. Our number says 248 season points against board rank 14 overall, well clear of ADP 12.5. He carries the load for a team leaning on him every week, and the range from 178 to 275 still lands him firmly in the RB6 tier. Draft him with confidence at his current price this season plainly frankly truly clearly simply further notably steadily really overall plainly frankly truly clearly simply further notably steadily really overall plainly frankly truly clearly simply further notably steadily really overall plainly.";
const GOOD_FULL =
  `${GOOD_COMPACT} The case only gets stronger once you look at the full picture: our number of 248 season points sits well clear of his ADP of 12.5, and board rank 14 overall backs up the price. He is the workhorse of the SF backfield, the engine of an offense that leans on him on early downs and in the passing game alike, and that workload level is exactly why the range runs from 178 on the low end to 275 on the high end. Nothing in the fact sheet points to a real downside here, so the call is simple: he is a buy at his current market price, full stop, book him with confidence on your board this season and do not look back. plainly frankly truly clearly simply further notably steadily really overall plainly frankly truly clearly simply further notably steadily really overall plainly frankly truly clearly simply further notably steadily really overall plainly frankly truly clearly simply further notably steadily really overall plainly frankly truly clearly simply further notably steadily really overall plainly frankly.`;

describe("generateCapsule", () => {
  it("returns llm text and provenance for both sizes on a clean generation", async () => {
    const facts = buildPlayerFacts(baseInput());
    const fetchMock = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
      if (isNarrativeRequest(init)) return okResponse(NARRATIVE_JSON);
      const payload = JSON.parse(init.body as string) as { messages: { content: string }[] };
      const isFull = payload.messages[1]!.content.includes("(1) the volume or role case");
      return okResponse(isFull ? GOOD_FULL : GOOD_COMPACT);
    });

    const result = await generateCapsule(facts, { apiKey: "test-key", fetch: fetchMock });
    expect(result.source).toBe("llm");
    expect(result.model).toBe("zai/glm-5.3-flash");
    expect(result.compact.source).toBe("llm");
    expect(result.full.source).toBe("llm");
    expect(result.compact.text).toBe(GOOD_COMPACT);
    expect(result.full.text).toBe(GOOD_FULL);
    expect(result.narrative.slots.call).toBe("He is the engine of that SF offense and the price has not caught up.");
    expect(result.narrative.rejected).toEqual([]);
  });

  it("keeps the narrative independent of the reads: a failed narrative never flips a good pair to template", async () => {
    const facts = buildPlayerFacts(baseInput());
    const fetchMock = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
      if (isNarrativeRequest(init)) return okResponse("I am afraid I cannot write that for you today, sorry about this one.");
      const payload = JSON.parse(init.body as string) as { messages: { content: string }[] };
      return okResponse(payload.messages[1]!.content.includes("(1) the volume or role case") ? GOOD_FULL : GOOD_COMPACT);
    });

    const result = await generateCapsule(facts, { apiKey: "test-key", fetch: fetchMock });
    expect(result.source).toBe("llm");
    expect(result.narrative.slots).toEqual({});
    expect(result.narrative.failure).toBe("the narrative completion was not a JSON object");
  });

  it("regenerates once on a validation failure, then succeeds", async () => {
    const facts = buildPlayerFacts(baseInput());
    let compactCalls = 0;
    const fetchMock = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
      if (isNarrativeRequest(init)) return okResponse(NARRATIVE_JSON);
      const payload = JSON.parse(init.body as string) as { messages: { content: string }[] };
      const isFull = payload.messages[1]!.content.includes("(1) the volume or role case");
      if (isFull) return okResponse(GOOD_FULL);
      compactCalls += 1;
      return okResponse(compactCalls === 1 ? BAD_COMPLETION : GOOD_COMPACT);
    });

    const result = await generateCapsule(facts, { apiKey: "test-key", fetch: fetchMock });
    expect(result.compact.source).toBe("llm");
    expect(result.compact.text).toBe(GOOD_COMPACT);
    expect(compactCalls).toBe(2);
    // Fix round 1, MEDIUM c: usage accumulates across BOTH attempts (the failed one billed too),
    // never just the winning one.
    expect(result.compact.usage?.costUsd).toBeCloseTo(0.0001, 10);
  });

  it("answers a word-band failure with a LENGTH CORRECTION, not a fresh attempt (capsule acceptance round)", async () => {
    const facts = buildPlayerFacts(baseInput());
    // Forty-two words, the shortest compact the coordinator's live sample actually produced: above
    // `write.ts`'s twenty-word degenerate floor, so it reaches the validator as a real band failure
    // rather than as transport weather.
    const tooShort = `He is a clear buy at this price and nothing else about him needs saying today. ${Array.from({ length: 25 }, () => "plainly").join(" ")}.`;
    const compactPrompts: string[] = [];
    let compactCalls = 0;
    const fetchMock = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
      if (isNarrativeRequest(init)) return okResponse(NARRATIVE_JSON);
      const payload = JSON.parse(init.body as string) as { messages: { content: string }[] };
      if (payload.messages[1]!.content.includes("(1) the volume or role case")) return okResponse(GOOD_FULL);
      compactCalls += 1;
      compactPrompts.push(payload.messages[1]!.content);
      return okResponse(compactCalls === 1 ? tooShort : GOOD_COMPACT);
    });

    const result = await generateCapsule(facts, { apiKey: "test-key", fetch: fetchMock });

    expect(result.compact.source).toBe("llm");
    expect(result.compact.text).toBe(GOOD_COMPACT);
    // The retry hands the SAME text back with a length instruction and no violation list at all:
    // prose that was already grounded and already in voice is corrected, never thrown away.
    expect(compactPrompts[1]).toContain("Rewrite it to between 75 and 120 words, changing nothing else");
    expect(compactPrompts[1]).toContain(tooShort);
    expect(compactPrompts[1]).not.toContain("violated these rules");
  });

  it("waits out a 429 rather than falling to the template on the first throttle of a sweep", async () => {
    vi.useFakeTimers();
    try {
      const facts = buildPlayerFacts(baseInput());
      const throttledOnce = new Map<string, number>();
      const fetchMock = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
        const kind = isNarrativeRequest(init) ? "narrative" : JSON.parse(init.body as string).messages[1].content.includes("(1) the volume or role case") ? "full" : "compact";
        const seen = throttledOnce.get(kind) ?? 0;
        throttledOnce.set(kind, seen + 1);
        if (seen === 0) return new Response("rate limited", { status: 429 });
        return okResponse(kind === "narrative" ? NARRATIVE_JSON : kind === "full" ? GOOD_FULL : GOOD_COMPACT);
      });

      const promise = generateCapsule(facts, { apiKey: "test-key", fetch: fetchMock });
      await vi.advanceTimersByTimeAsync(20_000);
      const result = await promise;

      // The throttle cost one backoff wait, not a template: `write.ts`'s 429 track owns the wait
      // and `generate.ts` never sees a failure at all.
      expect(result.source).toBe("llm");
      expect(result.compact.fallbackReason).toBeNull();
      expect(result.full.fallbackReason).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("falls back to the deterministic template after two failed attempts, and never blanks the capsule", async () => {
    const facts = buildPlayerFacts(baseInput());
    // A fresh Response per call — reusing one `Response` instance across attempts would throw on
    // its second `.text()` read (the body stream is already consumed), which is a test-harness
    // bug, not the thing under test.
    const fetchMock = vi.fn().mockImplementation(async () => okResponse(BAD_COMPLETION));

    const result = await generateCapsule(facts, { apiKey: "test-key", fetch: fetchMock });
    expect(result.source).toBe("template");
    expect(result.model).toBeNull();
    expect(result.compact.source).toBe("template");
    expect(result.full.source).toBe("template");
    expect(result.compact.text.length).toBeGreaterThan(0);
    expect(result.full.text.length).toBeGreaterThan(0);
    // Fix round 1, MEDIUM c: both failed attempts were genuinely billed by the gateway — that
    // spend must still be logged even though the row ultimately falls back to template.
    expect(result.compact.usage?.costUsd).toBeCloseTo(0.0001, 10);
    expect(result.full.usage?.costUsd).toBeCloseTo(0.0001, 10);
    // Sweep resilience, color v2, Task 4: the gateway DID respond both times, it was the content
    // that failed the validator, so the labeled reason is "failed validation", never "throttled".
    expect(result.compact.fallbackReason).toMatchObject({ kind: "failed_validation" });
    expect(result.full.fallbackReason).toMatchObject({ kind: "failed_validation" });
  });

  it("falls back to the template when the gateway is unreachable throughout, never throwing", async () => {
    const facts = buildPlayerFacts(baseInput());
    const fetchMock = vi.fn().mockRejectedValue(new Error("network down"));
    const result = await generateCapsule(facts, { apiKey: "test-key", fetch: fetchMock });
    expect(result.source).toBe("template");
    expect(result.compact.text).toBe(result.full.text);
    // No attempt ever got back a billable response — nothing to log.
    expect(result.compact.usage).toBeNull();
    // A pure transport failure (never even got a response to validate) labels as "throttled",
    // never "failed validation" — there was nothing to validate.
    expect(result.compact.fallbackReason).toEqual({ kind: "throttled" });
    expect(result.full.fallbackReason).toEqual({ kind: "throttled" });
  });

  it("marks the whole capsule template-sourced when only one size falls back, never claiming a mixed llm provenance", async () => {
    const facts = buildPlayerFacts(baseInput());
    const fetchMock = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
      if (isNarrativeRequest(init)) return okResponse(NARRATIVE_JSON);
      const payload = JSON.parse(init.body as string) as { messages: { content: string }[] };
      const isFull = payload.messages[1]!.content.includes("(1) the volume or role case");
      return isFull ? okResponse(BAD_COMPLETION) : okResponse(GOOD_COMPACT);
    });

    const result = await generateCapsule(facts, { apiKey: "test-key", fetch: fetchMock });
    expect(result.compact.source).toBe("llm");
    expect(result.full.source).toBe("template");
    expect(result.source).toBe("template");
    expect(result.model).toBeNull();
    expect(result.compact.fallbackReason).toBeNull();
    expect(result.full.fallbackReason).toMatchObject({ kind: "failed_validation" });
  });
});

/** THE LABELED DETAIL (sweep resilience, color v2, Task 4) — pure, so the classification rule
 *  itself is tested without a gateway or a database in the loop. `capsule-sweep-job.ts`'s own
 *  detail lines are the one caller. */
describe("describeCapsuleFallback", () => {
  function llmResult(): CapsuleSizeResult {
    return { text: "Body.", source: "llm", usage: null, fallbackReason: null };
  }
  function throttledResult(): CapsuleSizeResult {
    return { text: "Template body.", source: "template", usage: null, fallbackReason: { kind: "throttled" } };
  }
  function failedValidationResult(firstViolation: string): CapsuleSizeResult {
    return { text: "Template body.", source: "template", usage: null, fallbackReason: { kind: "failed_validation", firstViolation } };
  }

  it("reports \"llm\" when neither size fell back", () => {
    expect(describeCapsuleFallback(llmResult(), llmResult())).toBe("llm");
  });

  it("labels a throttled fallback plainly", () => {
    expect(describeCapsuleFallback(throttledResult(), llmResult())).toBe("template (throttled)");
  });

  it("labels a failed-validation fallback with its own first violation", () => {
    expect(describeCapsuleFallback(failedValidationResult('The number "37" does not trace to any supplied fact.'), llmResult())).toBe(
      'template (failed validation: The number "37" does not trace to any supplied fact.)',
    );
  });

  it("prefers the throttled label when the two sizes disagree, the systemic condition an operator most needs to see", () => {
    expect(describeCapsuleFallback(throttledResult(), failedValidationResult("some violation"))).toBe("template (throttled)");
    expect(describeCapsuleFallback(failedValidationResult("some violation"), throttledResult())).toBe("template (throttled)");
  });
});
