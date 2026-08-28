import { describe, expect, it } from "vitest";
import type { Position, StatLine } from "@/domain/player";
import {
  applyCareerStage,
  careerMultiplier,
  experienceBandFor,
  EXPERIENCE_BANDS,
  NEUTRAL_CAREER_PRIORS,
  type CareerPriors,
} from "./career";
import { fitCareerPriors, type CareerObservation } from "./fit";

const PRIORS: CareerPriors = {
  byExperience: {
    QB: { year1: 1, year2: 1, year3: 1, year4to6: 1, year7plus: 1 },
    RB: { year1: 1.35, year2: 0.94, year3: 0.94, year4to6: 0.98, year7plus: 0.93 },
    WR: { year1: 1.35, year2: 1.13, year3: 1, year4to6: 0.95, year7plus: 0.9 },
    TE: { year1: 1.35, year2: 1.04, year3: 1.04, year4to6: 0.99, year7plus: 0.88 },
    K: { year1: 1, year2: 1, year3: 1, year4to6: 1, year7plus: 1 },
    DEF: { year1: 1, year2: 1, year3: 1, year4to6: 1, year7plus: 1 },
  },
  bound: 0.35,
};

function line(over: Partial<StatLine> = {}): StatLine {
  return {
    playerId: "00-0000001",
    week: 1,
    passingYards: 0,
    passingTouchdowns: 0,
    interceptions: 0,
    rushingYards: 10,
    rushingTouchdowns: 0.1,
    receivingYards: 40,
    receivingTouchdowns: 0.2,
    receptions: 4,
    fumblesLost: 0.05,
    fieldGoalsMade: 0,
    extraPointsMade: 0,
    sacks: 0,
    defensiveInterceptions: 0,
    defensiveTouchdowns: 0,
    ...over,
  };
}

function observation(over: Partial<CareerObservation>): CareerObservation {
  return {
    season: 2021,
    playerId: "00-0000001",
    position: "WR",
    band: "year1",
    projectedPoints: 100,
    actualPoints: 100,
    ...over,
  };
}

describe("experienceBandFor", () => {
  it("counts the season a man entered the league as his first", () => {
    expect(experienceBandFor(2024, 2024)).toBe("year1");
    expect(experienceBandFor(2024, 2023)).toBe("year2");
    expect(experienceBandFor(2024, 2022)).toBe("year3");
    expect(experienceBandFor(2024, 2021)).toBe("year4to6");
    expect(experienceBandFor(2024, 2019)).toBe("year4to6");
    expect(experienceBandFor(2024, 2018)).toBe("year7plus");
  });

  it("REFUSES a man with no entry year rather than guessing him into a band", () => {
    expect(experienceBandFor(2024, null)).toBeNull();
  });

  it("refuses an entry year after the season, which is a corrupt row and not a rookie", () => {
    expect(experienceBandFor(2024, 2025)).toBeNull();
  });
});

describe("careerMultiplier", () => {
  it("is exactly one for a man whose stage is unknown, so the curve never guesses", () => {
    expect(careerMultiplier("WR", null, PRIORS)).toBe(1);
  });

  it("is exactly one everywhere under the neutral priors the fit builds its before arm with", () => {
    for (const band of EXPERIENCE_BANDS) {
      expect(careerMultiplier("WR", band, NEUTRAL_CAREER_PRIORS)).toBe(1);
    }
  });

  it("bounds a cell in both directions, symmetrically about one", () => {
    const wild: CareerPriors = {
      ...PRIORS,
      byExperience: { ...PRIORS.byExperience, WR: { ...PRIORS.byExperience.WR, year1: 9, year7plus: 0.01 } },
    };
    expect(careerMultiplier("WR", "year1", wild)).toBeCloseTo(1.35, 10);
    expect(careerMultiplier("WR", "year7plus", wild)).toBeCloseTo(1 / 1.35, 10);
  });

  it("falls back to one on a cell that is missing or not a positive number", () => {
    const broken = { ...PRIORS, byExperience: { ...PRIORS.byExperience, WR: { ...PRIORS.byExperience.WR, year2: 0 } } };
    expect(careerMultiplier("WR", "year2", broken)).toBe(1);
  });
});

describe("applyCareerStage", () => {
  it("scales every stat field by the cell and leaves the identity fields alone", () => {
    const scaled = applyCareerStage(line(), "WR", "year7plus", PRIORS);
    expect(scaled.playerId).toBe("00-0000001");
    expect(scaled.week).toBe(1);
    expect(scaled.receivingYards).toBeCloseTo(40 * 0.9, 10);
    expect(scaled.receptions).toBeCloseTo(4 * 0.9, 10);
    expect(scaled.fumblesLost).toBeCloseTo(0.05 * 0.9, 10);
  });

  it("returns the SAME line when the cell is one, so an untouched player is untouched exactly", () => {
    const original = line();
    expect(applyCareerStage(original, "QB", "year3", PRIORS)).toBe(original);
    expect(applyCareerStage(original, "WR", null, PRIORS)).toBe(original);
  });
});

describe("fitCareerPriors", () => {
  it("REFUSES a held-out season rather than quietly filtering it out", () => {
    expect(() =>
      fitCareerPriors([observation({ season: 2024 })], { heldOutSeasons: [2023, 2024] }),
    ).toThrow(/held out/);
  });

  it("normalises within the position, so a cohort that beat the board only moves RELATIVE to its position", () => {
    // Every cell doubled against its projection. The position as a whole is twice its projection
    // too, so after normalisation nothing has moved relative to anything and every cell is one.
    const doubled = EXPERIENCE_BANDS.flatMap((band) =>
      Array.from({ length: 200 }, (_, index) =>
        observation({ playerId: `${band}-${index}`, band, projectedPoints: 100, actualPoints: 200 }),
      ),
    );
    const priors = fitCareerPriors(doubled, { heldOutSeasons: [2023, 2024] });
    for (const band of EXPERIENCE_BANDS) {
      expect(careerMultiplier("WR", band, priors)).toBeCloseTo(1, 6);
    }
  });

  it("finds the cohort a board under-projects and lifts it above the ones it did not", () => {
    const rows = [
      ...Array.from({ length: 200 }, (_, index) =>
        observation({ playerId: `a${index}`, band: "year1", projectedPoints: 100, actualPoints: 130 }),
      ),
      ...Array.from({ length: 200 }, (_, index) =>
        observation({ playerId: `b${index}`, band: "year7plus", projectedPoints: 100, actualPoints: 100 }),
      ),
    ];
    const priors = fitCareerPriors(rows, { heldOutSeasons: [2023, 2024] });
    expect(careerMultiplier("WR", "year1", priors)).toBeGreaterThan(careerMultiplier("WR", "year7plus", priors));
    // And the position's total is preserved: the two cells straddle one rather than both exceeding it.
    expect(careerMultiplier("WR", "year1", priors)).toBeGreaterThan(1);
    expect(careerMultiplier("WR", "year7plus", priors)).toBeLessThan(1);
  });

  it("shrinks a thin cell toward one, so a handful of player-seasons cannot assert a curve", () => {
    const rows = [
      ...Array.from({ length: 3 }, (_, index) =>
        observation({ playerId: `thin${index}`, band: "year1", projectedPoints: 100, actualPoints: 400 }),
      ),
      ...Array.from({ length: 400 }, (_, index) =>
        observation({ playerId: `fat${index}`, band: "year7plus", projectedPoints: 100, actualPoints: 100 }),
      ),
    ];
    const priors = fitCareerPriors(rows, { heldOutSeasons: [2023, 2024] });
    // Three rows at four times their projection is a relative claim of 3.9 unshrunk. The cell prior
    // keeps about seven per cent of it, which is three rows' worth of forty-three, and the bound
    // never has to be reached — the shrinkage is what protects a thin cell and the bound is only
    // the last resort behind it.
    expect(careerMultiplier("WR", "year1", priors)).toBeLessThan(1.25);
    expect(careerMultiplier("WR", "year1", priors)).toBeGreaterThan(1);
  });

  it("leaves a position it saw nothing at entirely alone, at exactly one", () => {
    const priors = fitCareerPriors([observation({ position: "WR" })], { heldOutSeasons: [2023, 2024] });
    for (const band of EXPERIENCE_BANDS) {
      expect(careerMultiplier("QB" as Position, band, priors)).toBe(1);
    }
  });
});
