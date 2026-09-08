import { describe, expect, it, vi } from "vitest";
import { buildPlayerFacts, type PlayerFactsInput } from "./facts";
import { describeCapsuleFallback, generateCapsule, type CapsuleSizeResult } from "./generate";
import { validateCapsule, wordCount } from "./validate";

/**
 * ONE CALL PER PLAYER (refrains round, 2026-09-07). Every test drives a fake `fetch`: the bundle
 * request is the one asking for a JSON object, a correction request is the one asking for a single
 * corrected note, and a fixture routes on that, so a test counting one part's own corrections never
 * counts the bundle.
 */

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

const FACTS = buildPlayerFacts(baseInput());

function okResponse(content: string): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content } }], usage: { prompt_tokens: 300, completion_tokens: 80, total_tokens: 380, cost: 0.00005 } }), { status: 200 });
}

type RequestKind = "bundle" | "compact" | "full";

function requestKind(init: RequestInit): RequestKind {
  const payload = JSON.parse(init.body as string) as { messages: { content: string }[] };
  const content = payload.messages[1]!.content;
  if (content.includes("Return ONE JSON object")) return "bundle";
  return content.includes("Return only the corrected short note") ? "compact" : "full";
}

function userMessageOf(init: RequestInit): string {
  return (JSON.parse(init.body as string) as { messages: { content: string }[] }).messages[1]!.content;
}

/** Grounded reads for the fixture above: every number and name is on its sheet, and "pick 13" is
 *  the rounded ADP the sheet itself prints. */
const GOOD_COMPACT =
  "Rashad Long is the back this SF offense runs through, and drafters are taking him around pick 13 when our number of 248 season points says he belongs a touch earlier. Board rank 14 overall is the honest read of that gap. The range from 178 to 275 is wide because the low end is the seasons cut short by injury, and he has carried a full load before. Take him a few picks ahead of his ADP and let somebody else worry about the tail.";
const GOOD_FULL =
  `${GOOD_COMPACT} There is more to the case than the gap between his ADP and our number, though that gap is where it starts. This is an offense that hands its back the ball on early downs and keeps him on the field when the game plan opens up, and that is the kind of role that turns a good back into a weekly starter you never think about benching. The tails matter too, and they matter in a specific way. The low end of that range is what a season with games missed looks like, not what a healthy season from him looks like, so a drafter who reads 178 as the expectation is reading the wrong number. The middle of the range is the honest picture, and it sits comfortably above what a back going around his pick usually gives you. What would change my mind is a summer where the touches get split, and nothing on the sheet says that is happening. Until it does, he is the kind of pick that quietly wins a league in the fourth quarter of the season, and I would rather be a few picks early on him than a round late.`;
const GROUNDED_CALL = "He is the engine of that SF offense and the ADP has not caught up.";

/** Twenty-plus words (the degenerate-completion guard retries anything shorter as transport
 *  weather) that still FAIL validation: "999" traces to no supplied fact. */
const BAD_COMPLETION =
  "He will score 999 touchdowns this year for this SF offense, an absurd fabricated number that nobody on the fact sheet has ever hit, and drafters simply cannot rank a season like that.";

function bundleJson(over: Partial<{ compact: unknown; full: unknown; narrative: unknown }> = {}): string {
  return JSON.stringify({ compact: GOOD_COMPACT, full: GOOD_FULL, narrative: { call: GROUNDED_CALL }, ...over });
}

/** A fixture answering the bundle with `bundle` and any correction with `correction(kind)`. */
function fetchAnswering(bundle: () => string, correction: (kind: "compact" | "full") => string = () => GOOD_COMPACT) {
  return vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
    const kind = requestKind(init);
    return okResponse(kind === "bundle" ? bundle() : correction(kind));
  });
}

describe("the fixtures", () => {
  it("validate on their own facts, so every test below is about the orchestration", () => {
    expect(validateCapsule(GOOD_COMPACT, FACTS, "compact")).toMatchObject({ ok: true });
    expect(validateCapsule(GOOD_FULL, FACTS, "full")).toMatchObject({ ok: true });
  });
});

describe("generateCapsule", () => {
  it("writes both reads and the narrative from ONE call on a clean bundle", async () => {
    const fetchMock = fetchAnswering(() => bundleJson());

    const result = await generateCapsule(FACTS, { apiKey: "test-key", fetch: fetchMock });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.source).toBe("llm");
    expect(result.model).toBe("zai/glm-5.3-flash");
    expect(result.compact).toMatchObject({ source: "llm", text: GOOD_COMPACT, usage: null, fallbackReason: null });
    expect(result.full).toMatchObject({ source: "llm", text: GOOD_FULL, usage: null, fallbackReason: null });
    expect(result.narrative.slots.call).toBe(GROUNDED_CALL);
    expect(result.narrative.rejected).toEqual([]);
    // The one call's spend sits on the player, not on any one part.
    expect(result.usage?.costUsd).toBeCloseTo(0.00005, 10);
  });

  it("keeps the narrative independent of the reads: a bad narrative object never flips a good pair to template", async () => {
    const fetchMock = fetchAnswering(() => bundleJson({ narrative: "not an object" }));
    const result = await generateCapsule(FACTS, { apiKey: "test-key", fetch: fetchMock });
    expect(result.source).toBe("llm");
    expect(result.narrative.slots).toEqual({});
    expect(result.narrative.failure).toBe("the answer carried no narrative object");
  });

  it("drops a narrative slot that fails grounding and keeps the rest, without a second call", async () => {
    const fetchMock = fetchAnswering(() => bundleJson({ narrative: { call: GROUNDED_CALL, "absence:usage": "He caught 137 passes a year ago and nobody tracked it." } }));
    const result = await generateCapsule(FACTS, { apiKey: "test-key", fetch: fetchMock });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.narrative.slots).toEqual({ call: GROUNDED_CALL });
    expect(result.narrative.rejected.join(" ")).toContain("137");
  });

  it("corrects ONLY the part that failed: a fabricated compact costs one compact call, the full read is kept as written", async () => {
    const kinds: RequestKind[] = [];
    const fetchMock = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
      const kind = requestKind(init);
      kinds.push(kind);
      return okResponse(kind === "bundle" ? bundleJson({ compact: BAD_COMPLETION }) : GOOD_COMPACT);
    });

    const result = await generateCapsule(FACTS, { apiKey: "test-key", fetch: fetchMock });

    expect(kinds).toEqual(["bundle", "compact"]);
    expect(result.compact).toMatchObject({ source: "llm", text: GOOD_COMPACT });
    expect(result.full).toMatchObject({ source: "llm", text: GOOD_FULL, usage: null });
    // The correction's own spend is on the part, and the player's total carries both calls.
    expect(result.compact.usage?.costUsd).toBeCloseTo(0.00005, 10);
    expect(result.usage?.costUsd).toBeCloseTo(0.0001, 10);
  });

  it("answers a word-band failure with a LENGTH CORRECTION of the same text, not a fresh attempt", async () => {
    // Forty-one words: above the twenty-word degenerate floor, so it reaches the validator as a
    // real band failure rather than as transport weather.
    const tooShort = `He is a clear steal at this ADP and nothing else about him needs saying today. ${Array.from({ length: 25 }, () => "plainly").join(" ")}.`;
    const corrections: string[] = [];
    const fetchMock = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
      if (requestKind(init) === "bundle") return okResponse(bundleJson({ compact: tooShort }));
      corrections.push(userMessageOf(init));
      return okResponse(GOOD_COMPACT);
    });

    const result = await generateCapsule(FACTS, { apiKey: "test-key", fetch: fetchMock });

    expect(result.compact).toMatchObject({ source: "llm", text: GOOD_COMPACT });
    expect(corrections).toHaveLength(1);
    expect(corrections[0]).toContain("It is 41 words. Bring it to 98 words:");
    expect(corrections[0]).toContain(tooShort);
    expect(corrections[0]).not.toContain("broke these rules");
  });

  it("answers a trading word with a SOFT correction that names the drafting replacement and keeps the prose (production follow-up, 2026-09-08)", async () => {
    const priced = GOOD_COMPACT.replace("drafters are taking him around pick 13", "the price is pick 13");
    expect(validateCapsule(priced, FACTS, "compact").violations).toHaveLength(1);
    const corrections: string[] = [];
    const fetchMock = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
      if (requestKind(init) === "bundle") return okResponse(bundleJson({ compact: priced }));
      corrections.push(userMessageOf(init));
      return okResponse(GOOD_COMPACT);
    });

    const result = await generateCapsule(FACTS, { apiKey: "test-key", fetch: fetchMock });

    expect(result.compact).toMatchObject({ source: "llm", text: GOOD_COMPACT });
    expect(corrections).toHaveLength(1);
    expect(corrections[0]).toContain(priced);
    expect(corrections[0]).toContain("It is nearly right");
    expect(corrections[0]).toContain("drafters are taking him around pick 100");
    expect(corrections[0]).not.toContain("broke these rules");
  });

  /**
   * THE SHAPE OF A FAILURE IS RECORDED (written rate round, 2026-09-08). Seventy-four production
   * reads fell on the word band and the tally logged only the deciding violation, so whether the
   * correction was ignored or the draft was further out was not knowable. Every attempt at a read
   * now rides on the result with its stage, its word count and its violations, for the acceptance
   * script to print; the sweep ignores it.
   */
  it("records every attempt at a read: the draft, then the correction by its kind, each with its words and violations", async () => {
    const tooShort = `He is a clear steal at this ADP and nothing else about him needs saying today. ${Array.from({ length: 25 }, () => "plainly").join(" ")}.`;
    const fetchMock = fetchAnswering(() => bundleJson({ compact: tooShort }), () => GOOD_COMPACT);

    const result = await generateCapsule(FACTS, { apiKey: "test-key", fetch: fetchMock });

    expect(result.compact.attempts).toEqual([
      { stage: "draft", words: 41, body: tooShort, violations: ["Word count 41 is outside the required 75-120 word band."] },
      { stage: "length", words: wordCount(GOOD_COMPACT), body: GOOD_COMPACT, violations: [] },
    ]);
    // The full read was right first time: one attempt, no violations.
    expect(result.full.attempts).toEqual([{ stage: "draft", words: wordCount(GOOD_FULL), body: GOOD_FULL, violations: [] }]);
  });

  it("names the correction's kind: a small overrun is a trim, a trading word is soft, a fabrication is a rewrite, a left-out read is missing", async () => {
    // Two words over the 120 cap: inside the five-word trim allowance.
    const overrun = `${GOOD_COMPACT} ${Array.from({ length: 122 - wordCount(GOOD_COMPACT) }, () => "plainly").join(" ")}.`;
    expect(wordCount(overrun)).toBe(122);
    const priced = GOOD_COMPACT.replace("drafters are taking him around pick 13", "the price is pick 13");
    const stagesOf = async (bundle: string) => {
      const result = await generateCapsule(FACTS, { apiKey: "test-key", fetch: fetchAnswering(() => bundle, (kind) => (kind === "compact" ? GOOD_COMPACT : GOOD_FULL)) });
      return { compact: result.compact.attempts.map((attempt) => attempt.stage), full: result.full.attempts.map((attempt) => attempt.stage) };
    };
    expect((await stagesOf(bundleJson({ compact: overrun }))).compact).toEqual(["draft", "trim"]);
    expect((await stagesOf(bundleJson({ compact: priced }))).compact).toEqual(["draft", "soft"]);
    // A fabrication inside the band: "999" traces to nothing, so the whole note is rewritten.
    expect((await stagesOf(bundleJson({ compact: GOOD_COMPACT.replace("248", "999") }))).compact).toEqual(["draft", "rewrite"]);
    expect((await stagesOf(JSON.stringify({ compact: GOOD_COMPACT, narrative: { call: GROUNDED_CALL } }))).full).toEqual(["missing"]);
  });

  it("keeps a refused narrative slot's own text beside its violations, so a rejected sentence can be read back", async () => {
    const fabricated = "He caught 137 passes a year ago and nobody tracked it.";
    const fetchMock = fetchAnswering(() => bundleJson({ narrative: { call: GROUNDED_CALL, "absence:usage": fabricated } }));
    const result = await generateCapsule(FACTS, { apiKey: "test-key", fetch: fetchMock });
    expect(result.narrative.refused).toEqual([{ key: "absence:usage", text: fabricated, violations: ['The number "137" does not trace to any supplied fact.'] }]);
    expect(result.narrative.rejected).toEqual(['absence:usage: The number "137" does not trace to any supplied fact.']);
  });

  it("writes a read the bundle left out with one call for that read alone", async () => {
    const corrections: string[] = [];
    const fetchMock = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
      if (requestKind(init) === "bundle") return okResponse(JSON.stringify({ compact: GOOD_COMPACT, narrative: { call: GROUNDED_CALL } }));
      corrections.push(userMessageOf(init));
      return okResponse(GOOD_FULL);
    });

    const result = await generateCapsule(FACTS, { apiKey: "test-key", fetch: fetchMock });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(corrections[0]).toContain("had no long note");
    expect(result.full).toMatchObject({ source: "llm", text: GOOD_FULL });
    expect(result.source).toBe("llm");
  });

  it("waits out a 429 rather than falling to the template on the first throttle of a sweep", async () => {
    vi.useFakeTimers();
    try {
      let calls = 0;
      const fetchMock = vi.fn().mockImplementation(async () => {
        calls += 1;
        return calls === 1 ? new Response("rate limited", { status: 429 }) : okResponse(bundleJson());
      });

      const promise = generateCapsule(FACTS, { apiKey: "test-key", fetch: fetchMock });
      await vi.advanceTimersByTimeAsync(20_000);
      const result = await promise;

      // The throttle cost one backoff wait inside `write.ts`'s own 429 track, never a template.
      expect(result.source).toBe("llm");
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("gives a body with no object in it one more whole attempt, then falls to the template for both reads with no correction calls", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => okResponse("I am afraid I cannot write that for you today, sorry about this one, it is not going to happen."));

    const result = await generateCapsule(FACTS, { apiKey: "test-key", fetch: fetchMock });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.source).toBe("template");
    expect(result.model).toBeNull();
    expect(result.compact.fallbackReason).toEqual({ kind: "failed_validation", firstViolation: "The answer was not a single JSON object." });
    expect(result.full.fallbackReason).toEqual(result.compact.fallbackReason);
    expect(result.compact.text.length).toBeGreaterThan(0);
    expect(result.narrative.slots).toEqual({});
    expect(result.narrative.failure).toBe("The answer was not a single JSON object.");
    // Both attempts were billed, and both are on the ledger even though the row fell to template.
    expect(result.usage?.costUsd).toBeCloseTo(0.0001, 10);
  });

  it("falls back to the template when the gateway is unreachable throughout, never throwing", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("network down"));
    const result = await generateCapsule(FACTS, { apiKey: "test-key", fetch: fetchMock });
    expect(result.source).toBe("template");
    expect(result.compact.text).toBe(result.full.text);
    expect(result.usage).toBeNull();
    expect(result.compact.fallbackReason).toEqual({ kind: "throttled" });
    expect(result.full.fallbackReason).toEqual({ kind: "throttled" });
    expect(result.narrative.failure).toBe("the gateway never returned a usable answer");
  });

  it("marks the whole capsule template-sourced when one read fails its correction too, never claiming a mixed provenance", async () => {
    const fetchMock = fetchAnswering(() => bundleJson({ full: BAD_COMPLETION }), () => BAD_COMPLETION);

    const result = await generateCapsule(FACTS, { apiKey: "test-key", fetch: fetchMock });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.compact.source).toBe("llm");
    expect(result.full.source).toBe("template");
    expect(result.full.fallbackReason).toMatchObject({ kind: "failed_validation" });
    expect(result.source).toBe("template");
    expect(result.model).toBeNull();
  });
});

/** THE LABELED DETAIL — pure, so the classification rule itself is tested without a gateway or a
 *  database in the loop. `capsule-sweep-job.ts`'s own detail lines are the one caller. */
describe("describeCapsuleFallback", () => {
  function llmResult(): CapsuleSizeResult {
    return { text: "Body.", source: "llm", usage: null, fallbackReason: null, attempts: [] };
  }
  function throttledResult(): CapsuleSizeResult {
    return { text: "Template body.", source: "template", usage: null, fallbackReason: { kind: "throttled" }, attempts: [] };
  }
  function failedValidationResult(firstViolation: string): CapsuleSizeResult {
    return { text: "Template body.", source: "template", usage: null, fallbackReason: { kind: "failed_validation", firstViolation }, attempts: [] };
  }

  it('reports "llm" when neither size fell back', () => {
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
