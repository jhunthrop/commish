import { describe, expect, it } from "vitest";
import {
  AGE_BRACKETS,
  ROLE_BRACKETS,
  ageAtSeason,
  ageBracketFor,
  availabilityEvidence,
  expectedGamesPlayed,
  gamesPlayedProbabilities,
  seventeenGamesForEveryone,
  teamGamesIn,
  withAvailabilityRecency,
  shrunkAvailability,
  shrunkAvailabilityRate,
  shrunkRole,
  statusMultiplierFor,
  type AvailabilityInput,
  type AvailabilityPriors,
  type SeasonAvailability,
} from "./availability";
import { AGE_MULTIPLIER_BOUND } from "./availability-fit";
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
const FLAT_AVAILABILITY = 0.9;
const FLAT: AvailabilityPriors = {
  baseline: { QB: FLAT_ROLE, RB: FLAT_ROLE, WR: FLAT_ROLE, TE: FLAT_ROLE, K: FLAT_ROLE, DEF: FLAT_ROLE },
  availabilityBaseline: { QB: FLAT_AVAILABILITY, RB: FLAT_AVAILABILITY, WR: FLAT_AVAILABILITY, TE: FLAT_AVAILABILITY, K: FLAT_AVAILABILITY, DEF: FLAT_AVAILABILITY },
  ageMultiplier: { QB: FLAT_AGE, RB: FLAT_AGE, WR: FLAT_AGE, TE: FLAT_AGE, K: FLAT_AGE, DEF: FLAT_AGE },
  statusMultiplier: { active: 1, reserve: 0.5, practice_squad: 0.3, off_roster: 0.1 },
  priorGames: 30,
  availabilityPriorGames: 60,
  recencyDecay: 0.7,
  historySeasons: 3,
  concentration: 6,
  concentrationPerSeason: 2,
};

function player(overrides: Partial<AvailabilityInput> = {}): AvailabilityInput {
  return { position: "RB", age: 26, status: "active", designation: null, projectedSnapShare: 0.6, history: [], baselineRate: null, ...overrides };
}

/** A season in which every unplayed game was an absence the store recorded: the record the old
 *  "team games minus games played" reading assumed for everybody. */
function absent(season: number, gamesPlayed: number, teamGames: number): SeasonAvailability {
  return { season, gamesPlayed, teamGames, gamesUnavailable: Math.max(0, teamGames - gamesPlayed), gamesSuspended: 0 };
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
          absent(2023, 9, 17),
          absent(2022, 8, 17),
          absent(2021, 16, 17),
        ],
      }),
      at2024,
    );
    const young = expectedGamesPlayed(
      player({
        age: 24,
        history: [
          absent(2023, 17, 17),
          absent(2022, 17, 17),
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

  it("weighs age: the same back is available no more at twenty-nine than at twenty-four, where the cells are thick", () => {
    // Under-25 and 28-to-30 are the two thick running-back age cells on the fit seasons (well over
    // a hundred player-seasons each), and the decline from the first to the second is what the
    // data supports and this pins. The over-30 cell is THIN (a few dozen player-seasons, shrunk
    // toward one with forty pseudo-seasons), and its sign has flipped between two states of the
    // same store, so a 32-year-old is held only to the fit's own bound below, never to a direction.
    const young = expectedGamesPlayed(player({ age: 24 }), at2024);
    const prime = expectedGamesPlayed(player({ age: 29 }), at2024);
    expect(prime.expected).toBeLessThanOrEqual(young.expected);
    for (const position of ["QB", "RB", "WR", "TE"] as const) {
      for (const bracket of AGE_BRACKETS) {
        const multiplier = FITTED_AVAILABILITY_PRIORS.ageMultiplier[position][bracket];
        expect(multiplier).toBeGreaterThanOrEqual(AGE_MULTIPLIER_BOUND.min);
        expect(multiplier).toBeLessThanOrEqual(AGE_MULTIPLIER_BOUND.max);
      }
    }
    const old = expectedGamesPlayed(player({ age: 32 }), at2024);
    expect(Math.abs(old.expected - young.expected)).toBeLessThan(1);
  });

  it("REGRESSES HARD: one lost season moves the projection by a fraction of the games it lost", () => {
    const clean = expectedGamesPlayed(player({ history: [absent(2023, 17, 17)] }), at2024);
    const hurt = expectedGamesPlayed(player({ history: [absent(2023, 5, 17)] }), at2024);
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
          absent(2023, 6, 17),
          absent(2022, 17, 17),
        ],
      }),
      at2024,
    );
    const oldInjury = expectedGamesPlayed(
      player({
        history: [
          absent(2023, 17, 17),
          absent(2022, 6, 17),
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

  it("reads a designation's own fitted cell in place of the coarse status where the priors carry one, and the coarse status otherwise", () => {
    const split: AvailabilityPriors = { ...FLAT, designationMultiplier: { injured_reserve_return: 0.8, out: 0.9 } };
    const coarse = expectedGamesPlayed(player({ status: "reserve", designation: "injured_reserve" }), { season: 2024, priors: split });
    const returning = expectedGamesPlayed(player({ status: "reserve", designation: "injured_reserve_return" }), { season: 2024, priors: split });
    const ruledOut = expectedGamesPlayed(player({ status: "active", designation: "out" }), { season: 2024, priors: split });
    const active = expectedGamesPlayed(player({ status: "active" }), { season: 2024, priors: split });
    expect(coarse.rate).toBeCloseTo(active.rate * 0.5, 12);
    expect(returning.rate).toBeCloseTo(active.rate * 0.8, 12);
    expect(ruledOut.rate).toBeCloseTo(active.rate * 0.9, 12);
    // Without the table every designation is its coarse status, byte for byte.
    expect(expectedGamesPlayed(player({ status: "reserve", designation: "injured_reserve_return" }), { season: 2024, priors: FLAT })).toEqual(
      expectedGamesPlayed(player({ status: "reserve" }), { season: 2024, priors: FLAT }),
    );
    expect(statusMultiplierFor({ status: "active", designation: "out" }, FLAT)).toBe(1);
    expect(statusMultiplierFor({ status: "active", designation: "out" }, split)).toBe(0.9);
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
          absent(2023, 13.6, 17),
          absent(2022, 13.6, 17),
          absent(2021, 13.6, 17),
        ],
      }),
    );
    const unknown = spreadOf(player({ history: [] }));
    expect(unknown).toBeGreaterThan(known);
  });

  describe("what a season of record is evidence OF (founder report 2026-09-08: backup weeks counted as missed games)", () => {
    const flat = { season: 2024, priors: FLAT } as const;
    const rolePrior = FLAT.baseline.RB.committee;
    const record = (gamesPlayed: number, gamesUnavailable: number | null, gamesSuspended: number | null = gamesUnavailable === null ? null : 0): AvailabilityInput =>
      player({ history: [{ season: 2023, gamesPlayed, teamGames: 17, gamesUnavailable, gamesSuspended }] });
    const shrink = (prior: number, priorGames: number, numerator: number, denominator: number): number => (priorGames * prior + numerator) / (priorGames + denominator);

    describe("a served suspension is not an injury (founder report 2026-09-08: Rice at 13.3 expected games)", () => {
      it("reads the suspended weeks out of BOTH halves: Rice's 2025 is eight played of eight available, of eleven games", () => {
        const rice = record(8, 3, 6);
        expect(availabilityEvidence(rice.history[0]!)).toEqual({ played: 8, available: 8, games: 11 });
        expect(shrunkRole(rice, FLAT)).toBeCloseTo(shrink(rolePrior, FLAT.priorGames, 8, 8), 10);
        expect(shrunkAvailability(rice, FLAT)).toBeCloseTo(shrink(FLAT_AVAILABILITY, FLAT.availabilityPriorGames, 8, 11), 10);
      });

      it("charges him less availability than the same season read with the suspension as an absence, and exactly what a healthy eleven-game season would", () => {
        const asInjury = record(8, 9, 0);
        const asSuspension = record(8, 3, 6);
        expect(shrunkAvailability(asSuspension, FLAT)).toBeGreaterThan(shrunkAvailability(asInjury, FLAT));
        expect(expectedGamesPlayed(asSuspension, flat).expected).toBeGreaterThan(expectedGamesPlayed(asInjury, flat).expected);
      });

      it("reads a season he only sat suspended as no evidence at all: nothing played, nothing available, no games", () => {
        const sat = record(0, 0, 17);
        expect(availabilityEvidence(sat.history[0]!)).toEqual({ played: 0, available: 0, games: 0 });
        expect(shrunkRole(sat, FLAT)).toBe(rolePrior);
        expect(shrunkAvailability(sat, FLAT)).toBe(FLAT_AVAILABILITY);
      });

      it("caps the suspended count at the team's games and never lets available go negative", () => {
        expect(availabilityEvidence({ season: 2023, gamesPlayed: 0, teamGames: 17, gamesUnavailable: 5, gamesSuspended: 20 })).toEqual({ played: 0, available: 0, games: 0 });
        expect(availabilityEvidence({ season: 2023, gamesPlayed: 2, teamGames: 17, gamesUnavailable: 12, gamesSuspended: 6 })).toEqual({ played: 0, available: 0, games: 11 });
      });
    });

    it("reads a healthy backup's did-not-play weeks as ROLE, never as absences: his availability is a starter's", () => {
      // Eleven games, six healthy active-roster weeks, no designation all season.
      const backup = record(11, 0);
      const starter = record(17, 0);
      expect(shrunkAvailability(backup, FLAT)).toBe(shrunkAvailability(starter, FLAT));
      expect(shrunkAvailability(backup, FLAT)).toBeCloseTo(shrink(FLAT_AVAILABILITY, FLAT.availabilityPriorGames, 17, 17), 10);
      expect(shrunkRole(backup, FLAT)).toBeLessThan(rolePrior);
      expect(shrunkRole(starter, FLAT)).toBeGreaterThan(rolePrior);
    });

    it("reads the same eleven games as a full role and a lost availability when the store says the six weeks were absences", () => {
      const hurt = record(11, 6);
      expect(shrunkRole(hurt, FLAT)).toBeCloseTo(shrink(rolePrior, FLAT.priorGames, 11, 11), 10);
      expect(shrunkAvailability(hurt, FLAT)).toBeCloseTo(shrink(FLAT_AVAILABILITY, FLAT.availabilityPriorGames, 11, 17), 10);
      expect(shrunkAvailability(hurt, FLAT)).toBeLessThan(FLAT_AVAILABILITY);
    });

    it("is the product of the two halves", () => {
      const input = record(9, 4);
      expect(shrunkAvailabilityRate(input, FLAT)).toBeCloseTo(shrunkRole(input, FLAT) * shrunkAvailability(input, FLAT), 10);
    });

    it("hears a man who spent the whole season on a reserve list, who never played and used to leave no record at all", () => {
      const lost = record(0, 17);
      // No available game, so no role evidence: he sits on his bracket's cell. Every game unavailable.
      expect(shrunkRole(lost, FLAT)).toBe(rolePrior);
      expect(shrunkAvailability(lost, FLAT)).toBeCloseTo(shrink(FLAT_AVAILABILITY, FLAT.availabilityPriorGames, 0, 17), 10);
      expect(shrunkAvailabilityRate(lost, FLAT)).toBeLessThan(rolePrior * FLAT_AVAILABILITY);
    });

    it("reads a season the designation stores do not cover as no evidence, never as a clean season and never as a lost one", () => {
      const uncovered = record(11, null);
      expect(shrunkRole(uncovered, FLAT)).toBe(rolePrior);
      expect(shrunkAvailability(uncovered, FLAT)).toBe(FLAT_AVAILABILITY);
      // It still counts as a season of record for the spread, because the games he played are real.
      expect(expectedGamesPlayed(uncovered, flat).probabilities).not.toEqual(expectedGamesPlayed(player(), flat).probabilities);
    });

    it("caps the unavailable count at the games his team played and the played count at the games he was available for", () => {
      expect(shrunkAvailabilityRate(record(0, 20), FLAT)).toBeCloseTo(shrunkAvailabilityRate(record(0, 17), FLAT), 10);
      expect(shrunkRole(record(15, 6), FLAT)).toBeCloseTo(shrunkRole(record(11, 6), FLAT), 10);
    });

    it("never exceeds one, however clean and long the record", () => {
      const spotless = Array.from({ length: 3 }, (_, index) => ({ season: 2023 - index, gamesPlayed: 17, teamGames: 17, gamesUnavailable: 0, gamesSuspended: 0 }));
      const generous: AvailabilityPriors = { ...FLAT, baseline: { ...FLAT.baseline, RB: { bench: 0.99, rotation: 0.99, committee: 0.99, featured: 0.99 } } };
      expect(shrunkAvailabilityRate(player({ history: spotless }), generous)).toBeLessThanOrEqual(1);
    });

    it("leaves a rookie's draft-capital baseline exactly where it was: he has no record to scale it by", () => {
      expect(shrunkAvailabilityRate(player({ baselineRate: 0.62 }), FLAT)).toBe(0.62);
    });
  });

  it("reads only as many prior seasons as the priors allow", () => {
    const withinWindow = player({
      history: [
        absent(2023, 17, 17),
        absent(2022, 17, 17),
        absent(2021, 17, 17),
      ],
    });
    const plusAncientHistory = player({
      history: [...withinWindow.history, absent(2018, 0, 16)],
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
    const cleanRecord = [2023, 2022, 2021].map((season) => absent(season, 17, 17));
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
    const { statusMultiplier, designationMultiplier } = FITTED_AVAILABILITY_PRIORS;
    expect(statusMultiplier.active).toBe(1);
    expect(statusMultiplier.reserve).toBeLessThan(1);
    expect(statusMultiplier.practice_squad).toBeLessThan(1);
    expect(statusMultiplier.off_roster).toBeLessThan(statusMultiplier.practice_squad);
    // The committed designation cells (current-status round): an Out on an active roster costs
    // games but nothing like a reserve list; every reserve cell sits near the pooled reserve number
    // it was shrunk toward; a return designation has no fit-season rows (the archive's R48 begins
    // in 2024) and therefore no cell.
    expect(designationMultiplier?.out).toBeGreaterThan(statusMultiplier.reserve);
    expect(designationMultiplier?.out).toBeLessThan(1);
    for (const cell of ["injured_reserve", "pup", "nfi", "suspended", "exempt"] as const) {
      expect(designationMultiplier?.[cell]).toBeGreaterThan(statusMultiplier.reserve * 0.8);
      expect(designationMultiplier?.[cell]).toBeLessThan(statusMultiplier.reserve * 1.25);
    }
    expect(designationMultiplier?.injured_reserve_return).toBeUndefined();
  });
});

/**
 * FIT-ROUND TASK 3, DELIVERABLE D — the recency axis the blend's grid moves. The null cell has to
 * reproduce today's expected games EXACTLY, or the grid's "incumbent in every dimension" promise is
 * not true and the fit could pick a "new" cell that is really the old one plus arithmetic noise.
 */
describe("withAvailabilityRecency — the fitted recency axis", () => {
  /** A record with three seasons in it, deliberately UNEVEN, so the weighting has something to do:
   *  a flat aggregation and a decayed one cannot agree on this player. */
  const uneven = [
    absent(2023, 17, 17),
    absent(2022, 4, 17),
    absent(2021, 2, 17),
  ];

  it("NULL CELL: `null` returns the caller's OWN priors object, so today's behaviour is reproduced by construction", () => {
    expect(withAvailabilityRecency(FITTED_AVAILABILITY_PRIORS, null)).toBe(FITTED_AVAILABILITY_PRIORS);
  });

  it("NULL CELL: expectedGamesPlayed is bit-for-bit identical at the null value", () => {
    const input = player({ history: uneven });
    const today = expectedGamesPlayed(input, at2024);
    const nulled = expectedGamesPlayed(input, { season: 2024, priors: withAvailabilityRecency(FITTED_AVAILABILITY_PRIORS, null) });
    expect(nulled).toEqual(today);
    expect(nulled.expected).toBe(today.expected);
    expect(nulled.rate).toBe(today.rate);
    expect(nulled.probabilities).toEqual(today.probabilities);
  });

  it("the committed value passed EXPLICITLY is also bit-for-bit identical — the axis contains the incumbent", () => {
    const input = player({ history: uneven });
    const today = expectedGamesPlayed(input, at2024);
    const explicit = expectedGamesPlayed(input, {
      season: 2024,
      priors: withAvailabilityRecency(FITTED_AVAILABILITY_PRIORS, FITTED_AVAILABILITY_PRIORS.recencyDecay),
    });
    expect(explicit.expected).toBe(today.expected);
  });

  it("a SHORTER memory weighs the most recent season harder — a man whose latest season was clean projects higher", () => {
    const input = player({ history: uneven });
    const short = expectedGamesPlayed(input, { season: 2024, priors: withAvailabilityRecency(FITTED_AVAILABILITY_PRIORS, 0.2) });
    const long = expectedGamesPlayed(input, { season: 2024, priors: withAvailabilityRecency(FITTED_AVAILABILITY_PRIORS, 1) });
    expect(short.expected).toBeGreaterThan(long.expected);
  });

  it("changes NOTHING but the decay", () => {
    const moved = withAvailabilityRecency(FITTED_AVAILABILITY_PRIORS, 0.5);
    expect(moved.recencyDecay).toBe(0.5);
    expect({ ...moved, recencyDecay: FITTED_AVAILABILITY_PRIORS.recencyDecay }).toEqual(FITTED_AVAILABILITY_PRIORS);
  });

  it("REFUSES a decay outside (0, 1] — an older season may never outweigh a newer one", () => {
    expect(() => withAvailabilityRecency(FITTED_AVAILABILITY_PRIORS, 0)).toThrow(/recencyDecay must lie in \(0, 1\]/);
    expect(() => withAvailabilityRecency(FITTED_AVAILABILITY_PRIORS, 1.2)).toThrow(/recencyDecay must lie in \(0, 1\]/);
  });
});
