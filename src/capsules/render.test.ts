import { describe, expect, it } from "vitest";
import { BANNED_VOCABULARY } from "./config";
import { buildPlayerFacts, type PlayerFactsInput } from "./facts";
import { renderFactsForModel } from "./render";

function baseInput(overrides: Partial<PlayerFactsInput> = {}): PlayerFactsInput {
  return {
    identity: { id: "p1", name: "Rashad Long", position: "RB", team: "SF" },
    productSeason: 2026,
    reasons: [
      { code: "law", lawId: "rb_age_curve", effect: -1.8, magnitude: 29 },
      { code: "market_anchor", marketPoints: 227, delta: 21 },
      { code: "scarcity", positionRank: 6, replacementLevel: 140 },
      { code: "tier_cliff", playersLeftInTier: 2, dropToNextTier: 18.4 },
      { code: "new_play_caller", team: "MIA" },
    ],
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
    market: { adp: 12.5, positionAdp: "RB6", boardRank: 14 },
    projection: { projectedPoints: 248, floorPoints: 178, medianPoints: 240, ceilingPoints: 275 },
    byeWeek: 9,
    season: {
      season: 2026,
      gamesPlayed: 3,
      pointsPerGame: 18.4,
      totals: { carries: 42, rushingYards: 210, targets: 9, receptions: 7, receivingYards: 55, passingYards: 0, touchdowns: 3, fantasyPoints: 55.2 },
    },
    injury: { state: "designated", designation: "Q", asOf: "2026-09-01T00:00:00.000Z" },
    news: [{ title: "Rashad Long: limited in practice", link: "https://example.com/1", publishedAt: "2026-09-02T00:00:00.000Z" }],
    ...overrides,
  };
}

describe("renderFactsForModel", () => {
  it("never emits any banned-vocabulary term", () => {
    const facts = buildPlayerFacts(baseInput());
    const rendered = renderFactsForModel(facts).toLowerCase();
    for (const term of BANNED_VOCABULARY) {
      expect(rendered.includes(term.toLowerCase())).toBe(false);
    }
  });

  it("phrases the market anchor as a historically-returned fact, never an implication", () => {
    const facts = buildPlayerFacts(baseInput());
    const rendered = renderFactsForModel(facts);
    expect(rendered).toContain("historically returned about 227 points a season");
    expect(rendered).not.toMatch(/impl(y|ying|ied)/i);
  });

  it("attaches real rank context (board's own scarcity rank, market's own ADP rank) without inventing a per-quantity rank", () => {
    const facts = buildPlayerFacts(baseInput());
    const rendered = renderFactsForModel(facts);
    expect(rendered).toContain("position rank RB6 by our own board");
    expect(rendered).toContain("RB6 by market rank");
  });

  it("renders the new-play-caller beat in the founder's own manager-language phrasing", () => {
    const facts = buildPlayerFacts(baseInput());
    const rendered = renderFactsForModel(facts);
    expect(rendered).toContain("New play caller at MIA; a new play caller is the honest concern.");
  });

  it("states an honest absence of games played, never a fabricated zero line, when no season data exists", () => {
    const facts = buildPlayerFacts(baseInput({ season: null }));
    const rendered = renderFactsForModel(facts);
    expect(rendered).toContain("No games played yet this season.");
  });

  it("leads with the most-seasons band and frames the low tail as an availability fact, never a bare floor", () => {
    const facts = buildPlayerFacts(baseInput());
    const rendered = renderFactsForModel(facts);
    expect(rendered).toContain("Most seasons land between");
    expect(rendered).toContain("The full tails run 178 to 275");
    expect(rendered).toContain("injury seasons, not a talent read");
  });

  it("carries the designated state with its own as-of date", () => {
    const facts = buildPlayerFacts(baseInput({ injury: { state: "designated", designation: "Q", asOf: "2026-09-01T00:00:00.000Z" } }));
    const rendered = renderFactsForModel(facts);
    expect(rendered).toContain("designation Q as of 2026-09-01");
  });

  it("carries a genuinely clean read as a DATED claim, never a timeless health statement", () => {
    const facts = buildPlayerFacts(baseInput({ injury: { state: "clean", asOf: "2026-09-01T00:00:00.000Z" } }));
    const rendered = renderFactsForModel(facts);
    expect(rendered).toContain("checked as of 2026-09-01");
    expect(rendered).toContain("no designation was on file that day");
  });

  it("fix round 1 CRITICAL 2: never states a healthy claim when no injury snapshot has ever been read", () => {
    const facts = buildPlayerFacts(baseInput({ injury: { state: "unknown" } }));
    const rendered = renderFactsForModel(facts);
    expect(rendered).toContain("no injury feed has been checked for him yet");
    expect(rendered).not.toMatch(/healthy|no designation was on file/i);
  });

  it("is deterministic for identical facts", () => {
    const facts = buildPlayerFacts(baseInput());
    expect(renderFactsForModel(facts)).toBe(renderFactsForModel(facts));
  });
});
