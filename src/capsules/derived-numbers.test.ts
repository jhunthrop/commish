import { describe, expect, it } from "vitest";
import { derivedNumbers, lawEffectTotal, pointsDifferences, rateTimesGamesNumbers, seasonTotalSums, type FactsContent } from "./derived-numbers";
import { buildPlayerFacts, type PlayerFactsInput } from "./facts";

/**
 * THE DERIVED LEDGER, HELPER BY HELPER (fix round, 2026-09-08). Each helper is the arithmetic a
 * reader does on two printed facts and nothing else; the whole is their concatenation, and its
 * size is pinned because coincidence space is the size of this list.
 */

function law(id: string, effect: number) {
  return {
    id,
    position: "RB" as const,
    claim: "A claim.",
    measured: { effect, ci: [effect - 0.5, effect + 0.5] as [number, number], sample: 120, seasons: "2018-2024" },
    trainEffect: effect,
    verdict: "confirmed" as const,
    modelPath: null,
    hasFoldEvidence: true,
    origin: "tribal" as const,
    primaryQuantityId: null,
    primaryQuantityNoun: null,
    primaryQuantityUnit: null,
  };
}

const rank = (value: number, positionRank: number) => ({ value, positionRank, qualifierCount: 60, namedNeighbor: null });

const LAW_EFFECTS = [2.9, 2.7, 2.1, -1.8, 1.3];

function input(overrides: Partial<PlayerFactsInput> = {}): PlayerFactsInput {
  return {
    identity: { id: "p1", name: "Rashad Long", position: "RB", team: "SF" },
    productSeason: 2026,
    reasons: [
      { code: "scarcity", positionRank: 4, replacementLevel: 228 },
      { code: "market_anchor", marketPoints: 235, delta: 13 },
      { code: "availability", expectedGames: 16, floorGames: 12, ceilingGames: 17 },
      ...LAW_EFFECTS.map((effect, index) => ({ code: "law" as const, lawId: `law_${index}`, effect, magnitude: 10 })),
    ],
    laws: LAW_EFFECTS.map((effect, index) => law(`law_${index}`, effect)),
    market: { adp: 12.5, positionAdp: "RB6", boardRank: 14 },
    projection: { projectedPoints: 248, floorPoints: 178, medianPoints: 240, ceilingPoints: 275 },
    byeWeek: 9,
    season: { season: 2026, gamesPlayed: 13, pointsPerGame: 20.3, totals: { carries: 215, rushingYards: 1081, targets: 70, receptions: 56, receivingYards: 602, passingYards: 0, touchdowns: 7, fantasyPoints: 258.1 } },
    injury: { state: "unknown" },
    news: [],
    lastSeasonStory: { season: 2025, pointsRank: rank(301.4, 5), pointsPerGame: 17.7, gamesPlayed: 17, bestWeek: { week: 4, points: 33.4 }, weeksAboveMedian: 12, touchesRank: rank(280, 8), receivingYardsRank: rank(412, 20) },
    booksNumbers: { propsLines: [], teamVegasWinTotal: null },
    usage: null,
    trend: null,
    ...overrides,
  };
}

const FULL: FactsContent = buildPlayerFacts(input());
const BARE: FactsContent = buildPlayerFacts(input({ reasons: [], laws: [], season: null, lastSeasonStory: null }));

describe("pointsDifferences", () => {
  it("reads every headline points figure against our number, both signs, plus the two band widths", () => {
    const differences = pointsDifferences(FULL);
    for (const figure of [178, 275, 228, FULL.market.marketAnchorPoints!, 301.4, 258.1]) {
      expect(differences).toContain(248 - figure);
      expect(differences).toContain(figure - 248);
    }
    expect(differences).toContain(275 - 178);
    expect(differences).toContain(FULL.projection.typicalHigh - FULL.projection.typicalLow);
    expect(differences).toHaveLength(6 * 2 + 2);
  });

  it("never pairs two figures other than our number", () => {
    expect(pointsDifferences(FULL)).not.toContain(275 - 228);
    expect(pointsDifferences(FULL)).not.toContain(301.4 - 258.1);
  });

  it("carries only the tails and the band widths for a player with no replacement, anchor or seasons", () => {
    expect(pointsDifferences(BARE)).toHaveLength(2 * 2 + 2);
  });
});

describe("rateTimesGamesNumbers", () => {
  it("pairs each per-game rate with its own season's games only, the raw product once", () => {
    expect(rateTimesGamesNumbers(FULL)).toEqual([20.3 * 16, 17.7 * 17]);
  });

  it("never pairs a rate with the other season's games, a full season, or a tail of the games range", () => {
    const products = rateTimesGamesNumbers(FULL);
    for (const stray of [20.3 * 13, 20.3 * 17, 20.3 * 12, 17.7 * 16]) expect(products).not.toContain(stray);
  });

  it("is empty with no played season and no prior season, and needs availability for this season's product", () => {
    expect(rateTimesGamesNumbers(BARE)).toEqual([]);
    const noAvailability = buildPlayerFacts(input({ reasons: [], laws: [] }));
    expect(rateTimesGamesNumbers(noAvailability)).toEqual([17.7 * 17]);
  });
});

describe("lawEffectTotal", () => {
  it("is the grand total of every law effect on the case, and nothing pairwise", () => {
    const total = lawEffectTotal(FULL);
    expect(total).toHaveLength(1);
    expect(total[0]).toBeCloseTo(LAW_EFFECTS.reduce((sum, effect) => sum + effect, 0), 10);
  });

  it("is empty for a single effect (already on the ledger) and for none", () => {
    expect(lawEffectTotal(buildPlayerFacts(input({ reasons: [{ code: "law", lawId: "law_0", effect: 2.9, magnitude: 10 }], laws: [law("law_0", 2.9)] })))).toEqual([]);
    expect(lawEffectTotal(BARE)).toEqual([]);
  });
});

describe("seasonTotalSums", () => {
  it("sums yards from scrimmage, all yards and touches from the listed parts", () => {
    expect(seasonTotalSums(FULL)).toEqual([1081 + 602, 1081 + 602 + 0, 215 + 56]);
  });

  it("is empty with no played season, and skips touches when carries are unknown", () => {
    expect(seasonTotalSums(BARE)).toEqual([]);
    const noCarries = buildPlayerFacts(input({ season: { season: 2026, gamesPlayed: 13, pointsPerGame: 20.3, totals: { carries: null, rushingYards: 0, targets: 70, receptions: 56, receivingYards: 602, passingYards: 0, touchdowns: 7, fantasyPoints: 258.1 } } }));
    expect(seasonTotalSums(noCarries)).toEqual([602, 602]);
  });
});

describe("derivedNumbers", () => {
  it("is the four helpers plus the three per-game figures, and stays under 25 values for a five-law player with everything on the sheet", () => {
    const all = derivedNumbers(FULL);
    expect(all).toEqual([...pointsDifferences(FULL), ...rateTimesGamesNumbers(FULL), 248 / 17, 248 / 16, 17 - 16, ...lawEffectTotal(FULL), ...seasonTotalSums(FULL)]);
    expect(all).toHaveLength(23);
    expect(all.length).toBeLessThan(25);
  });
});
