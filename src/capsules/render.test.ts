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
    lastSeasonStory: null,
    booksNumbers: { propsLines: [], teamVegasWinTotal: null },
    usage: null,
    trend: null,
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

describe("renderFactsForModel — the color", () => {
  it("omits 'The color' section entirely when the store carries none of the three groups", () => {
    const facts = buildPlayerFacts(baseInput());
    expect(renderFactsForModel(facts)).not.toContain("The color:");
  });

  it("states last season's finish, points per game, best week and consistency read in plain words", () => {
    const facts = buildPlayerFacts(
      baseInput({
        lastSeasonStory: {
          season: 2025,
          pointsRank: { value: 264, positionRank: 4, qualifierCount: 42, namedNeighbor: null },
          pointsPerGame: 18.2,
          gamesPlayed: 16,
          bestWeek: { week: 9, points: 32.4 },
          weeksAboveMedian: 9,
          touchesRank: { value: 210, positionRank: 6, qualifierCount: 42, namedNeighbor: null },
          receivingYardsRank: { value: 612, positionRank: 3, qualifierCount: 42, namedNeighbor: "Star Wideout" },
        },
      }),
    );
    const rendered = renderFactsForModel(facts);
    expect(rendered).toContain("The color:");
    expect(rendered).toContain("Last season (2025): total points 264, RB4 among 42 qualifying running backs");
    expect(rendered).toContain("averaging 18.2 points a game");
    expect(rendered).toContain("His best week was week 9 with 32.4 points");
    expect(rendered).toContain("above the position's own weekly median in 9 of those 16 games");
    expect(rendered).toContain("Touches 210, RB6 among 42 qualifying running backs.");
    expect(rendered).toContain("Receiving yards 612, RB3 among 42 qualifying running backs, one spot behind Star Wideout.");
  });

  it("states props lines in plain English, never the raw market key, and frames them as what the books returned", () => {
    const facts = buildPlayerFacts(
      baseInput({ booksNumbers: { propsLines: [{ market: "player_reception_yds", medianLine: 1150.5 }, { market: "player_pass_tds", medianLine: 28.5 }], teamVegasWinTotal: 9.5 } }),
    );
    const rendered = renderFactsForModel(facts);
    expect(rendered).toContain("receiving yards 1150.5");
    expect(rendered).toContain("pass touchdowns 28.5");
    expect(rendered).not.toContain("player_reception_yds");
    expect(rendered).not.toContain("player_pass_tds");
    expect(rendered).toContain("His team's own Vegas win total for this season is 9.5");
    expect(rendered).not.toMatch(/impl(y|ying|ied)/i);
  });

  it("omits the props sentence when the archive captured nothing, but still states a real win total", () => {
    const facts = buildPlayerFacts(baseInput({ booksNumbers: { propsLines: [], teamVegasWinTotal: 9.5 } }));
    const rendered = renderFactsForModel(facts);
    expect(rendered).not.toContain("pre-kickoff lines");
    expect(rendered).toContain("Vegas win total for this season is 9.5");
  });

  it("states last season's usage shares as whole-percent numbers, omitting any share the store lacks", () => {
    const facts = buildPlayerFacts(
      baseInput({ usage: { season: 2025, snapShare: 0.848, snapShareRank: null, targetShare: null, targetShareRank: null, redZoneShare: 0.19, redZoneShareRank: null } }),
    );
    const rendered = renderFactsForModel(facts);
    expect(rendered).toContain("Last season's usage (2025): snap share 84.8%, red-zone share of his own touches 19.0%.");
    expect(rendered).not.toContain("target share");
  });

  it("states a usage share's own rank and named neighbor when the store carries one", () => {
    const facts = buildPlayerFacts(
      baseInput({
        usage: {
          season: 2025,
          snapShare: 0.848,
          snapShareRank: { value: 0.848, positionRank: 2, qualifierCount: 40, namedNeighbor: "Snap King" },
          targetShare: null,
          targetShareRank: null,
          redZoneShare: null,
          redZoneShareRank: null,
        },
      }),
    );
    const rendered = renderFactsForModel(facts);
    expect(rendered).toContain("Last season's usage (2025): snap share 84.8%, RB2 among 40 qualifying running backs, one spot behind Snap King.");
  });

  it("states a material trend as an honest rose/fell sentence with both raw seasons", () => {
    const facts = buildPlayerFacts(
      baseInput({
        trend: {
          pointsPerGame: { priorSeason: 2023, priorValue: 10, recentSeason: 2024, recentValue: 30, delta: 20, material: true },
          yardsPerOpportunity: { priorSeason: 2023, priorValue: 5.4, recentSeason: 2024, recentValue: 4.6, delta: -0.8, material: true },
          targetShare: null,
        },
      }),
    );
    const rendered = renderFactsForModel(facts);
    expect(rendered).toContain("His points per game rose from 10 in 2023 to 30 in 2024.");
    expect(rendered).toContain("His yards per touch fell from 5.4 in 2023 to 4.6 in 2024.");
  });

  it("uses yards per target, not yards per touch, for a WR/TE subject", () => {
    const facts = buildPlayerFacts(
      baseInput({
        identity: { id: "p1", name: "Star Wideout", position: "WR", team: "SF" },
        trend: {
          pointsPerGame: null,
          yardsPerOpportunity: { priorSeason: 2023, priorValue: 8.1, recentSeason: 2024, recentValue: 10.5, delta: 2.4, material: true },
          targetShare: null,
        },
      }),
    );
    const rendered = renderFactsForModel(facts);
    expect(rendered).toContain("His yards per target rose from 8.1 in 2023 to 10.5 in 2024.");
  });

  it("never narrates an immaterial trend, even though it still exists on the fact sheet", () => {
    const facts = buildPlayerFacts(
      baseInput({
        trend: {
          pointsPerGame: { priorSeason: 2023, priorValue: 10, recentSeason: 2024, recentValue: 10.1, delta: 0.1, material: false },
          yardsPerOpportunity: null,
          targetShare: { priorSeason: 2023, priorValue: 0.2, recentSeason: 2024, recentValue: 0.21, delta: 0.01, material: false },
        },
      }),
    );
    const rendered = renderFactsForModel(facts);
    expect(rendered).not.toMatch(/points per game (rose|fell)/);
    expect(rendered).not.toMatch(/target share (rose|fell)/);
  });

  it("never emits any banned-vocabulary term even with every color group populated", () => {
    const facts = buildPlayerFacts(
      baseInput({
        lastSeasonStory: {
          season: 2025,
          pointsRank: { value: 264, positionRank: 4, qualifierCount: 42, namedNeighbor: null },
          pointsPerGame: 18.2,
          gamesPlayed: 16,
          bestWeek: { week: 9, points: 32.4 },
          weeksAboveMedian: 9,
          touchesRank: { value: 210, positionRank: 6, qualifierCount: 42, namedNeighbor: null },
          receivingYardsRank: { value: 612, positionRank: 3, qualifierCount: 42, namedNeighbor: "Star Wideout" },
        },
        booksNumbers: { propsLines: [{ market: "player_reception_yds", medianLine: 1150.5 }], teamVegasWinTotal: 9.5 },
        usage: {
          season: 2025,
          snapShare: 0.848,
          snapShareRank: { value: 0.848, positionRank: 1, qualifierCount: 40, namedNeighbor: null },
          targetShare: 0.263,
          targetShareRank: { value: 0.263, positionRank: 2, qualifierCount: 40, namedNeighbor: "Target Hog" },
          redZoneShare: 0.19,
          redZoneShareRank: { value: 0.19, positionRank: 5, qualifierCount: 40, namedNeighbor: null },
        },
      }),
    );
    const rendered = renderFactsForModel(facts).toLowerCase();
    for (const term of BANNED_VOCABULARY) {
      expect(rendered.includes(term.toLowerCase())).toBe(false);
    }
  });
});
