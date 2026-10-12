import { describe, expect, it } from "vitest";
import { buildTrendMetric, populationStdDev, TREND_MATERIALITY_STDDEV_FRACTION } from "./trend";

describe("populationStdDev", () => {
  it("is zero for fewer than two values", () => {
    expect(populationStdDev([])).toBe(0);
    expect(populationStdDev([42])).toBe(0);
  });

  it("is zero when every value is identical", () => {
    expect(populationStdDev([10, 10, 10])).toBe(0);
  });

  it("matches the textbook population standard deviation for a known set", () => {
    // Mean 5, deviations [-2, -1, 0, 1, 2] -> variance (4+1+0+1+4)/5 = 2 -> stddev sqrt(2).
    expect(populationStdDev([3, 4, 5, 6, 7])).toBeCloseTo(Math.sqrt(2), 10);
  });
});

describe("buildTrendMetric", () => {
  it("is null when either season's own value is null (absent seasons = absent fact)", () => {
    expect(buildTrendMetric(2024, null, 2025, 10, [1, 2, 3])).toBeNull();
    expect(buildTrendMetric(2024, 10, 2025, null, [1, 2, 3])).toBeNull();
  });

  it("computes an honest delta as recent minus prior", () => {
    const metric = buildTrendMetric(2024, 5.4, 2025, 4.6, [4.6, 5.4, 5.0, 5.0]);
    expect(metric!.delta).toBeCloseTo(-0.8, 10);
    expect(metric!.priorValue).toBe(5.4);
    expect(metric!.recentValue).toBe(4.6);
    expect(metric!.priorSeason).toBe(2024);
    expect(metric!.recentSeason).toBe(2025);
  });

  it("marks a delta material only once it clears the documented fraction of the pooled stddev", () => {
    // Pooled population [0, 0, 10, 10] -> mean 5, stddev sqrt(((5^2)*4)/4) = 5.
    const pooled = [0, 0, 10, 10];
    const stdDev = populationStdDev(pooled);
    const thresholdDelta = TREND_MATERIALITY_STDDEV_FRACTION * stdDev;

    const justBelow = buildTrendMetric(2024, 10, 2025, 10 - (thresholdDelta - 0.01), pooled);
    const justAtOrAbove = buildTrendMetric(2024, 10, 2025, 10 - thresholdDelta, pooled);
    expect(justBelow!.material).toBe(false);
    expect(justAtOrAbove!.material).toBe(true);
  });

  it("never calls a delta material against a population with no measurable spread", () => {
    const metric = buildTrendMetric(2024, 10, 2025, 40, [10]);
    expect(metric!.material).toBe(false);
    const metricEmpty = buildTrendMetric(2024, 10, 2025, 40, []);
    expect(metricEmpty!.material).toBe(false);
  });

  it("is honestly non-material for a genuinely flat delta", () => {
    const metric = buildTrendMetric(2024, 10, 2025, 10, [0, 10, 20]);
    expect(metric!.delta).toBe(0);
    expect(metric!.material).toBe(false);
  });
});
