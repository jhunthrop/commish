import { describe, expect, it } from "vitest";
import { buildPlayerFacts, type PlayerFactsInput } from "./facts";
import { EMPTY_DEPTH, type PlayerFactsDepth } from "./facts/types";
import { CAPSULE_CONFIG } from "./config";
import { NARRATIVE_WORD_CAPS } from "./narrative-slots";
import { depthNumbers } from "./facts/ledger";
import { renderFactsForModel } from "./render";
import { renderDepthSection } from "./render-depth";
import { softCorrectionFor, UNFRAMED_FLOOR_VIOLATION, validateCapsule, validateNarrativeSlot } from "./validate";

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
    expect(result.bandFailure).toEqual({ words: 15, minWords: 75, maxWords: 120 });
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
    const filler = Array.from({ length: 45 }, () => "plainly").join(" ");
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

/**
 * THE SECOND LIVE MEASUREMENT (2026-09-07, 100 players on dev: 42 written, $0.26). Its own
 * rejections, most common first: 125 ungrounded numbers, 71 unframed floor claims, 69 word bands,
 * 16 throttles, 8 ungrounded names, 7 uncited downsides. One fixture per cause.
 */
describe("grounded by construction: what the prompt shows is quotable", () => {
  const facts = buildPlayerFacts(
    baseInput({
      usage: {
        season: 2025,
        snapShare: 0.345,
        snapShareRank: { value: 0.345, positionRank: 8, qualifierCount: 41, namedNeighbor: null },
        targetShare: null,
        targetShareRank: null,
        redZoneShare: null,
        redZoneShareRank: null,
      },
    }),
  );

  it("grounds a percentage in exactly the form the fact sheet prints it", () => {
    // The live rejection was: The number "34.5%" does not trace to any supplied fact.
    expect(renderFactsForModel(facts)).toContain("34.5%");
    expect(slotResult("He was on the field for 34.5% of the snaps, which is the whole case here.", facts).ok).toBe(true);
  });

  it("grounds every number the fact sheet renders, whatever form it renders it in", () => {
    // The strongest possible statement of the rule, asserted against the sheet itself: nothing the
    // model can read back at us is a fabrication.
    const printed = renderFactsForModel(facts).match(/\d+(?:\.\d+)?/g) ?? [];
    expect(printed.length).toBeGreaterThan(5);
    for (const number of printed) {
      expect(slotResult(`The sheet says ${number} and that is what it says about him.`, facts).ok).toBe(true);
    }
  });

  it("still fails a number the prompt never showed and no rounding reaches", () => {
    const result = slotResult("He was on the field for 61.2% of the snaps last season, every week.", facts);
    expect(result.ok).toBe(false);
    expect(result.violations[0]).toContain("61.2");
  });
});

describe("the injury designation is a word, not a person", () => {
  const facts = buildPlayerFacts(baseInput({ injury: { state: "designated", designation: "Q", asOf: "2026-09-01T00:00:00.000Z" } }));

  it("reads 'The Q' as the report code the sheet printed", () => {
    // The live rejection was: The name "The Q" does not trace to any supplied fact.
    expect(slotResult("The Q next to his name is the only thing standing between him and a start.", facts).ok).toBe(true);
  });

  it("still fails a real fabricated name in the same sentence shape", () => {
    expect(slotResult("The Marcus Long next to his name is the only thing standing there.", facts).ok).toBe(false);
  });
});

describe("the soft rules are corrected before they are refused", () => {
  it("hands the floor rule back as a correction rather than a rewrite", () => {
    const correction = softCorrectionFor(UNFRAMED_FLOOR_VIOLATION);
    expect(correction).toContain("games missed, not talent");
  });

  it("hands the uncited downside back with the number it wants stated", () => {
    const correction = softCorrectionFor("Mixed evidence: the strongest downside (-1.8 pts/game) must be cited as an honest hesitation before the call.");
    expect(correction).toContain("-1.8 pts/game");
    expect(correction).toContain("change nothing else");
  });

  it("does not soften a fabrication: an ungrounded number has no correction at all", () => {
    expect(softCorrectionFor('The number "137" does not trace to any supplied fact.')).toBeNull();
    expect(softCorrectionFor('The name "Justin Herbert" does not trace to any supplied fact.')).toBeNull();
  });

  it("still fails the floor claim itself, so the correction has something to correct", () => {
    const facts = buildPlayerFacts(baseInput());
    const result = slotResult("His floor is 178 and that is the number to plan a season around.", facts);
    expect(result.ok).toBe(false);
    expect(result.violations).toContain(UNFRAMED_FLOOR_VIOLATION);
  });
});

/**
 * THE DEPTH SECTION IS GROUNDED TOO (fact-sheet depth merge, 2026-09-07). The sheet grew by about
 * sixty percent, and the rule this round turned on is "what the prompt shows is quotable". That
 * rule is only as good as the ledger behind the new lines, so this asserts the property directly
 * rather than trusting the merge: every number the depth section PRINTS is a number the depth
 * LEDGER carries, and every number the whole sheet prints grounds through the validator.
 */
describe("the depth section, grounded", () => {
  /** Populated group by group from the depth suite's own shapes: only the groups that carry
   *  numbers need to be here, since a group with no number cannot break a number rule. */
  const depth = {
    ...EMPTY_DEPTH,
    gamesMissed: [{ season: 2025, missed: 3, of: 17 }],
    priorSeasons: [{ season: 2024, games: 16, points: 289.6, pointsPerGame: 18.1 }],
  } as unknown as PlayerFactsDepth;

  const facts = buildPlayerFacts({ ...baseInput(), depth } as PlayerFactsInput);

  it("prints no number the depth ledger does not carry", () => {
    const section = renderDepthSection(facts);
    if (section === null) return;
    const printed = (section.match(/\d+(?:\.\d+)?/g) ?? []).map(Number);
    const ledgered = new Set(depthNumbers(facts.depth).map((value) => Number(value)));
    for (const value of printed) {
      // Either the exact figure, or a figure the section rounded for readability, which the
      // validator's own rounding tolerance then accepts.
      const grounded = ledgered.has(value) || [...ledgered].some((entry) => Math.abs(entry - value) <= 0.5);
      expect({ value, grounded }).toEqual({ value, grounded: true });
    }
  });

  it("still grounds every number the whole rendered sheet shows, depth included", () => {
    for (const number of renderFactsForModel(facts).match(/\d+(?:\.\d+)?/g) ?? []) {
      expect(slotResult(`The sheet says ${number} and that is what it says about him.`, facts).ok).toBe(true);
    }
  });
});

/**
 * THE BAND'S OWN EDGES (fix round) — the bands were set from a measured distribution, so the one
 * thing a test must pin is that the numbers in `config.ts` ARE the numbers enforced, at the exact
 * word where each side turns over. Asserted against the constants rather than against literals, so
 * a future re-measure moves the band and these tests follow it.
 */
describe("the word bands are exactly the configured ones", () => {
  const facts = buildPlayerFacts(baseInput());

  /** `count` words with no digit and no capitalised token, so only the LENGTH is under test. */
  function words(count: number): string {
    return Array.from({ length: count }, (_, index) => (index === 0 ? "he" : "runs")).join(" ");
  }

  for (const size of ["compact", "full"] as const) {
    const { minWords, maxWords } = CAPSULE_CONFIG.sizes[size];

    it(`${size}: ${minWords - 1} words fails and ${minWords} passes`, () => {
      expect(validateCapsule(words(minWords - 1), facts, size).bandFailure).toEqual({ words: minWords - 1, minWords, maxWords });
      expect(validateCapsule(words(minWords), facts, size).bandFailure).toBeNull();
    });

    it(`${size}: ${maxWords} words passes and ${maxWords + 1} fails`, () => {
      expect(validateCapsule(words(maxWords), facts, size).bandFailure).toBeNull();
      expect(validateCapsule(words(maxWords + 1), facts, size).bandFailure).toEqual({ words: maxWords + 1, minWords, maxWords });
    });
  }

  it("holds the bands the acceptance round measured", () => {
    // Stated once, so a change to the constants is a deliberate act with a failing test beside it.
    expect(CAPSULE_CONFIG.sizes.compact).toMatchObject({ minWords: 75, maxWords: 120 });
    expect(CAPSULE_CONFIG.sizes.full).toMatchObject({ minWords: 240, maxWords: 300 });
  });
});

/**
 * THE NARROWED FLOOR RULE (fix round) — the founder's ruling is about a bare "floor of 91", a p10
 * restated as a talent claim. Two narrowings were measured into this rule and both need pinning:
 * a floor with no FIGURE beside it is an ordinary thing an analyst says, and the availability
 * language that satisfies the rule is the widened list rather than the original four phrasings.
 */
describe("the floor rule, narrowed", () => {
  const facts = buildPlayerFacts(baseInput());

  it("lets a floor with no number through, availability language or not", () => {
    const result = slotResult("He has a high floor and the role behind it is not going anywhere.", facts);
    expect(result.ok).toBe(true);
  });

  it("still refuses a floor with a number and no availability language", () => {
    const result = slotResult("His floor is 178 points and that is the number to plan a season around.", facts);
    expect(result.ok).toBe(false);
    expect(result.violations).toContain(UNFRAMED_FLOOR_VIOLATION);
  });

  it("accepts a floor with a number once availability is anywhere in the text", () => {
    for (const framing of [
      "the durability is the only question",
      "he was sidelined twice last year",
      "the games he misses are the whole risk",
    ]) {
      const result = slotResult(`His floor is 178 points, and ${framing} behind that number.`, facts);
      expect({ framing, ok: result.ok }).toEqual({ framing, ok: true });
    }
  });
});
