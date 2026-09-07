import { describe, expect, it, vi } from "vitest";
import { buildPlayerFacts, type PlayerFactsInput } from "./facts";
import { generateNarrative, narrativePromptFor, narrativeRequestsFor } from "./narrative";
import { absenceSlotKey, ABSENCE_MODULES, NARRATIVE_KEYS, narrativeSlot, normalizeSentence, whyGroupSlotKey } from "./narrative-slots";
import { validateNarrativeSlot } from "./validate";

/**
 * THE NARRATIVE, WITHOUT A GATEWAY. Every test here drives a fake `fetch`: the round's own rule is
 * that nothing in the suite or in a script spends gateway money, and none of the behaviour under
 * test (which slots are asked for, what the validator accepts, what a bad body does) needs a live
 * model to exercise.
 */

function baseInput(over: Partial<PlayerFactsInput> = {}): PlayerFactsInput {
  return {
    identity: { id: "p1", name: "Rashad Long", position: "RB", team: "SF" },
    productSeason: 2026,
    reasons: [
      { code: "law", lawId: "rb_age_curve", effect: -1.8, magnitude: 29 },
      { code: "availability", expectedGames: 15, floorGames: 11, ceilingGames: 17 },
      { code: "tier_cliff", playersLeftInTier: 2, dropToNextTier: 20.9 },
    ],
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
    ...over,
  };
}

function okResponse(content: string): Response {
  return new Response(
    JSON.stringify({ choices: [{ message: { content } }], usage: { prompt_tokens: 900, completion_tokens: 240, total_tokens: 1140, cost: 0.00007 } }),
    { status: 200 },
  );
}

const GROUNDED_CALL = "He is the engine of that SF offense and the price has not caught up.";

describe("narrativeRequestsFor", () => {
  it("asks for the call always, and for the tier only where the board found a real cliff", () => {
    const withCliff = narrativeRequestsFor(buildPlayerFacts(baseInput())).map((request) => request.key);
    expect(withCliff).toContain(NARRATIVE_KEYS.call);
    expect(withCliff).toContain(NARRATIVE_KEYS.tier);

    const noCliff = narrativeRequestsFor(
      buildPlayerFacts(baseInput({ reasons: [{ code: "availability", expectedGames: 15, floorGames: 11, ceilingGames: 17 }] })),
    ).map((request) => request.key);
    expect(noCliff).not.toContain(NARRATIVE_KEYS.tier);
  });

  it("asks for an absence note, never a story, when there is no prior season on record", () => {
    const keys = narrativeRequestsFor(buildPlayerFacts(baseInput())).map((request) => request.key);
    expect(keys).toContain(absenceSlotKey(ABSENCE_MODULES.story));
    expect(keys).not.toContain(NARRATIVE_KEYS.story);
    expect(keys).toContain(absenceSlotKey(ABSENCE_MODULES.usage));
    expect(keys).toContain(absenceSlotKey(ABSENCE_MODULES.books));
  });

  it("asks for one slot per evidence group, keyed the way the module renders it", () => {
    const facts = buildPlayerFacts(baseInput());
    const keys = narrativeRequestsFor(facts).map((request) => request.key);
    for (const item of facts.evidence) expect(keys).toContain(whyGroupSlotKey(item.groupKey));
  });

  it("holds the call to thirty words and every module sentence to forty", () => {
    const requests = narrativeRequestsFor(buildPlayerFacts(baseInput()));
    expect(requests.find((request) => request.key === NARRATIVE_KEYS.call)!.maxWords).toBe(30);
    for (const request of requests.filter((r) => r.key !== NARRATIVE_KEYS.call)) expect(request.maxWords).toBe(40);
  });
});

describe("narrativePromptFor", () => {
  it("quotes the board's stock sentences as ones not to write", () => {
    const facts = buildPlayerFacts(baseInput());
    const prompt = narrativePromptFor(facts, narrativeRequestsFor(facts), ["he is a high floor play with weekly upside"]);
    expect(prompt).toContain("he is a high floor play with weekly upside");
    expect(prompt).toContain("Do not write them");
  });

  it("says nothing about stock sentences on a healthy board", () => {
    const facts = buildPlayerFacts(baseInput());
    expect(narrativePromptFor(facts, narrativeRequestsFor(facts), [])).not.toContain("Do not write them");
  });
});

describe("validateNarrativeSlot", () => {
  const facts = buildPlayerFacts(baseInput());

  it("accepts a grounded call", () => {
    expect(validateNarrativeSlot(GROUNDED_CALL, facts, 30).ok).toBe(true);
  });

  it("rejects a number that traces to nothing on the fact sheet", () => {
    const result = validateNarrativeSlot("He caught 137 passes last year and nobody can cover him.", facts, 30);
    expect(result.ok).toBe(false);
    expect(result.violations[0]).toContain("137");
  });

  it("rejects thirty-one words in the call's own band", () => {
    const thirtyOne = Array.from({ length: 31 }, (_, index) => (index === 0 ? "He" : "runs")).join(" ");
    const result = validateNarrativeSlot(thirtyOne, facts, 30);
    expect(result.ok).toBe(false);
    expect(result.violations[0]).toContain("outside the required");
  });

  it("rejects a fabricated teammate, an em-dash, a semicolon and the lab-report register", () => {
    expect(validateNarrativeSlot("Justin Herbert throws him the ball every week now.", facts, 40).ok).toBe(false);
    expect(validateNarrativeSlot("He is a buy — the price is wrong.", facts, 40).ok).toBe(false);
    expect(validateNarrativeSlot("He is a buy; the price is wrong.", facts, 40).ok).toBe(false);
    expect(validateNarrativeSlot("His projection sits above his price.", facts, 40).ok).toBe(false);
  });

  it("does not demand the tension citation a whole read has to carry", () => {
    // The strongest downside is -1.8 a game and this sentence never mentions it. A thirty-word
    // call cannot carry the case and the hesitation both; the reads still must.
    expect(validateNarrativeSlot(GROUNDED_CALL, facts, 30).ok).toBe(true);
  });
});

describe("generateNarrative", () => {
  it("keeps every grounded slot and drops only the ones that fail", async () => {
    const facts = buildPlayerFacts(baseInput());
    const body = JSON.stringify({
      [NARRATIVE_KEYS.call]: GROUNDED_CALL,
      [NARRATIVE_KEYS.tier]: "Two backs are left in his tier before a 20.9 point drop, so the wait costs you.",
      [absenceSlotKey(ABSENCE_MODULES.usage)]: "Nobody charted his snaps last year, so watch the early-down work in August.",
      unknownKey: "This slot was never asked for.",
      [NARRATIVE_KEYS.perGame]: "He caught 137 passes a year ago and the games question answers itself.",
    });
    const fetchMock = vi.fn().mockResolvedValue(okResponse(body));

    const result = await generateNarrative(facts, { apiKey: "test-key", fetch: fetchMock });

    expect(result.slots[NARRATIVE_KEYS.call]).toBe(GROUNDED_CALL);
    expect(result.slots[NARRATIVE_KEYS.tier]).toContain("20.9 point drop");
    expect(result.slots).not.toHaveProperty("unknownKey");
    expect(result.slots).not.toHaveProperty(NARRATIVE_KEYS.perGame);
    expect(result.rejected.join(" ")).toContain("137");
    expect(result.usage?.costUsd).toBeCloseTo(0.00007, 10);
    expect(result.failure).toBeNull();
  });

  it("reads a fenced JSON object rather than refusing it", async () => {
    const facts = buildPlayerFacts(baseInput());
    const fetchMock = vi.fn().mockResolvedValue(okResponse("```json\n" + JSON.stringify({ call: GROUNDED_CALL }) + "\n```"));
    const result = await generateNarrative(facts, { apiKey: "test-key", fetch: fetchMock });
    expect(result.slots[NARRATIVE_KEYS.call]).toBe(GROUNDED_CALL);
  });

  it("returns no slots, and never throws, when the gateway is unreachable", async () => {
    const facts = buildPlayerFacts(baseInput());
    const fetchMock = vi.fn().mockRejectedValue(new Error("network down"));
    const result = await generateNarrative(facts, { apiKey: "test-key", fetch: fetchMock });
    expect(result.slots).toEqual({});
    expect(result.failure).toContain("network down");
  });

  it("returns no slots for a body that is not an object of sentences", async () => {
    const facts = buildPlayerFacts(baseInput());
    const fetchMock = vi.fn().mockResolvedValue(okResponse("[\"a list of things nobody asked for, which is not the object shape\"]"));
    const result = await generateNarrative(facts, { apiKey: "test-key", fetch: fetchMock });
    expect(result.slots).toEqual({});
    expect(result.failure).toBe("the narrative completion was not a JSON object");
  });
});

describe("narrativeSlot", () => {
  it("reads a validated sentence and refuses everything that is not one", () => {
    expect(narrativeSlot({ narrative: { call: GROUNDED_CALL } }, "call")).toBe(GROUNDED_CALL);
    expect(narrativeSlot({ narrative: { call: "   " } }, "call")).toBeNull();
    expect(narrativeSlot({ narrative: {} }, "call")).toBeNull();
    expect(narrativeSlot({ narrative: null }, "call")).toBeNull();
    expect(narrativeSlot(null, "call")).toBeNull();
    expect(narrativeSlot(undefined, "call")).toBeNull();
    expect(narrativeSlot({ narrative: { call: 12 } as unknown as Record<string, string> }, "call")).toBeNull();
  });
});

describe("normalizeSentence", () => {
  it("folds case and punctuation, so two stock sentences count as one", () => {
    expect(normalizeSentence("He is a BUY, at this price.")).toBe(normalizeSentence("he is a buy at this price"));
  });
});
