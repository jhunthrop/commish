import { describe, expect, it } from "vitest";
import { buildPlayerFacts, type PlayerFactsInput, type PlayerFactsLastSeasonStory } from "./facts";
import { renderTemplateCapsule } from "./template";

/** A last-season story fixture the floor's own single color sentence reads
 *  (`pointsRank.positionRank`/`pointsPerGame`) — the template never touches touches or receiving
 *  yards, so those ranks are filled in with plausible, unused values. */
const LAST_SEASON_STORY_FIXTURE: PlayerFactsLastSeasonStory = {
  season: 2025,
  pointsRank: { value: 264, positionRank: 4, qualifierCount: 42, namedNeighbor: null },
  pointsPerGame: 18.2,
  gamesPlayed: 16,
  bestWeek: { week: 9, points: 32.4 },
  weeksAboveMedian: 9,
  touchesRank: { value: 210, positionRank: 6, qualifierCount: 42, namedNeighbor: null },
  receivingYardsRank: { value: 612, positionRank: 3, qualifierCount: 42, namedNeighbor: null },
};

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
    injury: { state: "unknown" },
    news: [],
    lastSeasonStory: null,
    booksNumbers: { propsLines: [], teamVegasWinTotal: null },
    usage: null,
    trend: null,
    ...overrides,
  };
}

describe("renderTemplateCapsule", () => {
  it("is deterministic for identical facts", () => {
    const facts = buildPlayerFacts(baseInput());
    expect(renderTemplateCapsule(facts)).toBe(renderTemplateCapsule(facts));
  });

  it("states the floor's own facts and never echoes the surfaces around it (founder card review, 2026-09-05)", () => {
    const facts = buildPlayerFacts(baseInput());
    const text = renderTemplateCapsule(facts);
    expect(text).toContain("Rashad Long (RB, SF)");
    expect(text).toContain("248 points");
    expect(text).toContain("Age 29 season");
    expect(text).toContain("-1.8 points a game");
    expect(text).toContain("bye is week 9");
    // The rail above carries rank and ADP; the evidence chips below carry expected games. The
    // floor repeats none of them, and season points round to a whole number.
    expect(text).not.toContain("ranked 14 overall");
    expect(text).not.toContain("ADP 12.5");
    expect(text).not.toContain("expected to play");
    expect(text).not.toContain("248.");
    // THE TRI-STATE (fix round 1, CRITICAL 2): the fixture's default injury state is "unknown"
    // (no snapshot has ever run) — this must NEVER read as a healthy claim.
    expect(text).toContain("We have not checked an injury feed for him yet.");
  });

  it("keeps the unpriced-market sentence: the one market fact no other surface states", () => {
    const facts = buildPlayerFacts({ ...baseInput(), market: { adp: null, positionAdp: null, boardRank: 14 } });
    expect(renderTemplateCapsule(facts)).toContain("The market has not priced him.");
  });

  it("states a genuinely clean read, dated, distinct from 'never checked'", () => {
    const facts = buildPlayerFacts(baseInput({ injury: { state: "clean", asOf: "2026-09-01T00:00:00.000Z" } }));
    const text = renderTemplateCapsule(facts);
    expect(text).toContain("showed no designation for him as of 2026-09-01");
    expect(text).not.toContain("never been checked");
  });

  it("states an unpriced market honestly rather than a fabricated ADP", () => {
    const facts = buildPlayerFacts(baseInput({ market: { adp: null, positionAdp: null, boardRank: 14 } }));
    const text = renderTemplateCapsule(facts);
    expect(text).toContain("The market has not priced him.");
  });

  it("states the real injury designation when present", () => {
    const facts = buildPlayerFacts(baseInput({ injury: { state: "designated", designation: "Q", asOf: "2026-09-01T00:00:00.000Z" } }));
    const text = renderTemplateCapsule(facts);
    expect(text).toContain("lists him as Q");
  });

  it("leads with the most-seasons band and frames the wide range as injury/smash seasons, never a bare floor", () => {
    const facts = buildPlayerFacts(baseInput());
    const text = renderTemplateCapsule(facts);
    expect(text).toContain("Most seasons land between");
    expect(text).toContain("the low end is what an injury year looks like");
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

  it("adds one color sentence, last season's finish and points per game, when the store carries one", () => {
    const facts = buildPlayerFacts(baseInput({ lastSeasonStory: LAST_SEASON_STORY_FIXTURE }));
    const text = renderTemplateCapsule(facts);
    expect(text).toContain("Last season he finished RB4 at the position, averaging 18.2 points a game.");
  });

  it("never fabricates the color sentence when the store carries no prior season", () => {
    const facts = buildPlayerFacts(baseInput());
    const text = renderTemplateCapsule(facts);
    expect(text).not.toContain("Last season he finished");
  });

  it("never states the props lines, the Vegas win total or the usage shares — the writer's own material, not the floor's", () => {
    const facts = buildPlayerFacts(
      baseInput({
        lastSeasonStory: LAST_SEASON_STORY_FIXTURE,
        booksNumbers: { propsLines: [{ market: "player_reception_yds", medianLine: 1150.5 }], teamVegasWinTotal: 9.5 },
        usage: {
          season: 2025,
          snapShare: 0.848,
          snapShareRank: null,
          targetShare: 0.263,
          targetShareRank: null,
          redZoneShare: 0.19,
          redZoneShareRank: null,
        },
      }),
    );
    const text = renderTemplateCapsule(facts);
    expect(text).not.toContain("1150.5");
    expect(text).not.toContain("Vegas");
    expect(text).not.toContain("snap share");
  });
});
