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

describe("the coaching line", () => {
  it("names both men, marks the new one, and grounds both names", () => {
    const facts = buildPlayerFacts(
      depthInput({
        ...EMPTY_DEPTH,
        coaching: { season: 2026, headCoach: "John Harbaugh", headCoachIsNew: true, playCaller: "Matt Nagy", playCallerRole: "OC", playCallerIsNew: true },
      }),
    );
    expect(renderDepthSection(facts)).toBe("The record:\n- Coaching for 2026: head coach John Harbaugh, new this year, offensive play caller Matt Nagy, new this year.");
    for (const name of ["John Harbaugh", "Harbaugh", "Matt Nagy", "Nagy"]) expect(facts.nameLedger).toContain(name);
  });

  it("makes no tenure claim at all when the table cannot tell", () => {
    const facts = buildPlayerFacts(
      depthInput({ ...EMPTY_DEPTH, coaching: { season: 2026, headCoach: null, headCoachIsNew: null, playCaller: "Kyle Shanahan", playCallerRole: "HC", playCallerIsNew: null } }),
    );
    const rendered = renderDepthSection(facts);
    expect(rendered).toBe("The record:\n- Coaching for 2026: head coach Kyle Shanahan, and he calls the plays himself.");
    expect(rendered!.includes("new this year")).toBe(false);
  });

  it("gives one man holding both jobs one clause rather than his name twice", () => {
    const facts = buildPlayerFacts(
      depthInput({ ...EMPTY_DEPTH, coaching: { season: 2026, headCoach: "Ben Johnson", headCoachIsNew: false, playCaller: "Ben Johnson", playCallerRole: "HC", playCallerIsNew: false } }),
    );
    expect(renderDepthSection(facts)).toBe("The record:\n- Coaching for 2026: head coach Ben Johnson, continuing from last season, and he calls the plays himself.");
  });

  it("renders no coaching line when the curated table covers nothing", () => {
    expect(renderDepthSection(buildPlayerFacts(depthInput({ ...EMPTY_DEPTH, coaching: null })))).toBeNull();
  });
});

describe("the pedigree line", () => {
  it("states age, experience, college and the whole draft, and grounds every number and the drafting club", () => {
    const facts = buildPlayerFacts(
      depthInput({
        ...EMPTY_DEPTH,
        pedigree: { ageOnOpeningDay: 25.2, college: "LSU", seasonsPlayed: 3, draftYear: 2023, draftRound: 1, draftPick: 22, draftClub: "NYG", undrafted: false },
      }),
    );
    expect(renderDepthSection(facts)).toBe("The record:\n- Age 25.2 on opening day, entering his fourth season, out of LSU, drafted in 2023 at round 1, pick 22 by NYG.");
    for (const value of [25.2, 3, 2023, 1, 22]) expect(facts.numberLedger).toContain(value);
    for (const name of ["NYG", "New York", "Giants"]) expect(facts.nameLedger).toContain(name);
  });

  it("drops each absent clause on its own rather than the whole line", () => {
    const facts = buildPlayerFacts(
      depthInput({ ...EMPTY_DEPTH, pedigree: { ageOnOpeningDay: 22.1, college: null, seasonsPlayed: 0, draftYear: null, draftRound: null, draftPick: null, draftClub: null, undrafted: null } }),
    );
    expect(renderDepthSection(facts)).toBe("The record:\n- Age 22.1 on opening day, entering his first season.");
  });

  it("says undrafted only where the archive said so", () => {
    const facts = buildPlayerFacts(
      depthInput({ ...EMPTY_DEPTH, pedigree: { ageOnOpeningDay: null, college: null, seasonsPlayed: null, draftYear: 2023, draftRound: null, draftPick: null, draftClub: null, undrafted: true } }),
    );
    expect(renderDepthSection(facts)).toBe("The record:\n- undrafted out of the 2023 class.");
  });

  it("renders no pedigree line when no field has a row behind it", () => {
    expect(renderDepthSection(buildPlayerFacts(depthInput({ ...EMPTY_DEPTH, pedigree: null })))).toBeNull();
  });
});

describe("the depth chart line", () => {
  it("dates the release, names his slot and grounds every neighbour", () => {
    const facts = buildPlayerFacts(
      depthInput({ ...EMPTY_DEPTH, depthChart: { season: 2026, asOf: "2026-09-01", slot: 1, aroundHim: [{ name: "Isaac Guerendo", slot: 2 }] } }),
    );
    expect(renderDepthSection(facts)).toBe("The record:\n- Depth chart as of 2026-09-01: listed first among SF RBs. Listed with him: Isaac Guerendo second.");
    for (const value of [2026, 9, 1]) expect(facts.numberLedger).toContain(value);
    expect(facts.nameLedger).toContain("Isaac Guerendo");
  });

  it("says the release lists nobody else rather than implying an empty room", () => {
    const facts = buildPlayerFacts(depthInput({ ...EMPTY_DEPTH, depthChart: { season: 2026, asOf: "2026-09-01", slot: 3, aroundHim: [] } }));
    expect(renderDepthSection(facts)).toContain("No other player at his position is listed on that release");
  });

  it("renders no depth chart line when the release never named him", () => {
    expect(renderDepthSection(buildPlayerFacts(depthInput({ ...EMPTY_DEPTH, depthChart: null })))).toBeNull();
  });
});

describe("the role trend and target competition lines", () => {
  it("names both windows and states both ends, and grounds every share and week", () => {
    const facts = buildPlayerFacts(
      depthInput({
        ...EMPTY_DEPTH,
        roleTrend: { season: 2025, earlyWeeks: [1, 2, 3, 4], lateWeeks: [14, 15, 16, 17], snapShare: { early: 0.41, late: 0.78 }, targetShare: null },
      }),
    );
    expect(renderDepthSection(facts)).toBe("The record:\n- Inside 2025, weeks 1 to 4 against weeks 14 to 17: snap share 41% to 78%.");
    for (const value of [2025, 1, 4, 14, 17, 0.41, 41, 0.78, 78]) expect(facts.numberLedger).toContain(value);
  });

  it("renders no role trend line when the season carried too few readings to split", () => {
    expect(renderDepthSection(buildPlayerFacts(depthInput({ ...EMPTY_DEPTH, roleTrend: null })))).toBeNull();
  });

  it("names the two biggest earners with their shares and grounds both names", () => {
    const facts = buildPlayerFacts(
      depthInput({
        ...EMPTY_DEPTH,
        targetCompetition: {
          season: 2025,
          team: "CIN",
          leaders: [
            { name: "Ja'Marr Chase", share: 0.3 },
            { name: "Tee Higgins", share: 0.22 },
          ],
          combinedShare: 0.52,
        },
      }),
    );
    expect(renderDepthSection(facts)).toBe("The record:\n- Target competition on CIN in 2025: Ja'Marr Chase took 30% and Tee Higgins took 22%, 52% between them.");
    for (const name of ["Ja'Marr Chase", "Higgins", "CIN", "Cincinnati", "Bengals"]) expect(facts.nameLedger).toContain(name);
    for (const value of [0.3, 30, 0.22, 22, 0.52, 52]) expect(facts.numberLedger).toContain(value);
  });

  it("renders no target competition line when the team had fewer than two real earners", () => {
    expect(renderDepthSection(buildPlayerFacts(depthInput({ ...EMPTY_DEPTH, targetCompetition: null })))).toBeNull();
  });
});

describe("the scoring-range usage line", () => {
  it("states counts with their honest qualifier counts and grounds every number and neighbour", () => {
    const facts = buildPlayerFacts(
      depthInput({
        ...EMPTY_DEPTH,
        scoringUsage: {
          season: 2025,
          redZoneTouches: { value: 36, positionRank: 1, qualifierCount: 48, namedNeighbor: null },
          insideTenTouches: { value: 14, positionRank: 2, qualifierCount: 48, namedNeighbor: "Bijan Robinson" },
          targetDepth: null,
        },
      }),
    );
    expect(renderDepthSection(facts)).toBe(
      "The record:\n- Scoring-range usage (2025): Red-zone touches 36, RB1 among 48 qualifying running backs, best at the position. Touches inside the ten 14, RB2 among 48 qualifying running backs, one spot behind Bijan Robinson.",
    );
    for (const value of [2025, 36, 1, 48, 14, 2]) expect(facts.numberLedger).toContain(value);
    expect(facts.nameLedger).toContain("Bijan Robinson");
  });

  it("drops a depth of target the play-by-play had no readable target for", () => {
    const facts = buildPlayerFacts(
      depthInput({ ...EMPTY_DEPTH, scoringUsage: { season: 2025, redZoneTouches: null, insideTenTouches: null, targetDepth: { value: 8.4, positionRank: 3, qualifierCount: 60, namedNeighbor: null } } }),
    );
    expect(renderDepthSection(facts)).toBe("The record:\n- Scoring-range usage (2025): Average depth of target 8.4 yards, RB3 among 60 qualifying running backs.");
  });

  it("renders no scoring-range line when the play-by-play never placed him", () => {
    expect(renderDepthSection(buildPlayerFacts(depthInput({ ...EMPTY_DEPTH, scoringUsage: null })))).toBeNull();
  });
});

describe("the team context line", () => {
  it("dates last season's shape and this season's opening price separately, and grounds both", () => {
    const facts = buildPlayerFacts(
      depthInput({
        ...EMPTY_DEPTH,
        teamContext: { priorSeason: 2025, paceSecondsPerPlay: 28.4, passRate: 0.581, wins: 11.5, weekOneImpliedTotal: 24.5, weekOneSpread: 3.5 },
      }),
    );
    expect(renderDepthSection(facts)).toBe(
      "The record:\n- SF in 2025: 28.4 seconds a play, 58% of situation-neutral plays passes, 11.5 wins. The books price their week one game at an implied 24.5 points and a spread of +3.5 in their favour.",
    );
    for (const value of [2025, 28.4, 0.581, 58, 11.5, 24.5, 3.5]) expect(facts.numberLedger).toContain(value);
  });

  it("prints only the half the store holds", () => {
    const facts = buildPlayerFacts(
      depthInput({ ...EMPTY_DEPTH, teamContext: { priorSeason: 2025, paceSecondsPerPlay: null, passRate: null, wins: null, weekOneImpliedTotal: 21.5, weekOneSpread: null } }),
    );
    expect(renderDepthSection(facts)).toBe("The record:\n- The books price their week one game at an implied 21.5 points.");
  });

  it("renders no team context line when neither store holds a row", () => {
    expect(renderDepthSection(buildPlayerFacts(depthInput({ ...EMPTY_DEPTH, teamContext: null })))).toBeNull();
  });
});

describe("the schedule line", () => {
  const schedule = {
    weekOneOpponent: { week: 1, opponent: "DAL", home: true },
    homeGames: 9,
    roadGames: 8,
    indoorGames: 2,
    playoffWeeks: [{ week: 15, opponent: "PHI", home: false }],
  } as const;

  it("names fixtures and counts with no strength judgment, and grounds every opponent spelling", () => {
    const facts = buildPlayerFacts(depthInput({ ...EMPTY_DEPTH, schedule }));
    expect(renderDepthSection(facts)).toBe(
      "The record:\n- Schedule: Opens at home against DAL in week 1. 9 home and 8 away on the published schedule, 2 of them indoors. Weeks 15 to 17: away at PHI in week 15.",
    );
    for (const name of ["DAL", "Dallas", "Cowboys", "PHI", "Philadelphia", "Eagles"]) expect(facts.nameLedger).toContain(name);
    for (const value of [9, 8, 2, 1, 15]) expect(facts.numberLedger).toContain(value);
  });

  it("says there is no roof reading rather than calling an unmeasured schedule outdoors", () => {
    const facts = buildPlayerFacts(depthInput({ ...EMPTY_DEPTH, schedule: { ...schedule, indoorGames: null } }));
    expect(renderDepthSection(facts)).toContain("with no roof reading on file");
  });

  it("renders no schedule line when the store holds no game for his team", () => {
    expect(renderDepthSection(buildPlayerFacts(depthInput({ ...EMPTY_DEPTH, schedule: null })))).toBeNull();
  });
});

describe("the market movement, volatility and career lines", () => {
  it("dates both ends of the market window and grounds every number", () => {
    const facts = buildPlayerFacts(
      depthInput({ ...EMPTY_DEPTH, marketMovement: { latestAdp: 13, latestAt: "2026-09-07", earlierAdp: 24, earlierAt: "2026-08-08", picks: 11 } }),
    );
    expect(renderDepthSection(facts)).toBe("The record:\n- The market has moved him up 11 picks, from 24 on 2026-08-08 to 13 on 2026-09-07.");
    for (const value of [13, 24, 11, 2026, 9, 7, 8]) expect(facts.numberLedger).toContain(value);
  });

  it("prints a fall by its size and grounds that size, not only the signed movement", () => {
    const facts = buildPlayerFacts(
      depthInput({ ...EMPTY_DEPTH, marketMovement: { latestAdp: 24.5, latestAt: "2026-09-07", earlierAdp: 13, earlierAt: "2026-08-08", picks: -11.5 } }),
    );
    expect(renderDepthSection(facts)).toBe("The record:\n- The market has moved him down 11.5 picks, from 13 on 2026-08-08 to 24.5 on 2026-09-07.");
    expect(facts.numberLedger).toContain(11.5);
  });

  it("renders no market movement line when the archive holds one capture", () => {
    expect(renderDepthSection(buildPlayerFacts(depthInput({ ...EMPTY_DEPTH, marketMovement: null })))).toBeNull();
  });

  it("prints the bar it counted against and names the worst week", () => {
    const facts = buildPlayerFacts(
      depthInput({ ...EMPTY_DEPTH, volatility: { season: 2025, weeksPlayed: 15, weeksAboveThreshold: 9, threshold: 15, worstWeek: { week: 2, points: 4.5 } } }),
    );
    expect(renderDepthSection(facts)).toBe("The record:\n- He cleared 15 points in 9 of his 15 played weeks in 2025, and his worst was 4.5 in week 2.");
    for (const value of [2025, 15, 9, 4.5, 2]) expect(facts.numberLedger).toContain(value);
  });

  it("lists only the seasons the store holds, and grounds each one's rank", () => {
    const facts = buildPlayerFacts(
      depthInput({
        ...EMPTY_DEPTH,
        priorSeasons: [
          { season: 2025, points: 248, gamesPlayed: 15, positionRank: 4, qualifierCount: 62 },
          { season: 2024, points: 190, gamesPlayed: 14, positionRank: 11, qualifierCount: 60 },
        ],
      }),
    );
    expect(renderDepthSection(facts)).toBe("The record:\n- Season by season: 2025, 248 points over 15 games, RB4 among 62. 2024, 190 points over 14 games, RB11 among 60.");
    for (const value of [248, 15, 4, 62, 190, 14, 11, 60]) expect(facts.numberLedger).toContain(value);
  });

  it("renders no career line when the store holds no prior season", () => {
    expect(renderDepthSection(buildPlayerFacts(depthInput({ ...EMPTY_DEPTH, priorSeasons: [], volatility: null })))).toBeNull();
  });
});
