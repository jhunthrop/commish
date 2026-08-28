import { describe, expect, it } from "vitest";
import {
  AGE_BRACKETS,
  ROLE_BRACKETS,
  ageAtSeason,
  ageBracketFor,
  expectedGamesPlayed,
  gamesPlayedProbabilities,
  seventeenGamesForEveryone,
  teamGamesIn,
  type AvailabilityInput,
  type AvailabilityPriors,
} from "./availability";
import { FITTED_AVAILABILITY_PRIORS } from "./fitted";

/**
 * Availability is the cheapest large win in the preseason phase and the easiest to get subtly
 * wrong, so these tests pin the DIRECTIONS the model must move in rather than the numbers it
 * happens to produce. A test that asserted "a thirty-year-old back projects 13.4 games" would fail
 * every time the fit is re-run on a longer history and would tell nobody anything when it did.
 */

/** Deliberately flat priors, so a test asserting one input moved the answer is asserting only that. */
const FLAT_ROLE = { bench: 0.8, rotation: 0.8, committee: 0.8, featured: 0.8 } as const;
const FLAT_AGE = { under25: 1, "25to27": 1, "28to30": 1, over30: 1 } as const;
const FLAT: AvailabilityPriors = {
  baseline: { QB: FLAT_ROLE, RB: FLAT_ROLE, WR: FLAT_ROLE, TE: FLAT_ROLE, K: FLAT_ROLE, DEF: FLAT_ROLE },
  ageMultiplier: { QB: FLAT_AGE, RB: FLAT_AGE, WR: FLAT_AGE, TE: FLAT_AGE, K: FLAT_AGE, DEF: FLAT_AGE },
  statusMultiplier: { active: 1, reserve: 0.5, practice_squad: 0.3, off_roster: 0.1 },
  priorGames: 30,
  recencyDecay: 0.7,
  historySeasons: 3,
  concentration: 6,
  concentrationPerSeason: 2,
};

function player(overrides: Partial<AvailabilityInput> = {}): AvailabilityInput {
  return { position: "RB", age: 26, status: "active", projectedSnapShare: 0.6, history: [], baselineRate: null, ...overrides };
}

const at2024 = { season: 2024, priors: FITTED_AVAILABILITY_PRIORS } as const;

describe("teamGamesIn", () => {
  it("knows the season moved from sixteen games to seventeen in 2021", () => {
    expect(teamGamesIn(2020)).toBe(16);
    expect(teamGamesIn(2021)).toBe(17);
    expect(teamGamesIn(2024)).toBe(17);
  });
});

describe("ageAtSeason", () => {
  it("reads an age at the opener from an ISO birth date", () => {
    expect(ageAtSeason("1997-03-07", 2024)).toBeCloseTo(27.5, 1);
  });

  it("returns null rather than a number for a birth date the release does not carry", () => {
    expect(ageAtSeason(null, 2024)).toBeNull();
    expect(ageAtSeason("", 2024)).toBeNull();
    expect(ageAtSeason("not-a-date", 2024)).toBeNull();
  });
});

describe("ageBracketFor", () => {
  it("brackets an age, and puts an unknown one in the middle of a career rather than the young end", () => {
    expect(ageBracketFor(23)).toBe("under25");
    expect(ageBracketFor(26)).toBe("25to27");
    expect(ageBracketFor(29)).toBe("28to30");
    expect(ageBracketFor(33)).toBe("over30");
    expect(ageBracketFor(null)).toBe("25to27");
    expect(AGE_BRACKETS).toContain(ageBracketFor(null));
  });
});

describe("gamesPlayedProbabilities", () => {
  it("is a probability vector over every possible game count", () => {
    const probabilities = gamesPlayedProbabilities(17, 0.8, 8);
    expect(probabilities).toHaveLength(18);
    expect(probabilities.reduce((sum, value) => sum + value, 0)).toBeCloseTo(1, 10);
    for (const probability of probabilities) expect(probability).toBeGreaterThanOrEqual(0);
  });

  it("has the mean it was asked for", () => {
    const probabilities = gamesPlayedProbabilities(17, 0.75, 9);
    const mean = probabilities.reduce((sum, probability, games) => sum + probability * games, 0);
    expect(mean).toBeCloseTo(0.75 * 17, 6);
  });

  it("is wider at a lower concentration, which is the whole reason it is a beta-binomial", () => {
    const spread = (concentration: number): number => {
      const probabilities = gamesPlayedProbabilities(17, 0.8, concentration);
      const mean = probabilities.reduce((sum, p, games) => sum + p * games, 0);
      return Math.sqrt(probabilities.reduce((sum, p, games) => sum + p * (games - mean) ** 2, 0));
    };
    expect(spread(4)).toBeGreaterThan(spread(40));
  });

  it("refuses the inputs that would silently produce nonsense", () => {
    expect(() => gamesPlayedProbabilities(0, 0.8, 8)).toThrow(/whole number of games/);
    expect(() => gamesPlayedProbabilities(17, 1.4, 8)).toThrow(/share of a season/);
    expect(() => gamesPlayedProbabilities(17, 0.8, 0)).toThrow(/positive concentration/);
  });
});

describe("expectedGamesPlayed", () => {
  it("returns a distribution rather than a number, so a downstream floor is honest", () => {
    const outlook = expectedGamesPlayed(player(), at2024);
    expect(outlook.distribution.floor).toBeLessThan(outlook.distribution.median);
    expect(outlook.distribution.median).toBeLessThanOrEqual(outlook.distribution.ceiling);
    expect(outlook.probabilities).toHaveLength(18);
    expect(outlook.expected).toBeGreaterThan(0);
    expect(outlook.expected).toBeLessThan(17);
  });

  it("PINS THE PLAN'S CASE: a thirty-year-old back with two injured seasons projects fewer games than a twenty-four-year-old with none", () => {
    const veteran = expectedGamesPlayed(
      player({
        age: 30.5,
        history: [
          { season: 2023, gamesPlayed: 9, teamGames: 17 },
          { season: 2022, gamesPlayed: 8, teamGames: 17 },
          { season: 2021, gamesPlayed: 16, teamGames: 17 },
        ],
      }),
      at2024,
    );
    const young = expectedGamesPlayed(
      player({
        age: 24,
        history: [
          { season: 2023, gamesPlayed: 17, teamGames: 17 },
          { season: 2022, gamesPlayed: 17, teamGames: 17 },
        ],
      }),
      at2024,
    );
    expect(veteran.expected).toBeLessThan(young.expected);
    expect(veteran.distribution.floor).toBeLessThan(young.distribution.floor);
  });

  it("weighs position: on the fitted priors a featured back is available less than a featured receiver", () => {
    const featured = { age: 26, projectedSnapShare: 0.7 } as const;
    const back = expectedGamesPlayed(player({ position: "RB", ...featured }), at2024);
    const receiver = expectedGamesPlayed(player({ position: "WR", ...featured }), at2024);
    const end = expectedGamesPlayed(player({ position: "TE", ...featured }), at2024);
    expect(back.expected).toBeLessThan(receiver.expected);
    expect(back.expected).toBeLessThan(end.expected);
  });

  it("PINS THE ROLE TERM: a featured player projects more of the season than a bench body at the same position", () => {
    for (const position of ["QB", "RB", "WR", "TE"] as const) {
      const featured = expectedGamesPlayed(player({ position, projectedSnapShare: 0.85 }), at2024);
      const bench = expectedGamesPlayed(player({ position, projectedSnapShare: 0.02 }), at2024);
      expect(featured.expected).toBeGreaterThan(bench.expected);
    }
  });

  it("weighs age: the same back is available no more at thirty-two than at twenty-three", () => {
    const old = expectedGamesPlayed(player({ age: 32 }), at2024);
    const young = expectedGamesPlayed(player({ age: 23 }), at2024);
    expect(old.expected).toBeLessThanOrEqual(young.expected);
  });

  it("REGRESSES HARD: one lost season moves the projection by a fraction of the games it lost", () => {
    const clean = expectedGamesPlayed(player({ history: [{ season: 2023, gamesPlayed: 17, teamGames: 17 }] }), at2024);
    const hurt = expectedGamesPlayed(player({ history: [{ season: 2023, gamesPlayed: 5, teamGames: 17 }] }), at2024);
    const moved = clean.expected - hurt.expected;
    expect(moved).toBeGreaterThan(0);
    // Twelve games of difference in the record must not become twelve games of difference in the
    // projection. Half of it would already be treating one season as destiny.
    expect(moved).toBeLessThan(6);
  });

  it("weighs a recent season more than an old one", () => {
    const recentlyHurt = expectedGamesPlayed(
      player({
        history: [
          { season: 2023, gamesPlayed: 6, teamGames: 17 },
          { season: 2022, gamesPlayed: 17, teamGames: 17 },
        ],
      }),
      at2024,
    );
    const oldInjury = expectedGamesPlayed(
      player({
        history: [
          { season: 2023, gamesPlayed: 17, teamGames: 17 },
          { season: 2022, gamesPlayed: 6, teamGames: 17 },
        ],
      }),
      at2024,
    );
    expect(recentlyHurt.expected).toBeLessThan(oldInjury.expected);
  });

  it("cuts a man the league filed on a reserve list, and cuts a man nobody rostered further", () => {
    const active = expectedGamesPlayed(player({ status: "active" }), at2024);
    const reserve = expectedGamesPlayed(player({ status: "reserve" }), at2024);
    const off = expectedGamesPlayed(player({ status: "off_roster" }), at2024);
    expect(reserve.expected).toBeLessThan(active.expected);
    expect(off.expected).toBeLessThan(reserve.expected);
  });

  it("is WIDER for a player with no record than for one with three seasons, at the same mean", () => {
    const spreadOf = (input: AvailabilityInput): number => {
      const { probabilities, expected } = expectedGamesPlayed(input, { season: 2024, priors: FLAT });
      return Math.sqrt(probabilities.reduce((sum, p, games) => sum + p * (games - expected) ** 2, 0));
    };
    // Both land on the flat baseline exactly: the veteran's record says precisely what the baseline
    // says, so the only difference between the two is how much is known about him.
    const known = spreadOf(
      player({
        history: [
          { season: 2023, gamesPlayed: 13.6, teamGames: 17 },
          { season: 2022, gamesPlayed: 13.6, teamGames: 17 },
          { season: 2021, gamesPlayed: 13.6, teamGames: 17 },
        ],
      }),
    );
    const unknown = spreadOf(player({ history: [] }));
    expect(unknown).toBeGreaterThan(known);
  });

  it("reads only as many prior seasons as the priors allow", () => {
    const withinWindow = player({
      history: [
        { season: 2023, gamesPlayed: 17, teamGames: 17 },
        { season: 2022, gamesPlayed: 17, teamGames: 17 },
        { season: 2021, gamesPlayed: 17, teamGames: 17 },
      ],
    });
    const plusAncientHistory = player({
      history: [...withinWindow.history, { season: 2018, gamesPlayed: 0, teamGames: 16 }],
    });
    expect(expectedGamesPlayed(plusAncientHistory, { season: 2024, priors: FLAT }).expected).toBeCloseTo(
      expectedGamesPlayed(withinWindow, { season: 2024, priors: FLAT }).expected,
      10,
    );
  });
});

describe("seventeenGamesForEveryone", () => {
  it("is what a board with no availability model believes, and has no spread at all", () => {
    const outlook = seventeenGamesForEveryone(2024);
    expect(outlook.expected).toBe(17);
    expect(outlook.rate).toBe(1);
    expect(outlook.distribution).toEqual({ floor: 17, median: 17, ceiling: 17 });
  });
});

describe("the committed fit", () => {
  it("regresses hard enough that a single season cannot dominate a career", () => {
    expect(FITTED_AVAILABILITY_PRIORS.priorGames).toBeGreaterThan(teamGamesIn(2024));
  });

  it("holds a baseline for every position this engine projects, in every role bracket", () => {
    for (const position of ["QB", "RB", "WR", "TE"] as const) {
      for (const bracket of ROLE_BRACKETS) {
        const value = FITTED_AVAILABILITY_PRIORS.baseline[position][bracket];
        expect(value).toBeGreaterThan(0);
        expect(value).toBeLessThanOrEqual(1);
      }
      for (const bracket of AGE_BRACKETS) {
        expect(FITTED_AVAILABILITY_PRIORS.ageMultiplier[position][bracket]).toBeGreaterThan(0);
      }
    }
  });

  it("never rates a smaller role as more of a season, which a thin cell could otherwise say", () => {
    for (const position of ["QB", "RB", "WR", "TE"] as const) {
      const cells = ROLE_BRACKETS.map((bracket) => FITTED_AVAILABILITY_PRIORS.baseline[position][bracket]);
      for (let index = 1; index < cells.length; index += 1) {
        expect(cells[index]!).toBeGreaterThanOrEqual(cells[index - 1]!);
      }
    }
  });

  it("PROJECTS A FULL-TIME STARTER LIKE A STARTER, which is the defect the role table exists to fix", () => {
    const cleanRecord = [2023, 2022, 2021].map((season) => ({ season, gamesPlayed: 17, teamGames: 17 }));
    for (const position of ["QB", "RB", "WR", "TE"] as const) {
      const outlook = expectedGamesPlayed(
        player({ position, projectedSnapShare: 0.8, history: cleanRecord }),
        at2024,
      );
      // Twelve, not seventeen: this model regresses hard on purpose. The bar is that a man who has
      // played every game for three years is not projected like the third quarterback on a roster.
      expect(outlook.expected).toBeGreaterThan(12);
    }
  });

  it("never rates a reserve or an unrostered man above an active one", () => {
    const { statusMultiplier } = FITTED_AVAILABILITY_PRIORS;
    expect(statusMultiplier.active).toBe(1);
    expect(statusMultiplier.reserve).toBeLessThan(1);
    expect(statusMultiplier.practice_squad).toBeLessThan(1);
    expect(statusMultiplier.off_roster).toBeLessThan(statusMultiplier.practice_squad);
  });
});
