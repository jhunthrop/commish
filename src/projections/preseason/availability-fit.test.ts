import { describe, expect, it } from "vitest";
import { ARCHIVES_REQUIRED, fitAvailabilityBaseline, fitAvailabilityPriors, fitBaseline, type AvailabilityObservation } from "./availability-fit";
import { ROLE_BRACKETS, roleBracketFor, type RoleBracket } from "./availability";

/** A snap share squarely inside each role bracket, so a fixture names the bracket it lands in. */
const SHARE_FOR: Readonly<Record<RoleBracket, number>> = { bench: 0.05, rotation: 0.25, committee: 0.45, featured: 0.9 };

function observation(overrides: Partial<AvailabilityObservation> = {}): AvailabilityObservation {
  return {
    season: 2021,
    playerId: "p",
    position: "RB",
    age: 26,
    status: "active",
    projectedSnapShare: SHARE_FOR.featured,
    history: [],
    baselineRate: null,
    gamesPlayed: 15,
    gamesUnavailable: 1,
    gamesSuspended: 0,
    ...overrides,
  };
}

/** `count` copies of one observation, each with its own id. */
function cell(count: number, overrides: Partial<AvailabilityObservation>): readonly AvailabilityObservation[] {
  return Array.from({ length: count }, (_, index) => observation({ ...overrides, playerId: `${overrides.playerId ?? "p"}-${index}` }));
}

describe("fitBaseline, the role table", () => {
  it("reproduces a hand-computed two-cell case: games played per game AVAILABLE, weighted by count", () => {
    // Featured: 40 men, 16 played of 16 available (17 games, 1 unavailable) = 1.0.
    // Bench: 20 men, 4 played of 17 available = 4/17. Every other bracket is empty and takes the
    // position mean, which the monotone fit then pools with its neighbours.
    const rows = [
      ...cell(40, { projectedSnapShare: SHARE_FOR.featured, gamesPlayed: 16, gamesUnavailable: 1 }),
      ...cell(20, { projectedSnapShare: SHARE_FOR.bench, gamesPlayed: 4, gamesUnavailable: 0 }),
    ];
    const table = fitBaseline(rows);
    expect(table.RB.featured).toBeCloseTo(1, 10);
    expect(table.RB.bench).toBeCloseTo(4 / 17, 10);
  });

  it("is non-decreasing over the brackets whatever order the raw cells came in", () => {
    // Rotation deliberately ABOVE committee in the raw data (0.9 against 0.5), which the brackets'
    // meaning forbids: the pool-adjacent-violators step must merge them.
    const rows = [
      ...cell(30, { projectedSnapShare: SHARE_FOR.bench, gamesPlayed: 3, gamesUnavailable: 0 }),
      ...cell(30, { projectedSnapShare: SHARE_FOR.rotation, gamesPlayed: 15, gamesUnavailable: 0 }),
      ...cell(30, { projectedSnapShare: SHARE_FOR.committee, gamesPlayed: 8, gamesUnavailable: 1 }),
      ...cell(30, { projectedSnapShare: SHARE_FOR.featured, gamesPlayed: 17, gamesUnavailable: 0 }),
    ];
    const table = fitBaseline(rows);
    const values = ROLE_BRACKETS.map((bracket) => table.RB[bracket]);
    for (let index = 1; index < values.length; index += 1) expect(values[index]!).toBeGreaterThanOrEqual(values[index - 1]!);
    // The violating pair pooled to their weighted mean: (15/17 * 30 + 8/16 * 30) / 60.
    expect(table.RB.rotation).toBeCloseTo((15 / 17 + 8 / 16) / 2, 10);
    expect(table.RB.committee).toBe(table.RB.rotation);
    expect(roleBracketFor(SHARE_FOR.rotation)).toBe("rotation");
  });

  it("refuses to estimate a role table without the archives", () => {
    expect(() => fitBaseline(cell(120, { gamesUnavailable: null, gamesSuspended: null }))).toThrow(ARCHIVES_REQUIRED);
  });

  it("reads a suspended week out of the label season the way the record is read: neither played nor available", () => {
    // Eleven played of eleven available (six suspended): a full role, not eleven of seventeen.
    const rows = cell(40, { projectedSnapShare: SHARE_FOR.featured, gamesPlayed: 11, gamesUnavailable: 0, gamesSuspended: 6 });
    expect(fitBaseline(rows).RB.featured).toBeCloseTo(1, 10);
  });
});

describe("fitAvailabilityBaseline", () => {
  it("is the mean share of the season available, per position, over active observations only", () => {
    const rows = [
      ...cell(10, { position: "WR", gamesUnavailable: 0 }),
      ...cell(10, { position: "WR", gamesUnavailable: 17 }),
      ...cell(10, { position: "WR", status: "reserve", gamesUnavailable: 17 }),
    ];
    expect(fitAvailabilityBaseline(rows).WR).toBeCloseTo(0.5, 10);
  });

  it("throws ARCHIVES_REQUIRED when no observation carries an unavailable count", () => {
    expect(() => fitAvailabilityBaseline(cell(120, { gamesUnavailable: null, gamesSuspended: null }))).toThrow(ARCHIVES_REQUIRED);
  });

  it("leaves a suspended week out of the season's available share on both sides of the fraction", () => {
    // Eleven games not suspended, all available: a full season, not eleven seventeenths of one.
    expect(fitAvailabilityBaseline(cell(10, { position: "WR", gamesUnavailable: 0, gamesSuspended: 6 })).WR).toBeCloseTo(1, 10);
    // Six suspended, five hurt: five of eleven unavailable.
    expect(fitAvailabilityBaseline(cell(10, { position: "TE", gamesUnavailable: 5, gamesSuspended: 6 })).TE).toBeCloseTo(6 / 11, 10);
  });
});

describe("fitAvailabilityPriors", () => {
  /**
   * A synthetic population with a KNOWN optimum: PERFECT PERSISTENCE of availability. Every man is
   * a featured back who plays every game he is available for (so the role half of the record says
   * nothing and the role prior cannot matter); half were available all of last season and are again
   * (17 of 17), half were available for exactly half of it and are again (8 of 17). Availability
   * this season IS availability last season, so the less the record is shrunk toward the population
   * mean the better, and the LIGHTEST availability prior on the grid must win.
   */
  const population: readonly AvailabilityObservation[] = [
    ...cell(60, {
      playerId: "clean",
      history: [{ season: 2020, gamesPlayed: 16, teamGames: 16, gamesUnavailable: 0, gamesSuspended: 0 }],
      gamesPlayed: 17,
      gamesUnavailable: 0,
    }),
    ...cell(60, {
      playerId: "half",
      history: [{ season: 2020, gamesPlayed: 8, teamGames: 16, gamesUnavailable: 8, gamesSuspended: 0 }],
      gamesPlayed: 8,
      gamesUnavailable: 9,
    }),
  ];

  it("picks the known optimum on the two-parameter grid", () => {
    const priors = fitAvailabilityPriors(population, {
      heldOutSeasons: [2023, 2024],
      priorGamesGrid: [17, 68],
      availabilityPriorGamesGrid: [17, 68, 204],
      recencyDecayGrid: [0.5, 1],
    });
    expect(priors.availabilityPriorGames).toBe(17);
    expect(priors.baseline.RB.featured).toBeCloseTo(1, 10);
    expect(priors.availabilityBaseline.RB).toBeCloseTo((1 + 8 / 17) / 2, 10);
    expect(priors.statusMultiplier.active).toBe(1);
  });

  it("throws when handed a held-out season, whichever grid it was given", () => {
    for (const season of [2023, 2024]) {
      expect(() => fitAvailabilityPriors([...population, observation({ season })], { heldOutSeasons: [2023, 2024] })).toThrow(/held out/);
    }
  });

  it("throws ARCHIVES_REQUIRED when the archives are absent, before searching anything", () => {
    const uncovered = population.map((row) => ({ ...row, gamesUnavailable: null, history: [] }));
    expect(() => fitAvailabilityPriors(uncovered, { heldOutSeasons: [2023, 2024] })).toThrow(ARCHIVES_REQUIRED);
  });
});
