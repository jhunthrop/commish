import { describe, expect, it } from "vitest";
import { buildPlayerFacts, type PlayerFactsInput } from "./facts";
import { validateCapsule } from "./validate";

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
    const body = compactWords("Rashad Long is a buy for the SF offense if he ever gets the goal-line work, our number of 248 season points and board rank 14 overall.");
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
    const oneSided = compactWords("Rashad Long is a clear buy for the SF offense, our number of 248 season points and board rank 14 overall make him a lock this season.");
    const oneSidedResult = validateCapsule(oneSided, facts, "compact");
    expect(oneSidedResult.ok).toBe(false);
    expect(oneSidedResult.violations.some((v) => v.includes("Mixed evidence"))).toBe(true);

    const withHesitation = compactWords("Rashad Long anchors the SF offense at board rank 14 overall, our number of 248 season points, though the age curve costs him -1.8 a game, still a buy this season.");
    const withHesitationResult = validateCapsule(withHesitation, facts, "compact");
    expect(withHesitationResult.violations.some((v) => v.includes("Mixed evidence"))).toBe(false);
  });

  it("reports an empty completion as a failure rather than an empty capsule", () => {
    const facts = buildPlayerFacts(baseInput());
    const result = validateCapsule("   ", facts, "compact");
    expect(result.ok).toBe(false);
    expect(result.violations[0]).toContain("empty");
  });
});
