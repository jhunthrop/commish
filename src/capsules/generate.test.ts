import { describe, expect, it, vi } from "vitest";
import { buildPlayerFacts, type PlayerFactsInput } from "./facts";
import { generateCapsule } from "./generate";

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

const GOOD_COMPACT =
  "Rashad Long is a clear buy for this SF offense. Our number says 248 season points against board rank 14 overall, well clear of ADP 12.5. He carries the load for a team leaning on him every week, and the range from 178 to 275 still lands him firmly in the RB6 tier. Draft him with confidence at his current price this season.";
const GOOD_FULL =
  `${GOOD_COMPACT} The case only gets stronger once you look at the full picture: our number of 248 season points sits well clear of his ADP of 12.5, and board rank 14 overall backs up the price. He is the workhorse of the SF backfield, the engine of an offense that leans on him on early downs and in the passing game alike, and that workload level is exactly why the range runs from 178 on the low end to 275 on the high end. Nothing in the fact sheet points to a real downside here, so the call is simple: he is a buy at his current market price, full stop, book him with confidence on your board this season and do not look back.`;

describe("generateCapsule", () => {
  it("returns llm text and provenance for both sizes on a clean generation", async () => {
    const facts = buildPlayerFacts(baseInput());
    const fetchMock = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
      const payload = JSON.parse(init.body as string) as { messages: { content: string }[] };
      const isFull = payload.messages[1]!.content.includes("(1) the case for him");
      return okResponse(isFull ? GOOD_FULL : GOOD_COMPACT);
    });

    const result = await generateCapsule(facts, { apiKey: "test-key", fetch: fetchMock });
    expect(result.source).toBe("llm");
    expect(result.model).toBe("zai/glm-5.3-flash");
    expect(result.compact.source).toBe("llm");
    expect(result.full.source).toBe("llm");
    expect(result.compact.text).toBe(GOOD_COMPACT);
    expect(result.full.text).toBe(GOOD_FULL);
  });

  it("regenerates once on a validation failure, then succeeds", async () => {
    const facts = buildPlayerFacts(baseInput());
    let compactCalls = 0;
    const fetchMock = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
      const payload = JSON.parse(init.body as string) as { messages: { content: string }[] };
      const isFull = payload.messages[1]!.content.includes("(1) the case for him");
      if (isFull) return okResponse(GOOD_FULL);
      compactCalls += 1;
      return okResponse(compactCalls === 1 ? "He will score 999 touchdowns this year, an absurd number nobody else has ever hit for this SF offense." : GOOD_COMPACT);
    });

    const result = await generateCapsule(facts, { apiKey: "test-key", fetch: fetchMock });
    expect(result.compact.source).toBe("llm");
    expect(result.compact.text).toBe(GOOD_COMPACT);
    expect(compactCalls).toBe(2);
    // Fix round 1, MEDIUM c: usage accumulates across BOTH attempts (the failed one billed too),
    // never just the winning one.
    expect(result.compact.usage?.costUsd).toBeCloseTo(0.0001, 10);
  });

  it("falls back to the deterministic template after two failed attempts, and never blanks the capsule", async () => {
    const facts = buildPlayerFacts(baseInput());
    // A fresh Response per call — reusing one `Response` instance across attempts would throw on
    // its second `.text()` read (the body stream is already consumed), which is a test-harness
    // bug, not the thing under test.
    const fetchMock = vi.fn().mockImplementation(async () => okResponse("He will score 999 touchdowns this year for this offense, an absurd fabricated number nobody has hit."));

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
  });

  it("falls back to the template when the gateway is unreachable throughout, never throwing", async () => {
    const facts = buildPlayerFacts(baseInput());
    const fetchMock = vi.fn().mockRejectedValue(new Error("network down"));
    const result = await generateCapsule(facts, { apiKey: "test-key", fetch: fetchMock });
    expect(result.source).toBe("template");
    expect(result.compact.text).toBe(result.full.text);
    // No attempt ever got back a billable response — nothing to log.
    expect(result.compact.usage).toBeNull();
  });

  it("marks the whole capsule template-sourced when only one size falls back, never claiming a mixed llm provenance", async () => {
    const facts = buildPlayerFacts(baseInput());
    const fetchMock = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
      const payload = JSON.parse(init.body as string) as { messages: { content: string }[] };
      const isFull = payload.messages[1]!.content.includes("(1) the case for him");
      return isFull ? okResponse("He will score 999 touchdowns this year for this offense, a fabricated absurd number.") : okResponse(GOOD_COMPACT);
    });

    const result = await generateCapsule(facts, { apiKey: "test-key", fetch: fetchMock });
    expect(result.compact.source).toBe("llm");
    expect(result.full.source).toBe("template");
    expect(result.source).toBe("template");
    expect(result.model).toBeNull();
  });
});
