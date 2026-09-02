import { describe, expect, it } from "vitest";
import { STAT_FIELDS, type Position, type StatLine } from "@/domain/player";
import type { SeasonStatLine } from "../lines";
import type { PlayerWeekUsage } from "../usage";
import {
  experienceCohort,
  predictRates,
  RATES,
  TOUCHDOWN_RATES,
  type EfficiencyPriors,
  type RateName,
} from "./efficiency";
import { HISTORICAL_ROSTER_FLOOR } from "../nflverse/rosters";
import { FITTED_EFFICIENCY_PRIORS } from "./fitted";

function line(season: number, week: number, playerId: string, over: Partial<StatLine>): SeasonStatLine {
  return {
    season,
    asOf: new Date("2024-09-10T00:00:00.000Z"),
    line: {
      playerId,
      week,
      ...(Object.fromEntries(STAT_FIELDS.map((field) => [field, 0])) as Omit<StatLine, "playerId" | "week">),
      ...over,
    },
  };
}

function usage(season: number, week: number, playerId: string, over: Partial<PlayerWeekUsage> = {}): PlayerWeekUsage {
  return {
    season,
    week,
    playerId,
    snapShare: 0.8,
    targetShare: 0.2,
    carryShare: 0,
    passAttemptShare: 0,
    targets: 8,
    carries: 0,
    passAttempts: 0,
    teamTargets: 35,
    teamCarries: 26,
    teamPassAttempts: 35,
    touches: null,
    asOf: new Date("2024-09-10T00:00:00.000Z"),
    ...over,
  };
}

const POSITIONS: ReadonlyMap<string, Position> = new Map([["wr", "WR"], ["rb", "RB"], ["qb", "QB"]]);

/** Round numbers, so a shrunk rate can be checked by hand. Real ones are fitted and held out. */
const PRIORS: EfficiencyPriors = {
  byPosition: {
    QB: rate({ passingYardsPerAttempt: 7, passingTouchdownsPerAttempt: 0.04, interceptionsPerAttempt: 0.025 }),
    RB: rate({ rushingYardsPerCarry: 4, rushingTouchdownsPerCarry: 0.03, receptionsPerTarget: 0.75, receivingYardsPerTarget: 6 }),
    WR: rate({ receptionsPerTarget: 0.6, receivingYardsPerTarget: 8, receivingTouchdownsPerTarget: 0.05 }),
    TE: rate({ receptionsPerTarget: 0.65, receivingYardsPerTarget: 7, receivingTouchdownsPerTarget: 0.06 }),
    K: rate({}),
    DEF: rate({}),
  },
  regression: {
    receptionsPerTarget: 20,
    receivingYardsPerTarget: 20,
    receivingTouchdownsPerTarget: 200,
    rushingYardsPerCarry: 20,
    rushingTouchdownsPerCarry: 200,
    passingYardsPerAttempt: 20,
    passingTouchdownsPerAttempt: 200,
    interceptionsPerAttempt: 100,
    fumblesLostPerPlay: 100,
  },
};

function rate(over: Partial<Record<RateName, number>>): Readonly<Record<RateName, number>> {
  return { ...(Object.fromEntries(Object.keys(RATES).map((name) => [name, 0])) as Record<RateName, number>), ...over };
}

describe("RATES", () => {
  it("names every touchdown rate the engine composes", () => {
    expect([...TOUCHDOWN_RATES].sort()).toEqual([
      "passingTouchdownsPerAttempt",
      "receivingTouchdownsPerTarget",
      "rushingTouchdownsPerCarry",
    ]);
    for (const name of TOUCHDOWN_RATES) expect(RATES[name]).toBeDefined();
  });
});

describe("predictRates", () => {
  const context = { season: 2024, week: 10, positions: POSITIONS };

  it("gives a player with no history his position's rate exactly", () => {
    const rates = predictRates([], [], context, PRIORS);
    expect(rates.size).toBe(0);
    const rookie = predictRates(
      [line(2024, 1, "wr", {})],
      [usage(2024, 1, "wr", { targets: 0 })],
      context,
      PRIORS,
    ).get("wr")!;
    expect(rookie.receivingYardsPerTarget).toBeCloseTo(8, 10);
  });

  it("moves a rate toward what a player did, in proportion to his opportunities", () => {
    // Weeks 1-9 are visible (week 10 is the one being predicted): 90 targets at 12 yards each,
    // against a prior of 8 worth 20 targets. (90*12 + 20*8) / 110 = 11.27.
    const history = Array.from({ length: 10 }, (_, index) => line(2024, index + 1, "wr", { receivingYards: 120 }));
    const opportunities = Array.from({ length: 10 }, (_, index) => usage(2024, index + 1, "wr", { targets: 10 }));
    const rates = predictRates(history, opportunities, context, PRIORS).get("wr")!;
    expect(rates.receivingYardsPerTarget).toBeCloseTo((90 * 12 + 20 * 8) / 110, 6);
  });

  it("REGRESSES TOUCHDOWN RATE HARDER THAN ANY OTHER RATE, on identical evidence", () => {
    // The load-bearing test of this layer. Touchdown variance is where amateur models overfit and
    // look confident and wrong by week six: ten targets and two touchdowns is a 20% touchdown rate
    // and means almost nothing, while ten targets and eighty yards means something. Both rates see
    // the same hundred targets here, and the touchdown rate must move less.
    const history = Array.from({ length: 10 }, (_, index) =>
      line(2024, index + 1, "wr", { receivingYards: 160, receivingTouchdowns: 2 }),
    );
    const opportunities = Array.from({ length: 10 }, (_, index) => usage(2024, index + 1, "wr", { targets: 10 }));
    const rates = predictRates(history, opportunities, context, PRIORS).get("wr")!;

    const moved = (observed: number, predicted: number, prior: number) => Math.abs(predicted - prior) / Math.abs(observed - prior);
    const yardsMoved = moved(16, rates.receivingYardsPerTarget, 8);
    const touchdownsMoved = moved(0.2, rates.receivingTouchdownsPerTarget, 0.05);
    expect(touchdownsMoved).toBeLessThan(yardsMoved / 2);
  });

  it("counts a rate's opportunities in its own denominator, never in games", () => {
    // A back with 200 carries and a back with 20 are not equally known, and expressing the
    // regression in games would say they were. The two must land in different places.
    const many = predictRates(
      Array.from({ length: 10 }, (_, index) => line(2024, index + 1, "rb", { rushingYards: 120 })),
      Array.from({ length: 10 }, (_, index) => usage(2024, index + 1, "rb", { targets: 0, carries: 20 })),
      context,
      PRIORS,
    ).get("rb")!;
    const few = predictRates(
      Array.from({ length: 10 }, (_, index) => line(2024, index + 1, "rb", { rushingYards: 12 })),
      Array.from({ length: 10 }, (_, index) => usage(2024, index + 1, "rb", { targets: 0, carries: 2 })),
      context,
      PRIORS,
    ).get("rb")!;
    // 180 carries at 6 yards, against a prior of 4 worth 20: (180*6 + 20*4) / 200 = 5.8.
    expect(many.rushingYardsPerCarry).toBeCloseTo(5.8, 6);
    expect(Math.abs(few.rushingYardsPerCarry - 4)).toBeLessThan(Math.abs(many.rushingYardsPerCarry - 4));
  });

  it("cannot see a week at or after the one it is predicting", () => {
    const past = { history: [line(2024, 1, "wr", { receivingYards: 100 })], usage: [usage(2024, 1, "wr", { targets: 10 })] };
    const withFuture = {
      history: [...past.history, line(2024, 10, "wr", { receivingYards: 0 }), line(2024, 12, "wr", { receivingYards: 0 })],
      usage: [...past.usage, usage(2024, 10, "wr", { targets: 20 }), usage(2024, 12, "wr", { targets: 20 })],
    };
    expect(predictRates(withFuture.history, withFuture.usage, context, PRIORS).get("wr")).toEqual(
      predictRates(past.history, past.usage, context, PRIORS).get("wr"),
    );
  });

  it("never predicts a negative rate", () => {
    const rates = predictRates(
      [line(2024, 1, "wr", { receivingYards: 0, fumblesLost: 0 })],
      [usage(2024, 1, "wr", { targets: 5 })],
      { season: 2024, week: 2, positions: POSITIONS },
      PRIORS,
    ).get("wr")!;
    for (const value of Object.values(rates)) expect(value).toBeGreaterThanOrEqual(0);
  });
});

describe("experienceCohort", () => {
  it("places years 4 through 6 in the cohort and nothing else", () => {
    expect(experienceCohort(2024, 2021)).toBe("year4to6"); // career year 4
    expect(experienceCohort(2024, 2020)).toBe("year4to6"); // career year 5
    expect(experienceCohort(2024, 2019)).toBe("year4to6"); // career year 6
    expect(experienceCohort(2024, 2022)).toBe("other"); // career year 3
    expect(experienceCohort(2024, 2018)).toBe("other"); // career year 7
  });

  it("returns other for a player with no known first roster season", () => {
    expect(experienceCohort(2024, null)).toBe("other");
  });

  it("refuses to place a player before his own debut", () => {
    expect(experienceCohort(2020, 2024)).toBe("other");
  });

  it("treats a first-season-at-the-backfill-floor player as right-censored, never as young", () => {
    // A first row exactly at HISTORICAL_ROSTER_FLOOR could belong to a rookie or a fifteen-year
    // veteran the backfill cannot see behind; a raw career year of 4-6 from it is a lower bound, not
    // a measurement, so this must NOT land in the cohort.
    const floorSeason = HISTORICAL_ROSTER_FLOOR;
    expect(experienceCohort(floorSeason + 5, floorSeason)).toBe("other"); // raw year 6, censored
    // Once the raw year is unambiguously past the cohort regardless of censoring, the floor no
    // longer matters — this is the ordinary "other" case, not a special one.
    expect(experienceCohort(floorSeason + 9, floorSeason)).toBe("other"); // raw year 10
  });

  it("no longer censors a 2013 debut, because the store now holds week-one rosters back to 2003", () => {
    // THE BEHAVIOUR CHANGE fit-round Task 1's floor raise buys, pinned explicitly rather than left to
    // follow the constant silently. Before the raise, `HISTORICAL_ROSTER_FLOOR` was 2013 and a player
    // whose first stamped roster row was 2013 was censored: the table simply began there, so a rookie
    // and a nine-year veteran were indistinguishable. The rosters now reach 2003, so a first row in
    // 2013 means he was on nobody's week-one roster for the ten preceding seasons, which is a
    // measurement. He enters the cohort on his real career year.
    expect(HISTORICAL_ROSTER_FLOOR).toBe(2003);
    expect(experienceCohort(2017, 2013)).toBe("year4to6"); // career year 5, previously "other"
    expect(experienceCohort(2007, 2004)).toBe("year4to6"); // career year 4, previously "other"
    // The rule itself is untouched: the NEW floor season is still censored, for the original reason.
    expect(experienceCohort(2007, 2003)).toBe("other");
  });
});

describe("predictRates: the years-4-6 experience term", () => {
  const priorsWithExperience: EfficiencyPriors = { ...PRIORS, experienceMultiplier: { WR: 0.85 } };

  it("scales every rate for a player in the cohort, uniformly", () => {
    const history = [line(2024, 1, "wr", { receivingYards: 0 })];
    const usageRows = [usage(2024, 1, "wr", { targets: 5 })];
    const firstRosterSeason = new Map([["wr", 2021]]); // career year 4 in 2024
    const withTerm = predictRates(history, usageRows, { season: 2024, week: 2, positions: POSITIONS, firstRosterSeason }, priorsWithExperience).get("wr")!;
    const withoutTerm = predictRates(history, usageRows, { season: 2024, week: 2, positions: POSITIONS }, priorsWithExperience).get("wr")!;
    for (const name of Object.keys(RATES) as RateName[]) {
      expect(withTerm[name]).toBeCloseTo(withoutTerm[name] * 0.85, 10);
    }
  });

  it("is a no-op for a player outside the cohort, even with the multiplier configured", () => {
    const history = [line(2024, 1, "wr", { receivingYards: 0 })];
    const usageRows = [usage(2024, 1, "wr", { targets: 5 })];
    const firstRosterSeason = new Map([["wr", 2024]]); // career year 1
    const withMap = predictRates(history, usageRows, { season: 2024, week: 2, positions: POSITIONS, firstRosterSeason }, priorsWithExperience).get("wr")!;
    const withoutMap = predictRates(history, usageRows, { season: 2024, week: 2, positions: POSITIONS }, priorsWithExperience).get("wr")!;
    expect(withMap).toEqual(withoutMap);
  });

  it("is a no-op for a position the fit found nothing for", () => {
    const history = [line(2024, 1, "rb", { rushingYards: 0 })];
    const usageRows = [usage(2024, 1, "rb", { targets: 0, carries: 5 })];
    const firstRosterSeason = new Map([["rb", 2021]]); // career year 4, but RB is absent from experienceMultiplier
    const rates = predictRates(history, usageRows, { season: 2024, week: 2, positions: POSITIONS, firstRosterSeason }, priorsWithExperience).get("rb")!;
    const baseline = predictRates(history, usageRows, { season: 2024, week: 2, positions: POSITIONS }, priorsWithExperience).get("rb")!;
    expect(rates).toEqual(baseline);
  });

  it("guards against a non-finite or non-positive fitted multiplier", () => {
    const badPriors: EfficiencyPriors = { ...PRIORS, experienceMultiplier: { WR: 0 } };
    const history = [line(2024, 1, "wr", { receivingYards: 0 })];
    const usageRows = [usage(2024, 1, "wr", { targets: 5 })];
    const firstRosterSeason = new Map([["wr", 2021]]);
    const rates = predictRates(history, usageRows, { season: 2024, week: 2, positions: POSITIONS, firstRosterSeason }, badPriors).get("wr")!;
    const baseline = predictRates(history, usageRows, { season: 2024, week: 2, positions: POSITIONS }, badPriors).get("wr")!;
    expect(rates).toEqual(baseline);
  });
});

describe("the committed efficiency fit", () => {
  it("regresses every touchdown rate strictly harder than every rate with real player signal", () => {
    // THE LOAD-BEARING ASSERTION of layer 2, pinned against the GENERATED constants rather than a
    // hand-written table: a refit that produced a confident touchdown rate fails here rather than
    // quietly shipping.
    //
    // "Strictly harder than every YARDS rate" is the strongest claim the measurement supports, and
    // the reason is itself the finding. Yards per target, yards per carry and yards per attempt all
    // show real, persistent differences between players, so their constants are finite and
    // comparatively small. Rushing and passing touchdown rate show NO measurable spread above
    // sampling noise at all and sit at the ceiling — which is the honest reading of "regress this
    // entirely to its role". Fumble rate sits there with them, for exactly the same reason, so the
    // touchdown rates tie with it rather than beating it. Asserting a strict win over fumbles would
    // be asserting something the data does not say.
    const bulkRates: readonly RateName[] = [
      "receptionsPerTarget",
      "receivingYardsPerTarget",
      "rushingYardsPerCarry",
      "passingYardsPerAttempt",
    ];
    const weakestTouchdown = Math.min(...TOUCHDOWN_RATES.map((name) => FITTED_EFFICIENCY_PRIORS.regression[name]));
    const strongestBulk = Math.max(...bulkRates.map((name) => FITTED_EFFICIENCY_PRIORS.regression[name]));

    // By a wide margin, not by a rounding error — the whole point is that a receiver's two
    // September touchdowns must not be carried into November as a talent.
    expect(weakestTouchdown).toBeGreaterThan(4 * strongestBulk);

    // Fumble rate is the ONE rate regressed at least as hard as a touchdown rate, and that is the
    // measurement rather than a leak in the assertion: the variance decomposition finds no
    // persistent difference between players in it at all, so it goes entirely to the role prior.
    // Every rate that actually carries bulk fantasy points is regressed far less.
    expect(FITTED_EFFICIENCY_PRIORS.regression.fumblesLostPerPlay).toBeGreaterThanOrEqual(weakestTouchdown);
    for (const name of bulkRates) {
      expect(FITTED_EFFICIENCY_PRIORS.regression[name]).toBeLessThan(weakestTouchdown);
    }
  });

  it("carries a positive regression constant for every rate — none of them is trusted raw", () => {
    for (const name of Object.keys(RATES) as RateName[]) {
      expect(FITTED_EFFICIENCY_PRIORS.regression[name]).toBeGreaterThan(0);
    }
  });
});
