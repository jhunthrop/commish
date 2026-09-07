import { describe, expect, it } from "vitest";
import { buildPlayerFacts, type PlayerFactsInput } from "./facts";
import { EMPTY_DEPTH, type PlayerFactsDepth } from "./facts/types";
import { renderDepthSection } from "./render-depth";
import { renderFactsForModel } from "./render";

/** The narrowest honest fact sheet: a board row, a projection, and nothing else. Every depth test
 *  below overrides exactly the one group it is about, so a line that appears for the wrong reason
 *  fails somebody else's test rather than hiding. */
export function depthInput(depth?: PlayerFactsDepth): PlayerFactsInput {
  return {
    ...(depth === undefined ? {} : { depth }),
    identity: { id: "p1", name: "Rashad Long", position: "RB", team: "SF" },
    productSeason: 2026,
    reasons: [],
    laws: [],
    market: { adp: null, positionAdp: null, boardRank: 14 },
    projection: { projectedPoints: 248, floorPoints: 178, medianPoints: 240, ceilingPoints: 275 },
    byeWeek: 9,
    season: null,
    injury: { state: "unknown" },
    news: [],
    lastSeasonStory: null,
    booksNumbers: { propsLines: [], teamVegasWinTotal: null },
    usage: null,
    trend: null,
  };
}

describe("renderDepthSection", () => {
  it("renders no section and no heading at all when the depth stores held nothing", () => {
    const facts = buildPlayerFacts(depthInput(EMPTY_DEPTH));
    expect(renderDepthSection(facts)).toBeNull();
    expect(renderFactsForModel(facts).includes("The record:")).toBe(false);
  });

  it("leaves an omitted depth group identical to an explicitly empty one", () => {
    expect(buildPlayerFacts(depthInput()).factsHash).toBe(buildPlayerFacts(depthInput(EMPTY_DEPTH)).factsHash);
  });
});

describe("the season-ending and games-missed lines", () => {
  const ending = {
    season: 2025,
    lastPlayedWeek: 4,
    firstMissedWeek: 5,
    source: "report",
    reportStatus: "Out",
    rosterStatus: null,
    primaryInjury: "Knee",
  } as const;

  it("states the season, both weeks and the report's own words, and grounds every number", () => {
    const facts = buildPlayerFacts(depthInput({ ...EMPTY_DEPTH, seasonEndings: [ending] }));
    expect(renderDepthSection(facts)).toBe("The record:\n- His 2025 season ended after week 4. From week 5 on, the injury report listed him Out, knee.");
    for (const value of [2025, 4, 5]) expect(facts.numberLedger).toContain(value);
  });

  it("says the roster listed him on reserve with no body part when the report was silent", () => {
    const facts = buildPlayerFacts(
      depthInput({ ...EMPTY_DEPTH, seasonEndings: [{ ...ending, source: "status", reportStatus: null, rosterStatus: "RES", primaryInjury: null }] }),
    );
    expect(renderDepthSection(facts)).toContain("the weekly roster listed him RES with no body part on file");
  });

  it("renders no season-ending line at all when nothing was derived", () => {
    expect(renderDepthSection(buildPlayerFacts(depthInput(EMPTY_DEPTH)))).toBeNull();
  });

  it("counts games missed against a stated denominator and grounds all three numbers", () => {
    const facts = buildPlayerFacts(depthInput({ ...EMPTY_DEPTH, gamesMissed: [{ season: 2025, missed: 13, teamGames: 17 }] }));
    expect(renderDepthSection(facts)).toBe("The record:\n- Games missed, counted over the weeks a roster actually carried him: 13 of a possible 17 in 2025.");
    for (const value of [2025, 13, 17]) expect(facts.numberLedger).toContain(value);
  });

  it("renders no games-missed line when the roster carried him in no season the store holds", () => {
    expect(renderDepthSection(buildPlayerFacts(depthInput({ ...EMPTY_DEPTH, gamesMissed: [] })))).toBeNull();
  });
});

describe("the injury designation history line", () => {
  it("states a run's two ends and its count, and a single capture as one date", () => {
    const facts = buildPlayerFacts(
      depthInput({
        ...EMPTY_DEPTH,
        injuryHistory: [
          { designation: "Q", description: "Hamstring", firstSeenAt: "2026-08-25", lastSeenAt: "2026-09-01", captureCount: 3 },
          { designation: "O", description: null, firstSeenAt: "2026-09-05", lastSeenAt: "2026-09-05", captureCount: 1 },
        ],
      }),
    );
    expect(renderDepthSection(facts)).toBe(
      "The record:\n- Injury designations captured this season, oldest first: Q from 2026-08-25 to 2026-09-01 across 3 captures, hamstring. O on 2026-09-05.",
    );
    for (const value of [3, 2026, 8, 25, 9, 1, 5]) expect(facts.numberLedger).toContain(value);
  });

  it("renders no line at all when no capture ever named him", () => {
    expect(renderDepthSection(buildPlayerFacts(depthInput({ ...EMPTY_DEPTH, injuryHistory: [] })))).toBeNull();
  });
});
