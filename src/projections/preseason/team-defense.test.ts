import { describe, expect, it } from "vitest";
import { STAT_FIELDS, type StatLine } from "@/domain/player";
import { PPR_SCORING } from "@/domain/scoring";
import { computeFantasyPoints } from "@/scoring/compute";
import type { TeamDefenseWeekRow } from "../nflverse/team-defense-weeks";
import {
  defenseCandidate,
  defenseGamesFrom,
  defenseWeeklyPoints,
  expectedTierPoints,
  fitDefensePriors,
  type DefenseGame,
  type DefensePriors,
} from "./team-defense";

function game(overrides: Partial<DefenseGame>): DefenseGame {
  return {
    season: 2024, week: 1, team: "SF",
    sacks: 2, interceptions: 1, fumbleRecoveries: 0, defensiveTouchdowns: 0, safeties: 0,
    pointsAllowed: 20, yardsAllowed: 330,
    ...overrides,
  };
}

function archived(overrides: Partial<TeamDefenseWeekRow>): TeamDefenseWeekRow {
  return {
    season: 2024, week: 1, team: "SF", opponentTeam: "SEA",
    sacks: 2, interceptions: 1, fumbleRecoveries: 0, defensiveTouchdowns: 0, safeties: 0,
    puntBlocks: 0, extraPointBlocks: 0, fieldGoalBlocks: 0, specialTeamsTouchdowns: 0,
    passingYardsAllowed: 200, rushingYardsAllowed: 130,
    ...overrides,
  };
}

/** One game's tier points, computed through the SAME `computeFantasyPoints` the module uses, so the
 *  tier tables have exactly one spelling in this repository. */
function tierValue(pointsAllowed: number, yardsAllowed: number): number {
  const line: StatLine = {
    playerId: "d", week: 1,
    ...(Object.fromEntries(STAT_FIELDS.map((field) => [field, 0])) as Omit<StatLine, "playerId" | "week">),
    pointsAllowed,
    yardsAllowed,
  };
  return computeFantasyPoints(line, "DEF", PPR_SCORING);
}

const PRIORS: DefensePriors = {
  leaguePerGame: { sacks: 2.3, interceptions: 0.7, fumbleRecoveries: 0.5, defensiveTouchdowns: 0.1, safeties: 0.03 },
  leagueAllowed: [{ pointsAllowed: 22, yardsAllowed: 340 }],
  teamPriorGames: 16,
  tierPriorGames: 16,
  recencyDecay: 0.8,
};

describe("defenseGamesFrom", () => {
  it("joins each archived row to the points its opponent scored and sums the two yardage halves", () => {
    const games = defenseGamesFrom([archived({})], new Map([["2024|1|SF", 17]]));
    expect(games).toEqual([
      {
        season: 2024, week: 1, team: "SF",
        sacks: 2, interceptions: 1, fumbleRecoveries: 0, defensiveTouchdowns: 0, safeties: 0,
        pointsAllowed: 17, yardsAllowed: 330,
      },
    ]);
  });

  it("drops a row whose points allowed the store cannot supply, rather than inventing a shutout", () => {
    expect(defenseGamesFrom([archived({})], new Map())).toEqual([]);
  });

  it("returns season, week, team order", () => {
    const scores = new Map([
      ["2024|1|SF", 10], ["2024|1|SEA", 20], ["2024|2|SF", 30],
    ]);
    const games = defenseGamesFrom(
      [
        archived({ week: 2, team: "SF" }),
        archived({ week: 1, team: "SEA", opponentTeam: "SF" }),
        archived({ week: 1, team: "SF" }),
      ],
      scores,
    );
    expect(games.map((entry) => [entry.week, entry.team])).toEqual([[1, "SEA"], [1, "SF"], [2, "SF"]]);
  });
});

describe("expectedTierPoints", () => {
  it("averages the tier function rather than tiering the average", () => {
    // 13 allowed and 27 allowed sit in different brackets; their mean, 20, sits in a third. This is
    // the distinction the spec names, asserted on the real tables rather than on a stand-in.
    expect(tierValue(13, 300)).not.toBe(tierValue(27, 300));
    const meanOfTiers = (tierValue(13, 300) + tierValue(27, 300)) / 2;
    const tierOfMean = tierValue(20, 300);
    expect(meanOfTiers).not.toBeCloseTo(tierOfMean, 6);

    const own = [
      game({ week: 1, pointsAllowed: 13, yardsAllowed: 300 }),
      game({ week: 2, pointsAllowed: 27, yardsAllowed: 300 }),
    ];
    // With no shrinkage at all the answer is exactly the mean of the tiers.
    expect(expectedTierPoints(own, { ...PRIORS, tierPriorGames: 0, recencyDecay: 1 }, PPR_SCORING))
      .toBeCloseTo(meanOfTiers, 6);
  });

  it("shrinks a thin sample toward the league's own distribution", () => {
    const own = [game({ pointsAllowed: 0, yardsAllowed: 100 })];
    const league = expectedTierPoints([], PRIORS, PPR_SCORING);
    const unshrunk = expectedTierPoints(own, { ...PRIORS, tierPriorGames: 0 }, PPR_SCORING);
    const shrunk = expectedTierPoints(own, PRIORS, PPR_SCORING);
    expect(unshrunk).toBeGreaterThan(shrunk);
    expect(shrunk).toBeGreaterThan(league);
  });

  it("gives a club with no history the league's own expectation", () => {
    expect(expectedTierPoints([], PRIORS, PPR_SCORING)).toBeCloseTo(tierValue(22, 340), 6);
  });

  it("weights a club's recent seasons more heavily than its distant ones", () => {
    const improving = [
      game({ season: 2023, week: 1, pointsAllowed: 34, yardsAllowed: 450 }),
      game({ season: 2024, week: 1, pointsAllowed: 6, yardsAllowed: 200 }),
    ];
    const steep = expectedTierPoints(improving, { ...PRIORS, tierPriorGames: 0, recencyDecay: 0.1 }, PPR_SCORING);
    const flat = expectedTierPoints(improving, { ...PRIORS, tierPriorGames: 0, recencyDecay: 1 }, PPR_SCORING);
    expect(steep).toBeGreaterThan(flat);
  });
});

describe("fitDefensePriors", () => {
  it("refuses a held-out season rather than filtering it out quietly", () => {
    expect(() => fitDefensePriors([game({ season: 2025 })], { heldOutSeasons: [2025] })).toThrow(/2025/);
  });

  it("refuses an empty sample rather than asserting a league mean from nothing", () => {
    expect(() => fitDefensePriors([], { heldOutSeasons: [2025] })).toThrow(/no defence games/i);
  });

  it("measures the league per-game rates directly and keeps the whole allowed distribution", () => {
    const priors = fitDefensePriors(
      [game({ week: 1, sacks: 1, pointsAllowed: 10 }), game({ week: 2, sacks: 3, pointsAllowed: 30 })],
      { heldOutSeasons: [2025] },
    );
    expect(priors.leaguePerGame.sacks).toBeCloseTo(2, 10);
    expect(priors.leaguePerGame.interceptions).toBeCloseTo(1, 10);
    // The whole vector, not its mean: a distribution shrinkage needs the games themselves.
    expect(priors.leagueAllowed.map((entry) => entry.pointsAllowed).sort((a, b) => a - b)).toEqual([10, 30]);
  });

  it("returns a recency decay from its own grid", () => {
    const priors = fitDefensePriors([game({ season: 2013 }), game({ season: 2014, week: 2 })], {
      heldOutSeasons: [2025],
      recencyDecayGrid: [0.65],
    });
    expect(priors.recencyDecay).toBe(0.65);
  });
});

describe("defenseCandidate", () => {
  it("is a DEF candidate on the synthetic universe id, playing every game its club plays", () => {
    const candidate = defenseCandidate({ team: "SF", season: 2025, history: [] }, PRIORS, PPR_SCORING);
    expect(candidate.position).toBe("DEF");
    expect(candidate.playerId).toBe("team-def:SF");
    expect(candidate.team).toBe("SF");
    expect(candidate.games.expected).toBe(17);
    expect(candidate.games.probabilities[17]).toBe(1);
    expect(candidate.games.distribution).toEqual({ floor: 17, median: 17, ceiling: 17 });
  });

  it("knows a seventeen-game season from a sixteen-game one", () => {
    expect(defenseCandidate({ team: "SF", season: 2019, history: [] }, PRIORS, PPR_SCORING).games.expected).toBe(16);
  });

  it("puts the linear components on the line and the nonlinear ones on the tier field", () => {
    const candidate = defenseCandidate({ team: "SF", season: 2025, history: [] }, PRIORS, PPR_SCORING);
    expect(candidate.perGame.sacks).toBeCloseTo(2.3, 10);
    expect(candidate.perGame.defensiveInterceptions).toBeCloseTo(0.7, 10);
    expect(candidate.perGame.defensiveFumblesRecovered).toBeCloseTo(0.5, 10);
    expect(candidate.perGame.defensiveTouchdowns).toBeCloseTo(0.1, 10);
    expect(candidate.perGame.safeties).toBeCloseTo(0.03, 10);
    expect(candidate.perGame.pointsAllowed).toBeUndefined();
    expect(candidate.perGame.yardsAllowed).toBeUndefined();
    expect(candidate.perGameTierPoints).toBeCloseTo(tierValue(22, 340), 6);
  });

  it("moves a club's rates toward its own record as its sample grows", () => {
    const oneGame = defenseCandidate(
      { team: "SF", season: 2025, history: [game({ sacks: 8 })] },
      PRIORS,
      PPR_SCORING,
    );
    const manyGames = defenseCandidate(
      {
        team: "SF", season: 2025,
        history: Array.from({ length: 60 }, (_, index) => game({ week: (index % 17) + 1, season: 2023 + Math.floor(index / 17), sacks: 8 })),
      },
      PRIORS,
      PPR_SCORING,
    );
    expect(oneGame.perGame.sacks).toBeGreaterThan(PRIORS.leaguePerGame.sacks);
    expect(manyGames.perGame.sacks).toBeGreaterThan(oneGame.perGame.sacks);
    expect(manyGames.perGame.sacks).toBeLessThan(8);
  });

  it("says on the row what the projection was built from", () => {
    const empty = defenseCandidate({ team: "SF", season: 2025, history: [] }, PRIORS, PPR_SCORING);
    expect(empty.reasons).toContainEqual({ code: "defense_no_history" });
    const withHistory = defenseCandidate({ team: "SF", season: 2025, history: [game({})] }, PRIORS, PPR_SCORING);
    expect(withHistory.reasons).not.toContainEqual({ code: "defense_no_history" });
    expect(withHistory.reasons.some((reason) => reason.code === "defense_takeaways")).toBe(true);
  });
});

describe("defenseWeeklyPoints", () => {
  it("gives each club-season its own weekly points, tiers included", () => {
    const byKey = defenseWeeklyPoints(
      [game({ week: 1, sacks: 2, interceptions: 1, pointsAllowed: 10, yardsAllowed: 250 })],
      PPR_SCORING,
    );
    expect([...byKey.keys()]).toEqual(["2024|SF"]);
    const expected =
      2 * PPR_SCORING.pointsPerSack +
      1 * PPR_SCORING.pointsPerDefensiveInterception +
      tierValue(10, 250);
    expect(byKey.get("2024|SF")?.[0]).toBeCloseTo(expected, 6);
  });
});
