import { describe, expect, it } from "vitest";
import { CAPSULE_CONFIG, TRADING_REPLACEMENTS, TRADING_TERMS } from "./config";
import { buildPlayerFacts, type PlayerFactsInput } from "./facts";
import { bannedTermIn, softCorrectionFor, validateCapsule } from "./validate";

function baseInput(overrides: Partial<PlayerFactsInput> = {}): PlayerFactsInput {
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
    ...overrides,
  };
}

/** Pads a hand-written sentence out to `target` words with plain, digit-free, lowercase filler —
 *  ninety by default, the middle of the compact band the acceptance round measured (75-120) —
 *  so a test can hit the validator's word-count band without introducing a stray number or a
 *  capitalized token that would trip the number/name checks this suite is not testing. */
function compactWords(sentence: string, target = 90): string {
  const words = sentence.trim().replace(/\.$/, "").split(/\s+/);
  const fillerPool = ["truly", "clearly", "frankly", "simply", "plainly", "further", "notably", "steadily", "really", "overall"];
  let i = 0;
  while (words.length < target) {
    words.push(fillerPool[i % fillerPool.length]!);
    i += 1;
  }
  return `${words.join(" ")}.`;
}

describe("validateCapsule", () => {
  it("passes a clean capsule that cites only ledgered numbers and names", () => {
    const facts = buildPlayerFacts(baseInput());
    const body = compactWords("Rashad Long profiles as our number of 248 season points, with a wide range from 178 to 275, board rank 14 overall for the SF offense he anchors this year.");
    const result = validateCapsule(body, facts, "compact");
    expect(result.ok).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it("catches a fabricated number that traces to no supplied fact", () => {
    const facts = buildPlayerFacts(baseInput());
    const body = compactWords("Rashad Long is going to score 37 touchdowns this year for the SF offense, a truly special outlook with board rank 14 overall and our number of 248.");
    const result = validateCapsule(body, facts, "compact");
    expect(result.ok).toBe(false);
    expect(result.violations.some((v) => v.includes('"37"'))).toBe(true);
  });

  it("passes a rounded reading of a fact rather than an exact figure", () => {
    const facts = buildPlayerFacts(baseInput({ market: { adp: 12.456, positionAdp: "RB6", boardRank: 14 } }));
    const body = compactWords("Rashad Long goes off the board around ADP 12 for SF, with our own number at 248 season points and board rank 14 overall this season.");
    const result = validateCapsule(body, facts, "compact");
    expect(result.ok).toBe(true);
  });

  it("catches an em-dash", () => {
    const facts = buildPlayerFacts(baseInput());
    const body = compactWords("Rashad Long is the engine of the SF offense — our number of 248 season points, board rank 14 overall, says so plainly this season.");
    const result = validateCapsule(body, facts, "compact");
    expect(result.ok).toBe(false);
    expect(result.violations.some((v) => v.toLowerCase().includes("em-dash"))).toBe(true);
  });

  it("catches banned lab-report vocabulary", () => {
    const facts = buildPlayerFacts(baseInput());
    const body = compactWords("Rashad Long's measured effect on the SF offense supports our number of 248 season points and board rank 14 overall for this season ahead.");
    const result = validateCapsule(body, facts, "compact");
    expect(result.ok).toBe(false);
    expect(result.violations.some((v) => v.includes('"measured"'))).toBe(true);
  });

  it("catches a competitor product name", () => {
    const facts = buildPlayerFacts(baseInput());
    const body = compactWords("Rashad Long ranks RB6 on Yahoo and our own number backs it up at 248 season points, board rank 14 overall for the SF offense this season.");
    const result = validateCapsule(body, facts, "compact");
    expect(result.ok).toBe(false);
    expect(result.violations.some((v) => v.toLowerCase().includes("yahoo"))).toBe(true);
  });

  it("leaves a bare \"ever\" alone, which claims nothing at all", () => {
    const facts = buildPlayerFacts(baseInput());
    // a bare "ever" is ordinary English, not an all-time claim.
    const body = compactWords("Rashad Long is a steal for the SF offense if he ever gets the goal-line work, our number of 248 season points and board rank 14 overall.");
    expect(validateCapsule(body, facts, "compact").ok).toBe(true);
  });

  it("catches an all-time superlative this engine cannot back up", () => {
    const facts = buildPlayerFacts(baseInput());
    const body = compactWords("Rashad Long is one of the best ever at his position for the SF offense, our number of 248 season points and board rank 14 overall this season.");
    const result = validateCapsule(body, facts, "compact");
    expect(result.ok).toBe(false);
    // "best ever" is the shape the ruling is about; a bare "ever" is not (acceptance round,
    // iteration 3: it was catching "if he ever gets the goal-line work", which claims nothing).
    expect(result.violations.some((v) => v.includes('"best ever"'))).toBe(true);
  });

  it("catches a bare 'floor' claim with no injury or availability context", () => {
    const facts = buildPlayerFacts(baseInput());
    const body = compactWords("Rashad Long has a floor of 178 for the SF offense, our number of 248 season points and board rank 14 overall make him a lock this season.");
    const result = validateCapsule(body, facts, "compact");
    expect(result.ok).toBe(false);
    expect(result.violations.some((v) => v.toLowerCase().includes("floor"))).toBe(true);
  });

  it("passes a 'floor' claim paired with real injury/availability context", () => {
    const facts = buildPlayerFacts(baseInput());
    const body = compactWords("Rashad Long has a floor of 178 for the SF offense, our number of 248 season points and board rank 14 overall this season, the low end is really about injury risk more than talent.");
    const result = validateCapsule(body, facts, "compact");
    expect(result.violations.some((v) => v.toLowerCase().includes('says "floor"'))).toBe(false);
  });

  it("does not flag ordinary words that merely contain a banned substring", () => {
    const facts = buildPlayerFacts(baseInput());
    const body = compactWords("Whatever happens, Rashad Long delivers steady coverage of touches for the SF offense, our number of 248 season points and board rank 14 overall.");
    const result = validateCapsule(body, facts, "compact");
    expect(result.violations.some((v) => v.includes('"ever"'))).toBe(false);
  });

  it("enforces the word-count band for the requested size", () => {
    const facts = buildPlayerFacts(baseInput());
    const result = validateCapsule("Too short.", facts, "compact");
    expect(result.ok).toBe(false);
    expect(result.violations.some((v) => v.includes("Word count"))).toBe(true);
  });

  it("requires a real proper name to trace to a supplied fact", () => {
    const facts = buildPlayerFacts(baseInput());
    const body = compactWords("Rashad Long splits carries with Marcus Fakename in the SF backfield, our number of 248 season points and board rank 14 overall this season.");
    const result = validateCapsule(body, facts, "compact");
    expect(result.ok).toBe(false);
    expect(result.violations.some((v) => v.includes("Marcus Fakename"))).toBe(true);
  });

  it("mandated tension: requires the strongest negative law effect be cited when mixed evidence exists", () => {
    const facts = buildPlayerFacts(
      baseInput({
        reasons: [{ code: "law", lawId: "rb_age_curve", effect: -1.8, magnitude: 29 }],
        laws: [
          {
            id: "rb_age_curve",
            position: "RB",
            claim: "Running backs decline sharply after 28.",
            measured: { effect: -1.8, ci: [-2.4, -1.2], sample: 120, seasons: "2018-2024" },
            trainEffect: -1.8,
            verdict: "confirmed",
            modelPath: null,
            hasFoldEvidence: true,
            origin: "tribal",
            primaryQuantityId: null,
            primaryQuantityNoun: null,
            primaryQuantityUnit: null,
          },
        ],
      }),
    );
    const oneSided = compactWords("Rashad Long is a clear steal for the SF offense, our number of 248 season points and board rank 14 overall make him a lock this season.");
    const oneSidedResult = validateCapsule(oneSided, facts, "compact");
    expect(oneSidedResult.ok).toBe(false);
    expect(oneSidedResult.violations.some((v) => v.includes("Mixed evidence"))).toBe(true);

    const withHesitation = compactWords("Rashad Long anchors the SF offense at board rank 14 overall, our number of 248 season points, though the age curve costs him -1.8 a game, still a steal this season.");
    const withHesitationResult = validateCapsule(withHesitation, facts, "compact");
    expect(withHesitationResult.violations.some((v) => v.includes("Mixed evidence"))).toBe(false);
  });

  it("mandates the citation only from 1.0 points a game (production follow-up, 2026-09-08): a 0.9 downside is a number a person would not mention", () => {
    const withDownside = (effect: number) =>
      buildPlayerFacts(
        baseInput({
          reasons: [{ code: "law", lawId: "rb_age_curve", effect, magnitude: 29 }],
          laws: [
            {
              id: "rb_age_curve",
              position: "RB",
              claim: "Running backs decline sharply after 28.",
              measured: { effect, ci: [effect - 0.6, effect + 0.6], sample: 120, seasons: "2018-2024" },
              trainEffect: effect,
              verdict: "confirmed",
              modelPath: null,
              hasFoldEvidence: true,
              origin: "tribal",
              primaryQuantityId: null,
              primaryQuantityNoun: null,
              primaryQuantityUnit: null,
            },
          ],
        }),
      );
    const oneSided = compactWords("Rashad Long is a clear steal for the SF offense, our number of 248 season points and board rank 14 overall make him a lock this season.");
    expect(CAPSULE_CONFIG.tensionThresholdPoints).toBe(1);
    expect(validateCapsule(oneSided, withDownside(-0.9), "compact").violations.some((v) => v.includes("Mixed evidence"))).toBe(false);
    expect(validateCapsule(oneSided, withDownside(-1), "compact").violations.some((v) => v.includes("Mixed evidence"))).toBe(true);
  });

  it('lets a read say "projection" (production follow-up, 2026-09-08): it is how fantasy people talk, never lab-report register', () => {
    expect(bannedTermIn("Our projection has him at 248, a round clear of his ADP.")).toBeNull();
    expect(bannedTermIn("We project him for 248 points.")).toBeNull();
    expect(bannedTermIn("His p90 season is 275.")).toBe("p90");
  });

  it("reports an empty completion as a failure rather than an empty capsule", () => {
    const facts = buildPlayerFacts(baseInput());
    const result = validateCapsule("   ", facts, "compact");
    expect(result.ok).toBe(false);
    expect(result.violations[0]).toContain("empty");
  });
});

/**
 * A BANNED TRADING WORD IS HANDED BACK WITH ITS DRAFTING REPLACEMENT (production follow-up,
 * 2026-09-08). "Rewrite without it" left the writer to guess the replacement, and fourteen players
 * fell to the template on "price" in one night; the correction now names the phrase for the word
 * it found, and keeps the prose, the way the floor correction does.
 */
describe("a banned trading word is corrected with its drafting replacement", () => {
  const facts = buildPlayerFacts(baseInput());

  it("names a drafting replacement for every trading word the ruling banned", () => {
    for (const term of TRADING_TERMS) expect({ term, replacement: TRADING_REPLACEMENTS[term] }).toMatchObject({ term, replacement: expect.any(Array) });
  });

  it("puts the three drafting sentences in a price violation and hands them back as a soft correction", () => {
    const body = compactWords("Rashad Long at this price is a steal for the SF offense, our number of 248 season points and board rank 14 overall say so this season.");
    const violation = validateCapsule(body, facts, "compact").violations.find((v) => v.includes('banned term "price"'));
    expect(violation).toContain("drafters are taking him around pick 100");
    expect(violation).toContain("he is going a round later than he should");
    expect(violation).toContain("a reach at his ADP");
    expect(violation).not.toContain("Rewrite without it");
    const correction = softCorrectionFor(violation!);
    expect(correction).toContain('"price"');
    expect(correction).toContain("a reach at his ADP");
    expect(correction).toContain("leave everything else as it is");
  });

  it("still asks for a rewrite, with no soft correction, on a lab-report word", () => {
    const body = compactWords("Rashad Long is a p90 season waiting to happen for the SF offense, our number of 248 season points and board rank 14 overall say so this season.");
    const violation = validateCapsule(body, facts, "compact").violations.find((v) => v.includes('banned term "p90"'));
    expect(violation).toContain("Rewrite without it.");
    expect(softCorrectionFor(violation!)).toBeNull();
  });
});
