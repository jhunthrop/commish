import { describe, expect, it } from "vitest";
import type { Law } from "@/projections/laws/types";
import type { BoardReason } from "@/projections/preseason/board";
import { buildPlayerFacts, type PlayerFactsInput } from "./facts";

const TRIBAL_LAW: Law = {
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
};

function baseInput(overrides: Partial<PlayerFactsInput> = {}): PlayerFactsInput {
  return {
    identity: { id: "p1", name: "Rashad Long", position: "RB", team: "SF" },
    productSeason: 2026,
    reasons: [],
    laws: [TRIBAL_LAW],
    market: { adp: 12.5, positionAdp: "RB6", boardRank: 14 },
    projection: { projectedPoints: 248, floorPoints: 178, medianPoints: 240, ceilingPoints: 275 },
    byeWeek: 9,
    season: null,
    injury: { state: "unknown" },
    news: [],
    lastSeasonStory: null,
    booksNumbers: { propsLines: [], teamVegasWinTotal: null },
    usage: null,
    ...overrides,
  };
}

describe("buildPlayerFacts", () => {
  it("is deterministic: identical input produces byte-identical facts and the same hash", () => {
    const input = baseInput({ reasons: [{ code: "law", lawId: "rb_age_curve", effect: -1.8, magnitude: 29 }] });
    const a = buildPlayerFacts(input);
    const b = buildPlayerFacts(input);
    expect(a).toEqual(b);
    expect(a.factsHash).toBe(b.factsHash);
  });

  it("changes the hash when a fact changes (injury designation)", () => {
    const withoutInjury = buildPlayerFacts(baseInput());
    const withInjury = buildPlayerFacts(baseInput({ injury: { state: "designated", designation: "Q", asOf: "2026-09-01T00:00:00.000Z" } }));
    expect(withInjury.factsHash).not.toBe(withoutInjury.factsHash);
  });

  it("pulls availability into its own field, never as a peer evidence item", () => {
    const reasons: readonly BoardReason[] = [{ code: "availability", expectedGames: 15, floorGames: 11, ceilingGames: 17 }];
    const facts = buildPlayerFacts(baseInput({ reasons }));
    expect(facts.availability).toEqual({ expectedGames: 15, floorGames: 11, ceilingGames: 17 });
    expect(facts.evidence.some((item) => "kind" in item && (item as { kind: string }).kind === "availability")).toBe(false);
    expect(facts.evidence).toHaveLength(0);
  });

  it("routes market_anchor, scarcity and tier_cliff into `market`, never into `evidence`", () => {
    const reasons: readonly BoardReason[] = [
      { code: "market_anchor", marketPoints: 227, delta: 21 },
      { code: "scarcity", positionRank: 6, replacementLevel: 140 },
      { code: "tier_cliff", playersLeftInTier: 2, dropToNextTier: 18.4 },
    ];
    const facts = buildPlayerFacts(baseInput({ reasons }));
    expect(facts.market.marketAnchorPoints).toBe(227);
    expect(facts.market.marketAnchorDelta).toBe(21);
    expect(facts.market.positionRank).toBe(6);
    expect(facts.market.replacementLevel).toBe(140);
    expect(facts.market.playersLeftInTier).toBe(2);
    expect(facts.market.dropToNextTier).toBe(18.4);
    expect(facts.evidence).toHaveLength(0);
  });

  it("groups law reasons with a net effect and a law count, strongest first", () => {
    const reasons: readonly BoardReason[] = [
      { code: "law", lawId: "rb_age_curve", effect: -1.8, magnitude: 29 },
      { code: "changed_team", from: "SF", to: "MIA" },
    ];
    const facts = buildPlayerFacts(baseInput({ reasons }));
    expect(facts.evidence[0]).toEqual({ kind: "law", headline: "Age 29 season", netEffectPoints: -1.8, lawCount: 1 });
    expect(facts.evidence[1]).toEqual({ kind: "changed_team", from: "SF", to: "MIA" });
  });

  it("carries the season summary through untouched when a played season exists", () => {
    const season = {
      season: 2026,
      gamesPlayed: 3,
      pointsPerGame: 18.4,
      totals: { carries: 42, rushingYards: 210, targets: 9, receptions: 7, receivingYards: 55, passingYards: 0, touchdowns: 3, fantasyPoints: 55.2 },
    };
    const facts = buildPlayerFacts(baseInput({ season }));
    expect(facts.season).toEqual(season);
  });

  it("builds a number ledger covering every numeric fact, including whole-percent forms of a share change", () => {
    const reasons: readonly BoardReason[] = [{ code: "offseason_share_gained", targetShare: 0.04, carryShare: 0.02 }];
    const facts = buildPlayerFacts(baseInput({ reasons, byeWeek: 9 }));
    expect(facts.numberLedger).toEqual(
      expect.arrayContaining([2026, 14, 12.5, 248, 178, 240, 275, 0.04, 4, 0.02, 2, 9]),
    );
  });

  it("builds a name ledger with the player's full name, its individual words, his team and his position", () => {
    const facts = buildPlayerFacts(baseInput());
    expect(facts.nameLedger).toEqual(expect.arrayContaining(["Rashad Long", "Rashad", "Long", "SF", "RB"]));
  });

  it("adds a changed team's from/to teams and a new play caller's team to the name ledger", () => {
    const reasons: readonly BoardReason[] = [
      { code: "changed_team", from: "SF", to: "MIA" },
      { code: "new_play_caller", team: "MIA" },
    ];
    const facts = buildPlayerFacts(baseInput({ reasons }));
    expect(facts.nameLedger).toEqual(expect.arrayContaining(["MIA"]));
  });
});

/**
 * THE COLOR FACTS (spec §9 AMENDED 2026-09-05) — `collect.ts` computes each of these fully before
 * `buildPlayerFacts` ever sees them, so this suite only pins the pass-through, the ledger
 * additions, absence handling, and `factsHash` freshness — the same contract `season`/`byeWeek`
 * already had before this task.
 */
describe("buildPlayerFacts — color facts", () => {
  const lastSeasonStory = {
    season: 2025,
    pointsRank: { value: 264, positionRank: 4, qualifierCount: 42, namedNeighbor: null },
    pointsPerGame: 18.2,
    gamesPlayed: 16,
    bestWeek: { week: 9, points: 32.4 },
    weeksAboveMedian: 9,
    touchesRank: { value: 210, positionRank: 2, qualifierCount: 42, namedNeighbor: "Leader Back" },
    receivingYardsRank: { value: 612, positionRank: 3, qualifierCount: 42, namedNeighbor: "Runner Up Back" },
  };
  const booksNumbers = { propsLines: [{ market: "player_reception_yds" as const, medianLine: 1150.5 }], teamVegasWinTotal: 9.5 };
  const usage = {
    season: 2025,
    snapShare: 0.848,
    snapShareRank: { value: 0.848, positionRank: 1, qualifierCount: 40, namedNeighbor: null },
    targetShare: 0.263,
    targetShareRank: { value: 0.263, positionRank: 2, qualifierCount: 40, namedNeighbor: "Target Hog" },
    redZoneShare: 0.19,
    redZoneShareRank: { value: 0.19, positionRank: 5, qualifierCount: 40, namedNeighbor: null },
  };

  it("is null/empty by default, honest absence rather than a fabricated debut season", () => {
    const facts = buildPlayerFacts(baseInput());
    expect(facts.lastSeasonStory).toBeNull();
    expect(facts.booksNumbers).toEqual({ propsLines: [], teamVegasWinTotal: null });
    expect(facts.usage).toBeNull();
  });

  it("carries each color group straight through when collect.ts supplies one", () => {
    const facts = buildPlayerFacts(baseInput({ lastSeasonStory, booksNumbers, usage }));
    expect(facts.lastSeasonStory).toEqual(lastSeasonStory);
    expect(facts.booksNumbers).toEqual(booksNumbers);
    expect(facts.usage).toEqual(usage);
  });

  it("puts every color number into the number ledger, including whole-percent forms of each share and every rank's own value/rank/qualifier count", () => {
    const facts = buildPlayerFacts(baseInput({ lastSeasonStory, booksNumbers, usage }));
    expect(facts.numberLedger).toEqual(
      expect.arrayContaining([
        2025, 264, 4, 42, 18.2, 16, 9, 32.4, 9, 210, 2, 42, 612, 3, 42, // lastSeasonStory, incl. touches/receivingYards ranks
        1150.5, 9.5, // booksNumbers
        84.8, 0.848, 1, 40, 26.3, 0.263, 2, 40, 19, 0.19, 5, 40, // usage shares, each with its own rank triple
      ]),
    );
  });

  it("puts a top-three named neighbor into the name ledger, groundable for a capsule to cite", () => {
    const facts = buildPlayerFacts(baseInput({ lastSeasonStory, booksNumbers, usage }));
    expect(facts.nameLedger).toEqual(expect.arrayContaining(["Leader Back", "Runner Up Back", "Target Hog"]));
  });

  it("never puts a null share into the ledger, and a partial usage row still passes its real shares through", () => {
    const facts = buildPlayerFacts(
      baseInput({ usage: { season: 2025, snapShare: 0.5, snapShareRank: null, targetShare: null, targetShareRank: null, redZoneShare: null, redZoneShareRank: null } }),
    );
    expect(facts.numberLedger).toContain(50);
    expect(facts.numberLedger.filter((n) => n === null)).toHaveLength(0);
  });

  it("changes the hash when a color fact changes, proving factsHash includes them", () => {
    const without = buildPlayerFacts(baseInput());
    const withColor = buildPlayerFacts(baseInput({ lastSeasonStory, booksNumbers, usage }));
    expect(withColor.factsHash).not.toBe(without.factsHash);
  });
});
