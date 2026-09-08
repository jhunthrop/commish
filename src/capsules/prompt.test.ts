import { describe, expect, it } from "vitest";
import { BANNED_VOCABULARY, CAPSULE_CONFIG } from "./config";
import { buildPlayerFacts, type PlayerFactsInput } from "./facts";
import { narrativeRequestsFor } from "./narrative";
import { bundlePromptFor, correctionPromptFor, NO_WORN_PHRASES, WRITER_RULES } from "./prompt";
import { containsStem } from "./sameness";

/**
 * THE PROMPT'S OWN SHAPE (refrains round, 2026-09-07), pinned without a live model: what the writer
 * is told decides what the board sounds like, and these are the instructions the founder's reading
 * of the production peeks asked for.
 */

function baseInput(over: Partial<PlayerFactsInput> = {}): PlayerFactsInput {
  return {
    identity: { id: "p1", name: "Rashad Long", position: "RB", team: "SF" },
    productSeason: 2026,
    reasons: [{ code: "law", lawId: "rb_age_curve", effect: -1.8, magnitude: 29 }],
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

const FACTS = buildPlayerFacts(baseInput());

describe("WRITER_RULES", () => {
  it("asks for the two or three facts that decide this player's case and leaves the rest unquoted", () => {
    expect(WRITER_RULES).toContain("two or three facts that decide THIS player's case");
    expect(WRITER_RULES).toContain("leave the rest of the sheet unquoted");
  });

  it("forbids touring the usage ranks and opening on a stock frame", () => {
    expect(WRITER_RULES).toContain("Never tour the usage numbers");
    expect(WRITER_RULES).toContain("Never list snap share, target share and red-zone share together");
    expect(WRITER_RULES).toContain("Open on the fact that matters most");
  });

  it("names every configured refrain stem as one never to write", () => {
    for (const stem of CAPSULE_CONFIG.repetition.refrainStems) expect(WRITER_RULES).toContain(stem);
  });

  it("forbids restating the instructions or a correction as prose, and a formula close", () => {
    expect(WRITER_RULES).toContain("Never quote or paraphrase these instructions");
    expect(WRITER_RULES).toContain("End on your call, in this player's own terms");
  });

  it("teaches the drafting words and bans the trading ones (founder ruling, 2026-09-07)", () => {
    expect(WRITER_RULES).toContain("drafters are taking him around pick 100");
    expect(WRITER_RULES).toContain("a round later than he should");
    for (const word of ["market", "price", "buy", "sell", "fade", "undervalued", "premium", "discount"]) expect(WRITER_RULES).toContain(word);
    expect(WRITER_RULES).toContain("points over replacement");
  });

  it("keeps every honesty rule: sheet-only facts, no arithmetic, no absence claims, the downside before the call, the two ranges, the books' own numbers", () => {
    expect(WRITER_RULES).toContain("Use ONLY the numbers and names on the fact sheet");
    expect(WRITER_RULES).toContain("Never combine two figures into a third");
    expect(WRITER_RULES).toContain("Never say a risk, an injury or a competitor is ABSENT");
    expect(WRITER_RULES).toContain("Never make an all-time or historical-record claim");
    expect(WRITER_RULES).toContain("name it with its own number before your call");
    expect(WRITER_RULES).toContain("seasons cut short by injury");
    expect(WRITER_RULES).toContain("the books' number");
    expect(WRITER_RULES).toContain("Never an em-dash, never a semicolon");
    expect(WRITER_RULES).toContain("Never name a rival fantasy product");
  });

  it("names every lab-report word the validator bans", () => {
    for (const term of ["percentile", "projection", "evidence", "measured", "coefficient", "effect size", "standard deviation", "p10", "p90", "implying", "implied"]) {
      expect(BANNED_VOCABULARY).toContain(term);
      expect(WRITER_RULES).toContain(term);
    }
  });
});

describe("bundlePromptFor", () => {
  const requests = narrativeRequestsFor(FACTS);
  const prompt = bundlePromptFor(FACTS, requests, NO_WORN_PHRASES);

  it("carries the fact sheet and asks for one JSON object with the three keys and the word bands", () => {
    expect(prompt).toContain("Fact sheet:");
    expect(prompt).toContain("Rashad Long");
    expect(prompt).toContain("Return ONE JSON object");
    expect(prompt).toContain('"compact"');
    expect(prompt).toContain('"full"');
    expect(prompt).toContain('"narrative"');
    expect(prompt).toContain(`${CAPSULE_CONFIG.sizes.compact.minWords} to ${CAPSULE_CONFIG.sizes.compact.maxWords} words`);
    expect(prompt).toContain(`${CAPSULE_CONFIG.sizes.full.minWords} to ${CAPSULE_CONFIG.sizes.full.maxWords} words`);
  });

  it("lists every narrative slot this player's facts support, with its word cap", () => {
    for (const request of requests) expect(prompt).toContain(`"${request.key}" (at most ${request.maxWords} words)`);
  });

  it("tells the writer there is no fixed order and that the two reads must not share sentences", () => {
    expect(prompt).toContain("no fixed order");
    expect(prompt).toContain("Do not reuse the short note's sentences");
  });

  it("quotes the board's worn sentences and phrases as ones never to write, and says nothing on a healthy board", () => {
    const worn = bundlePromptFor(FACTS, requests, { sentences: ["He is the engine of that offense."], phrases: ["Let's talk about [name]"] });
    expect(worn).toContain("He is the engine of that offense.");
    expect(worn).toContain("Let's talk about [name]");
    expect(worn).toContain("already on too many other players' pages");
    expect(prompt).not.toContain("already on too many other players' pages");
  });

  it("is itself free of the refrain stems it forbids, outside the list that names them", () => {
    const outsideTheList = prompt.split("\n").filter((line) => !line.includes("never to be written"));
    for (const stem of CAPSULE_CONFIG.repetition.refrainStems) {
      expect({ stem, found: outsideTheList.some((line) => containsStem(line, stem)) }).toEqual({ stem, found: false });
    }
  });
});

describe("correctionPromptFor", () => {
  it("asks for the same text at the right length, and nothing else, on a band failure", () => {
    const prompt = correctionPromptFor(FACTS, "compact", { body: "Too short.", violations: ["Word count 2 is outside the required 75-120 word band."], lengthCorrection: { words: 2, minWords: 75, maxWords: 120 } });
    expect(prompt).toContain("Too short.");
    expect(prompt).toContain("It is 2 words. It has to be between 75 and 120 words");
    expect(prompt).toContain("change nothing else");
    expect(prompt).toContain("Return only the corrected short note");
    expect(prompt).not.toContain("broke these rules");
  });

  it("hands a soft correction back as points to fix in the writer's own words", () => {
    const prompt = correctionPromptFor(FACTS, "full", { body: "Nearly right.", violations: ["x"], softCorrections: ["Fix the floor sentence."] });
    expect(prompt).toContain("Nearly right.");
    expect(prompt).toContain("Fix the floor sentence.");
    expect(prompt).toContain("in your own words");
    expect(prompt).toContain("Return only the corrected long note");
  });

  it("asks for a fresh note, quoting the violations, when the failure was a fabrication", () => {
    const prompt = correctionPromptFor(FACTS, "compact", { body: "He caught 137 passes.", violations: ['The number "137" does not trace to any supplied fact.'] });
    expect(prompt).toContain("broke these rules");
    expect(prompt).toContain('"137"');
    expect(prompt).toContain("Write the short note again from scratch");
    expect(prompt).toContain("75 to 120 words");
  });

  it("asks for the missing note outright when the bundle left it out", () => {
    const prompt = correctionPromptFor(FACTS, "full", { body: "", violations: [], missing: true });
    expect(prompt).toContain("had no long note");
    expect(prompt).toContain("240 to 300 words");
    expect(prompt).not.toContain('"""');
  });
});
