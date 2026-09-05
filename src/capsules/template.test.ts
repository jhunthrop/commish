import { describe, expect, it } from "vitest";
import { buildPlayerFacts, type PlayerFactsInput } from "./facts";
import { renderTemplateCapsule } from "./template";

function baseInput(overrides: Partial<PlayerFactsInput> = {}): PlayerFactsInput {
  return {
    identity: { id: "p1", name: "Rashad Long", position: "RB", team: "SF" },
    productSeason: 2026,
    reasons: [{ code: "law", lawId: "rb_age_curve", effect: -1.8, magnitude: 29 }, { code: "availability", expectedGames: 15, floorGames: 11, ceilingGames: 17 }],
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
    season: null,
    injuryDesignation: null,
    injuryAsOf: null,
    news: [],
    ...overrides,
  };
}

describe("renderTemplateCapsule", () => {
  it("is deterministic for identical facts", () => {
    const facts = buildPlayerFacts(baseInput());
    expect(renderTemplateCapsule(facts)).toBe(renderTemplateCapsule(facts));
  });

  it("states only facts already on the sheet: board rank, projection, market, strongest law, availability, injury", () => {
    const facts = buildPlayerFacts(baseInput());
    const text = renderTemplateCapsule(facts);
    expect(text).toContain("Rashad Long (RB, SF)");
    expect(text).toContain("ranked 14 overall");
    expect(text).toContain("248 points");
    expect(text).toContain("ADP 12.5 (RB6)");
    expect(text).toContain("Age 29 season");
    expect(text).toContain("-1.8 points a game");
    expect(text).toContain("15 games");
    expect(text).toContain("bye is week 9");
    expect(text).toContain("no designation");
  });

  it("states an unpriced market honestly rather than a fabricated ADP", () => {
    const facts = buildPlayerFacts(baseInput({ market: { adp: null, positionAdp: null, boardRank: 14 } }));
    const text = renderTemplateCapsule(facts);
    expect(text).toContain("The market has not priced him.");
  });

  it("states the real injury designation when present", () => {
    const facts = buildPlayerFacts(baseInput({ injuryDesignation: "Q", injuryAsOf: "2026-09-01T00:00:00.000Z" }));
    const text = renderTemplateCapsule(facts);
    expect(text).toContain("lists him as Q");
  });

  it("leads with the most-seasons band and frames the wide range as injury/smash seasons, never a bare floor", () => {
    const facts = buildPlayerFacts(baseInput());
    const text = renderTemplateCapsule(facts);
    expect(text).toContain("Most seasons land between");
    expect(text).toContain("injury seasons on the low end");
  });

  it("never fabricates a season line when no season data exists", () => {
    const facts = buildPlayerFacts(baseInput({ season: null }));
    const text = renderTemplateCapsule(facts);
    expect(text).not.toContain("averaging");
  });

  it("states the real season average when season data exists", () => {
    const facts = buildPlayerFacts(
      baseInput({
        season: { season: 2026, gamesPlayed: 3, pointsPerGame: 18.4, totals: { carries: 42, rushingYards: 210, targets: 9, receptions: 7, receivingYards: 55, passingYards: 0, touchdowns: 3, fantasyPoints: 55.2 } },
      }),
    );
    const text = renderTemplateCapsule(facts);
    expect(text).toContain("Through 3 games this season he is averaging 18.4 points a game.");
  });
});
