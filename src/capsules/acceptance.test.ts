import { describe, expect, it } from "vitest";
import { buildPlayerFacts, type PlayerFactsInput } from "./facts";
import { NARRATIVE_WORD_CAPS } from "./narrative-slots";
import { validateCapsule, validateNarrativeSlot } from "./validate";

/**
 * THE ACCEPTANCE ROUND'S OWN FIXTURES (2026-09-07) — every rejection the coordinator's live
 * diagnostic actually measured, one test each, against the exact examples it recorded.
 *
 * 446 of 659 board players sat on the template, and the cause was the VALIDATOR, not the gateway:
 * roughly one in ten generations passed. The categories, most common first, were an ungrounded
 * number (nearly all of them honest readings of supplied facts), the word band, and two name
 * false positives. Each of those examples is a test below that PASSES now, paired with a test
 * proving the thing the check exists to catch still fails.
 *
 * The suite deliberately reads as a before-and-after ledger of that measurement, so the next
 * person to loosen a check can see exactly which failure each loosening was bought for.
 */

function baseInput(overrides: Partial<PlayerFactsInput> = {}): PlayerFactsInput {
  return {
    identity: { id: "p1", name: "Rashad Long", position: "RB", team: "NYG" },
    productSeason: 2026,
    reasons: [{ code: "scarcity", positionRank: 4, replacementLevel: 228 }],
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
    trend: {
      pointsPerGame: { priorSeason: 2024, priorValue: 2.55, recentSeason: 2025, recentValue: 7.94, delta: 5.39, material: true },
      yardsPerOpportunity: null,
      targetShare: null,
    },
    ...overrides,
  };
}

const FACTS = buildPlayerFacts(baseInput());

/** One short, grounded sentence — the shape of a narrative slot, which is where a single written
 *  number is easiest to test without a seventy-word band getting in the way. */
function slotResult(text: string, facts = FACTS) {
  return validateNarrativeSlot(text, facts, NARRATIVE_WORD_CAPS.module);
}

describe("cause 1: an ungrounded NUMBER that was never ungrounded", () => {
  it("grounds a season year the fact sheet names, which is how 'back in 2024' was failing", () => {
    expect(slotResult("Back in 2024 he was barely playing, and the last year turned that around.").ok).toBe(true);
  });

  it("grounds the rounded form of a ledger value: 2.6 from a ledgered 2.55, 7.9 from 7.94", () => {
    expect(slotResult("He went from 2.6 a game to 7.9 a game, which is the whole story here.").ok).toBe(true);
  });

  it("grounds a subtraction of two supplied facts: our number over the replacement level", () => {
    // 248 projected, 228 replacement level, so "20 points clear" is arithmetic the page itself
    // performs, not a number the model invented.
    expect(slotResult("He is 20 points clear of the man you would otherwise be starting.").ok).toBe(true);
  });

  it("grounds every percent form of a ledgered share", () => {
    const facts = buildPlayerFacts(
      baseInput({
        usage: {
          season: 2025,
          snapShare: null,
          snapShareRank: null,
          targetShare: 0.2476,
          targetShareRank: null,
          redZoneShare: null,
          redZoneShareRank: null,
        },
      }),
    );
    for (const written of ["24.8%", "25%", "24.76%"]) {
      expect(slotResult(`He took ${written} of that team's targets last season, which leads the backfield.`, facts).ok).toBe(true);
    }
  });

  it("still fails a number that traces to nothing at all", () => {
    const result = slotResult("He caught 137 passes last season and nobody could cover him.");
    expect(result.ok).toBe(false);
    expect(result.violations[0]).toContain("137");
  });

  it("still fails a number near a ledger value but past any honest rounding of it", () => {
    // 2.55 rounds to 2.6 and to 3, never to 3.4.
    const result = slotResult("He averaged 3.4 a game that year, which is the number to hang on to.");
    expect(result.ok).toBe(false);
    expect(result.violations[0]).toContain("3.4");
  });
});

describe("cause 2: the word band is graded first, and alone", () => {
  it("returns the band violation by itself, so the retry can be a length correction", () => {
    const tooShort = "He is a buy at this price and nothing else needs saying about him today.";
    const result = validateCapsule(tooShort, FACTS, "compact");
    expect(result.ok).toBe(false);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]).toContain("outside the required");
    expect(result.bandFailure).toEqual({ words: 15, minWords: 60, maxWords: 110 });
  });

  it("does not report a grounding failure on a text it has already refused for its length", () => {
    // The same too-short text with a fabricated number in it: the length is the only thing said,
    // because the corrected text is what will actually be graded for grounding.
    const result = validateCapsule("He caught 137 passes and that is that.", FACTS, "compact");
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]).toContain("outside the required");
  });

  it("reports no band failure once the length is right", () => {
    const result = validateCapsule("He caught 137 passes and that is that.", FACTS, "compact");
    expect(result.bandFailure).not.toBeNull();
    expect(slotResult("He is a buy at this price, and the market has not caught up yet.").bandFailure).toBeNull();
  });

  it("still fails a call of thirty-one words", () => {
    const thirtyOne = Array.from({ length: 31 }, (_, index) => (index === 0 ? "He" : "runs")).join(" ");
    const result = validateNarrativeSlot(thirtyOne, FACTS, NARRATIVE_WORD_CAPS.call);
    expect(result.ok).toBe(false);
    expect(result.bandFailure).toEqual({ words: 31, minWords: 3, maxWords: 30 });
  });
});

describe("cause 3: name false positives", () => {
  it("reads a contraction plus a position code as words, not as the name 'He QB'", () => {
    expect(slotResult("He's QB proof that the price and the production have come apart.").ok).toBe(true);
  });

  it("grounds the city of a team the facts name", () => {
    expect(slotResult("New York leans on him every single week, and that is the case for him.").ok).toBe(true);
  });

  it("grounds the nickname and the full name of that team too", () => {
    expect(slotResult("The Giants lean on him, and the New York Giants have nobody else to lean on.").ok).toBe(true);
  });

  it("grounds a possessive of the subject's own name", () => {
    expect(slotResult("Rashad Long's role is the whole case, and the price has not caught up.").ok).toBe(true);
  });

  it("still fails a fabricated two-word name", () => {
    const result = slotResult("Justin Herbert throws him the ball on every third down these days.");
    expect(result.ok).toBe(false);
    expect(result.violations[0]).toContain("Justin Herbert");
  });

  it("still fails another team's city, which the facts never named", () => {
    const result = slotResult("Kansas City would give plenty for a back with this kind of role.");
    expect(result.ok).toBe(false);
    expect(result.violations.join(" ")).toContain("Kansas City");
  });
});

describe("cause 4: the mixed-evidence violation reads like a number a person wrote", () => {
  it("states the downside to one decimal, never as a raw float", () => {
    const facts = buildPlayerFacts(
      baseInput({ reasons: [{ code: "law", lawId: "rb_age_curve", effect: -0.9372183908045988, magnitude: 29 }] }),
    );
    const filler = Array.from({ length: 30 }, () => "plainly").join(" ");
    const body = validateCapsule(
      `Rashad Long is our number at 248 season points with a range from 178 to 275, and board rank 14 overall says the same about him, so the case is a plain one this season. ${filler}.`,
      facts,
      "compact",
    );
    expect(body.bandFailure).toBeNull();
    const tension = body.violations.find((violation) => violation.startsWith("Mixed evidence"));
    expect(tension).toContain("-0.9 pts/game");
    expect(tension).not.toContain("0.9372183908045988");
  });
});
