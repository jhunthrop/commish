import { describe, expect, it } from "vitest";
import { buildPlayerFacts, type PlayerFactsInput } from "./facts";
import { narrativeRequestsFor, settleNarrative } from "./narrative";
import { absenceSlotKey, ABSENCE_MODULES, NARRATIVE_KEYS, narrativeSlot, normalizeSentence, whyGroupSlotKey } from "./narrative-slots";
import { groundingOf, validateNarrativeSlot } from "./validate";

/**
 * THE NARRATIVE, WITHOUT A GATEWAY. The slots come back inside the one-call bundle now (refrains
 * round, 2026-09-07), so nothing here touches a fetch at all: which slots are asked for, what the
 * validator accepts and what a bad object does are all pure, and none of it needs a live model.
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

const GROUNDED_CALL = "He is the engine of that SF offense and the ADP has not caught up.";

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

describe("validateNarrativeSlot", () => {
  const facts = buildPlayerFacts(baseInput());

  it("accepts a grounded call", () => {
    expect(validateNarrativeSlot(GROUNDED_CALL, groundingOf(facts), 30).ok).toBe(true);
  });

  it("rejects a number that traces to nothing on the fact sheet", () => {
    const result = validateNarrativeSlot("He caught 137 passes last year and nobody can cover him.", groundingOf(facts), 30);
    expect(result.ok).toBe(false);
    expect(result.violations[0]).toContain("137");
  });

  it("rejects thirty-one words in the call's own band", () => {
    const thirtyOne = Array.from({ length: 31 }, (_, index) => (index === 0 ? "He" : "runs")).join(" ");
    const result = validateNarrativeSlot(thirtyOne, groundingOf(facts), 30);
    expect(result.ok).toBe(false);
    expect(result.violations[0]).toContain("outside the required");
  });

  it("rejects a fabricated teammate, an em-dash, a semicolon and the lab-report register", () => {
    expect(validateNarrativeSlot("Justin Herbert throws him the ball every week now.", groundingOf(facts), 40).ok).toBe(false);
    expect(validateNarrativeSlot("He is a steal — the ADP is wrong.", groundingOf(facts), 40).ok).toBe(false);
    expect(validateNarrativeSlot("He is a steal; the ADP is wrong.", groundingOf(facts), 40).ok).toBe(false);
    expect(validateNarrativeSlot("His percentile sits above his ADP.", groundingOf(facts), 40).ok).toBe(false);
  });

  it("does not demand the tension citation a whole read has to carry", () => {
    // The strongest downside is -1.8 a game and this sentence never mentions it. A thirty-word
    // call cannot carry the case and the hesitation both; the reads still must.
    expect(validateNarrativeSlot(GROUNDED_CALL, groundingOf(facts), 30).ok).toBe(true);
  });
});

describe("settleNarrative", () => {
  it("keeps every grounded slot and drops only the ones that fail", () => {
    const facts = buildPlayerFacts(baseInput());
    const raw = {
      [NARRATIVE_KEYS.call]: GROUNDED_CALL,
      [NARRATIVE_KEYS.tier]: "Two backs are left in his tier before a 20.9 point drop, so the wait costs you.",
      [absenceSlotKey(ABSENCE_MODULES.usage)]: "Nobody charted his snaps last year, so watch the early-down work in August.",
      unknownKey: "This slot was never asked for.",
      [NARRATIVE_KEYS.perGame]: "He caught 137 passes a year ago and the games question answers itself.",
    };

    const result = settleNarrative(raw, facts, narrativeRequestsFor(facts));

    expect(result.slots[NARRATIVE_KEYS.call]).toBe(GROUNDED_CALL);
    expect(result.slots[NARRATIVE_KEYS.tier]).toContain("20.9 point drop");
    expect(result.slots).not.toHaveProperty("unknownKey");
    expect(result.slots).not.toHaveProperty(NARRATIVE_KEYS.perGame);
    expect(result.rejected.join(" ")).toContain("137");
    expect(result.model).toBe("zai/glm-5.3-flash");
    expect(result.failure).toBeNull();
  });

  it("reads a skipped or blank slot as absence, never as a rejection", () => {
    const facts = buildPlayerFacts(baseInput());
    const result = settleNarrative({ [NARRATIVE_KEYS.call]: "   ", [NARRATIVE_KEYS.tier]: 12 }, facts, narrativeRequestsFor(facts));
    expect(result.slots).toEqual({});
    expect(result.rejected).toEqual([]);
    expect(result.model).toBeNull();
  });

  it("names the failure when the answer carried no narrative object at all", () => {
    const facts = buildPlayerFacts(baseInput());
    const result = settleNarrative(null, facts, narrativeRequestsFor(facts));
    expect(result.slots).toEqual({});
    expect(result.failure).toBe("the answer carried no narrative object");
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
