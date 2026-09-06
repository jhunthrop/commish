import { describe, expect, it } from "vitest";
import { PPR_SCORING } from "@/domain/scoring";
import { computeFantasyPoints, roundPoints } from "@/scoring/compute";
import type { KickingWeekRow } from "../nflverse/kicking-weeks";
import { fitKickerPriors, kickerCandidate, kickerSeasonsFrom, kickerWeeklyPoints, type KickerPriors, type KickerSeason } from "./kicker";

function week(overrides: Partial<KickingWeekRow>): KickingWeekRow {
  return {
    season: 2020, week: 1, playerId: "k1", team: "SF",
    fieldGoalsMade: 0, fieldGoalsAttempted: 0, fieldGoalsMissed: 0, fieldGoalsBlocked: 0,
    fieldGoalsMade0To19: 0, fieldGoalsMade20To29: 0, fieldGoalsMade30To39: 0,
    fieldGoalsMade40To49: 0, fieldGoalsMade50To59: 0, fieldGoalsMade60Plus: 0,
    fieldGoalsMissed0To19: 0, fieldGoalsMissed20To29: 0, fieldGoalsMissed30To39: 0,
    fieldGoalsMissed40To49: 0, fieldGoalsMissed50To59: 0, fieldGoalsMissed60Plus: 0,
    extraPointsMade: 0, extraPointsAttempted: 0, extraPointsMissed: 0, extraPointsBlocked: 0,
    ...overrides,
  };
}

function season(overrides: Partial<KickerSeason>): KickerSeason {
  return {
    season: 2020, playerId: "k1", team: "SF", games: 16, teamGames: 16,
    fieldGoalsAttempted: 32, fieldGoalsMade: 28, extraPointsAttempted: 40, extraPointsMade: 39,
    ...overrides,
  };
}

const PRIORS: KickerPriors = {
  leagueFieldGoalAttemptsPerGame: 2,
  leagueExtraPointAttemptsPerGame: 2.5,
  leagueFieldGoalMakeRate: 0.85,
  leagueExtraPointMakeRate: 0.95,
  leagueGamesRate: 0.95,
  teamPriorGames: 16,
  kickerPriorFieldGoalAttempts: 30,
  kickerPriorExtraPointAttempts: 30,
  kickerPriorGames: 16,
  recencyDecay: 0.8,
};

describe("kickerSeasonsFrom", () => {
  it("counts one game per week the kicker has a row and sums his components", () => {
    expect(
      kickerSeasonsFrom([
        week({ week: 1, fieldGoalsAttempted: 3, fieldGoalsMade: 2, extraPointsAttempted: 2, extraPointsMade: 2 }),
        week({ week: 2, fieldGoalsAttempted: 1, fieldGoalsMade: 1, extraPointsAttempted: 4, extraPointsMade: 3 }),
      ]),
    ).toEqual([
      {
        season: 2020, playerId: "k1", team: "SF", games: 2, teamGames: 16,
        fieldGoalsAttempted: 4, fieldGoalsMade: 3, extraPointsAttempted: 6, extraPointsMade: 5,
      },
    ]);
  });

  it("knows a season played seventeen games from one played sixteen", () => {
    expect(kickerSeasonsFrom([week({ season: 2020 })])[0]?.teamGames).toBe(16);
    expect(kickerSeasonsFrom([week({ season: 2021 })])[0]?.teamGames).toBe(17);
  });

  it("attributes the season to the club he kicked the most weeks for", () => {
    const seasons = kickerSeasonsFrom([
      week({ week: 1, team: "SF" }),
      week({ week: 2, team: "DEN" }),
      week({ week: 3, team: "DEN" }),
    ]);
    expect(seasons[0]?.team).toBe("DEN");
  });

  it("breaks a tie on the alphabetically first code, so the fold is deterministic", () => {
    const seasons = kickerSeasonsFrom([week({ week: 1, team: "SF" }), week({ week: 2, team: "DEN" })]);
    expect(seasons[0]?.team).toBe("DEN");
  });

  it("keeps one season per kicker, in season and then player order", () => {
    const seasons = kickerSeasonsFrom([
      week({ season: 2021, playerId: "k2" }),
      week({ season: 2020, playerId: "k2" }),
      week({ season: 2020, playerId: "k1" }),
    ]);
    expect(seasons.map((s) => [s.season, s.playerId])).toEqual([[2020, "k1"], [2020, "k2"], [2021, "k2"]]);
  });
});

describe("fitKickerPriors", () => {
  const fitSeasons = [
    season({ season: 2013 }),
    season({ season: 2014 }),
    season({ season: 2015, playerId: "k2", team: "DEN" }),
  ];

  it("refuses a held-out season rather than filtering it out quietly", () => {
    expect(() => fitKickerPriors([...fitSeasons, season({ season: 2025 })], { heldOutSeasons: [2025] })).toThrow(/2025/);
  });

  it("refuses an empty sample rather than asserting a league mean from nothing", () => {
    expect(() => fitKickerPriors([], { heldOutSeasons: [2025] })).toThrow(/no kicker seasons/i);
  });

  it("measures the league means directly off the fit seasons", () => {
    const priors = fitKickerPriors(fitSeasons, { heldOutSeasons: [2025] });
    expect(priors.leagueFieldGoalMakeRate).toBeCloseTo(28 / 32, 10);
    expect(priors.leagueExtraPointMakeRate).toBeCloseTo(39 / 40, 10);
    expect(priors.leagueFieldGoalAttemptsPerGame).toBeCloseTo(2, 10);
    expect(priors.leagueExtraPointAttemptsPerGame).toBeCloseTo(2.5, 10);
    expect(priors.leagueGamesRate).toBeCloseTo(1, 10);
  });

  it("returns a recency decay from its own grid and positive prior counts", () => {
    const priors = fitKickerPriors(fitSeasons, { heldOutSeasons: [2025], recencyDecayGrid: [0.7] });
    expect(priors.recencyDecay).toBe(0.7);
    expect(priors.kickerPriorFieldGoalAttempts).toBeGreaterThan(0);
    expect(priors.kickerPriorExtraPointAttempts).toBeGreaterThan(0);
    expect(priors.teamPriorGames).toBeGreaterThan(0);
    expect(priors.kickerPriorGames).toBeGreaterThan(0);
  });

  it("picks the decay that predicts a next season best, over the grid it was given", () => {
    // One kicker whose volume jumps and then holds: the most recent season is the informative one,
    // so a decay that discounts the distant past should win over one that weights it equally.
    const jumpy = [
      season({ season: 2013, fieldGoalsAttempted: 16, fieldGoalsMade: 14 }),
      season({ season: 2014, fieldGoalsAttempted: 48, fieldGoalsMade: 42 }),
      season({ season: 2015, fieldGoalsAttempted: 48, fieldGoalsMade: 42 }),
    ];
    expect(fitKickerPriors(jumpy, { heldOutSeasons: [2025], recencyDecayGrid: [0.2, 1] }).recencyDecay).toBe(0.2);
  });
});

describe("kickerCandidate", () => {
  it("gives a kicker with no history the league rates and says so on the row", () => {
    const candidate = kickerCandidate({ playerId: "rookie", team: "SF", season: 2025, ownHistory: [], teamHistory: [] }, PRIORS);
    expect(candidate.position).toBe("K");
    expect(candidate.playerId).toBe("rookie");
    expect(candidate.perGame.fieldGoalsMade).toBeCloseTo(2 * 0.85, 10);
    expect(candidate.perGame.fieldGoalsMissed).toBeCloseTo(2 * 0.15, 10);
    expect(candidate.perGame.extraPointsMade).toBeCloseTo(2.5 * 0.95, 10);
    expect(candidate.perGame.extraPointsMissed).toBeCloseTo(2.5 * 0.05, 10);
    expect(candidate.games.expected).toBeCloseTo(17 * 0.95, 10);
    expect(candidate.reasons).toContainEqual({ code: "kicker_no_history" });
  });

  it("moves the make rate toward a kicker's own record as his sample grows", () => {
    const rateOf = (ownHistory: readonly KickerSeason[]): number => {
      const candidate = kickerCandidate({ playerId: "k1", team: "SF", season: 2025, ownHistory, teamHistory: [] }, PRIORS);
      const attempts = candidate.perGame.fieldGoalsMade + (candidate.perGame.fieldGoalsMissed ?? 0);
      return candidate.perGame.fieldGoalsMade / attempts;
    };
    const thin = rateOf([season({ season: 2024, fieldGoalsAttempted: 5, fieldGoalsMade: 5 })]);
    const thick = rateOf([season({ season: 2024, fieldGoalsAttempted: 300, fieldGoalsMade: 300 })]);
    expect(thin).toBeGreaterThan(PRIORS.leagueFieldGoalMakeRate);
    expect(thick).toBeGreaterThan(thin);
    expect(thick).toBeLessThan(1);
  });

  it("takes attempts from the club and make rates from the kicker", () => {
    const candidate = kickerCandidate(
      {
        playerId: "k1", team: "SF", season: 2025,
        ownHistory: [season({ season: 2024, team: "DEN", games: 17, teamGames: 17, fieldGoalsAttempted: 300, fieldGoalsMade: 300 })],
        teamHistory: [season({ season: 2024, playerId: "other", team: "SF", games: 17, teamGames: 17, fieldGoalsAttempted: 170, fieldGoalsMade: 85 })],
      },
      PRIORS,
    );
    const attempts = candidate.perGame.fieldGoalsMade + (candidate.perGame.fieldGoalsMissed ?? 0);
    // His new club attempts far more than the league, so his volume rises above the league mean.
    expect(attempts).toBeGreaterThan(PRIORS.leagueFieldGoalAttemptsPerGame);
    // His own record is perfect, so his rate rises above the league mean, and NOT toward the
    // club's own dismal 50 percent, which belongs to a different man.
    expect(candidate.perGame.fieldGoalsMade / attempts).toBeGreaterThan(PRIORS.leagueFieldGoalMakeRate);
  });

  it("carries no points allowed, no yards allowed and no tier points", () => {
    const candidate = kickerCandidate({ playerId: "k1", team: "SF", season: 2025, ownHistory: [], teamHistory: [] }, PRIORS);
    expect(candidate.perGame.pointsAllowed).toBeUndefined();
    expect(candidate.perGame.yardsAllowed).toBeUndefined();
    expect(candidate.perGameTierPoints).toBeUndefined();
  });

  it("says on the row what the projection was built from", () => {
    const candidate = kickerCandidate({ playerId: "k1", team: "SF", season: 2025, ownHistory: [season({ season: 2024 })], teamHistory: [] }, PRIORS);
    expect(candidate.reasons).not.toContainEqual({ code: "kicker_no_history" });
    const opportunity = candidate.reasons.find((reason) => reason.code === "kicker_opportunity");
    expect(opportunity).toBeDefined();
  });

  it("scores under the league's own rules and nothing else", () => {
    const candidate = kickerCandidate({ playerId: "k1", team: "SF", season: 2025, ownHistory: [], teamHistory: [] }, PRIORS);
    const expected =
      2 * 0.85 * PPR_SCORING.pointsPerFieldGoal +
      2 * 0.15 * PPR_SCORING.pointsPerFieldGoalMissed +
      2.5 * 0.95 * PPR_SCORING.pointsPerExtraPoint +
      2.5 * 0.05 * PPR_SCORING.pointsPerExtraPointMissed;
    expect(computeFantasyPoints(candidate.perGame, "K", PPR_SCORING)).toBeCloseTo(roundPoints(expected), 6);
  });

  it("gives a games distribution that sums to one and peaks near the expectation", () => {
    const candidate = kickerCandidate({ playerId: "k1", team: "SF", season: 2025, ownHistory: [], teamHistory: [] }, PRIORS);
    const total = candidate.games.probabilities.reduce((sum, probability) => sum + probability, 0);
    expect(total).toBeCloseTo(1, 10);
    expect(candidate.games.distribution.floor).toBeLessThanOrEqual(candidate.games.distribution.median);
    expect(candidate.games.distribution.median).toBeLessThanOrEqual(candidate.games.distribution.ceiling);
  });
});

describe("kickerWeeklyPoints", () => {
  it("gives each kicker-season its own weekly points under the rules it was handed", () => {
    const byKey = kickerWeeklyPoints(
      [
        week({ week: 1, fieldGoalsMade: 2, fieldGoalsMissed: 0, extraPointsMade: 1, extraPointsMissed: 0 }),
        week({ week: 2, fieldGoalsMade: 0, fieldGoalsMissed: 1, extraPointsMade: 3, extraPointsMissed: 0 }),
      ],
      PPR_SCORING,
    );
    expect([...byKey.keys()]).toEqual(["2020|k1"]);
    expect(byKey.get("2020|k1")).toEqual([
      roundPoints(2 * PPR_SCORING.pointsPerFieldGoal + 1 * PPR_SCORING.pointsPerExtraPoint),
      roundPoints(1 * PPR_SCORING.pointsPerFieldGoalMissed + 3 * PPR_SCORING.pointsPerExtraPoint),
    ]);
  });
});
