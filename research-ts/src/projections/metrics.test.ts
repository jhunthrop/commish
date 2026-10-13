import { describe, expect, it } from "vitest";
import {
  meanAbsoluteError,
  RANK_BANDS,
  rankBandFor,
  rootMeanSquaredError,
  scoreCard,
  spearman,
  type Observation,
} from "./metrics";

const obs = (pairs: readonly (readonly [number, number])[]): readonly Observation[] =>
  pairs.map(([predicted, actual]) => ({ predicted, actual }));

describe("spearman", () => {
  it("is 1 for a perfectly ordered projection, whatever the scale", () => {
    // Deliberately wrong by a mile on magnitude and perfect on ORDER — which is the whole point of
    // ranking as the primary metric.
    expect(spearman(obs([[1, 100], [2, 200], [3, 300], [4, 400]]))).toBeCloseTo(1, 10);
  });

  it("is -1 for a perfectly inverted projection", () => {
    expect(spearman(obs([[4, 100], [3, 200], [2, 300], [1, 400]]))).toBeCloseTo(-1, 10);
  });

  it("shares ranks across ties rather than inventing an order from array position", () => {
    // Every prediction identical on the left; the actuals differ. A tie-blind implementation would
    // read the input order as an ordering and report a correlation the projection never claimed.
    expect(spearman(obs([[5, 10], [5, 20], [5, 30]]))).toBeNull();

    // Ties on ONE side only still resolve: two players projected level, one outscored the other.
    const partial = spearman(obs([[1, 10], [2, 20], [2, 30], [4, 40]]));
    expect(partial).not.toBeNull();
    expect(partial!).toBeGreaterThan(0.9);
  });

  it("answers null rather than zero when the sample cannot support a correlation", () => {
    // "No skill" and "cannot tell" are different findings, and a harness that conflates them will
    // report a model as neutral when it was never measured at all.
    expect(spearman([])).toBeNull();
    expect(spearman(obs([[1, 1]]))).toBeNull();
    expect(spearman(obs([[3, 10], [3, 10], [3, 10]]))).toBeNull();
  });

  it("refuses a non-finite value instead of quietly returning NaN", () => {
    expect(() => spearman(obs([[Number.NaN, 10], [2, 20]]))).toThrow(/non-finite/);
    expect(() => spearman(obs([[1, Number.POSITIVE_INFINITY], [2, 20]]))).toThrow(/non-finite/);
  });
});

describe("error metrics", () => {
  it("reports mean absolute error in the observations' own unit", () => {
    expect(meanAbsoluteError(obs([[10, 12], [20, 16], [30, 30]]))).toBeCloseTo((2 + 4 + 0) / 3, 10);
  });

  it("separates a few blowups from a broadly-wrong model — the reason both are reported", () => {
    const spread = obs([[10, 13], [20, 23], [30, 33], [40, 43]]);
    const concentrated = obs([[10, 10], [20, 20], [30, 30], [40, 52]]);

    // Same total absolute error, very different shapes.
    expect(meanAbsoluteError(spread)).toBeCloseTo(meanAbsoluteError(concentrated)!, 10);
    // RMSE is what tells them apart: one missed badly, three were perfect.
    expect(rootMeanSquaredError(concentrated)!).toBeGreaterThan(rootMeanSquaredError(spread)!);
  });

  it("answers null on an empty sample", () => {
    expect(meanAbsoluteError([])).toBeNull();
    expect(rootMeanSquaredError([])).toBeNull();
  });
});

describe("rank bands", () => {
  it("puts the deep pool in its own band, because that is where the first win is expected", () => {
    expect(rankBandFor(1)).toBe("elite");
    expect(rankBandFor(50)).toBe("elite");
    expect(rankBandFor(51)).toBe("starter");
    expect(rankBandFor(150)).toBe("starter");
    expect(rankBandFor(151)).toBe("deep");
    expect(rankBandFor(400)).toBe("deep");
    expect(rankBandFor(401)).toBe("fringe");
  });

  it("covers every rank with no gap and no overlap", () => {
    for (let i = 1; i < RANK_BANDS.length; i += 1) {
      expect(RANK_BANDS[i]!.from).toBe(RANK_BANDS[i - 1]!.to + 1);
    }
    expect(RANK_BANDS[0]!.from).toBe(1);
  });

  it("refuses a rank that is not a 1-based integer", () => {
    expect(() => rankBandFor(0)).toThrow(/1-based/);
    expect(() => rankBandFor(-3)).toThrow(/1-based/);
    expect(() => rankBandFor(2.5)).toThrow(/1-based/);
  });
});

describe("scoreCard", () => {
  it("carries the sample size beside every metric, so a strong number on six players cannot pass as a result", () => {
    const card = scoreCard(obs([[1, 10], [2, 20], [3, 30]]));
    expect(card.rankCorrelation).toBeCloseTo(1, 10);
    expect(card.sampleSize).toBe(3);
    expect(card.meanAbsoluteError).not.toBeNull();
  });

  it("survives an empty sample without throwing — an unplayed week is a real input", () => {
    expect(scoreCard([])).toEqual({
      rankCorrelation: null,
      meanAbsoluteError: null,
      rootMeanSquaredError: null,
      sampleSize: 0,
    });
  });
});
