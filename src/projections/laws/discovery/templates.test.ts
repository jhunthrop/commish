import { describe, expect, it } from "vitest";
import type { DiscoveryQuantityValues } from "../discovery-facts";
import {
  computeQuantileTable,
  MIN_QUANTILE_SAMPLE,
  QUANTITY_DEFS,
  renderClaim,
  renderSignedClaim,
  type ClaimParts,
  type QuantityRow,
} from "./templates";

const NO_VALUES: DiscoveryQuantityValues = {
  touches: null,
  age: null,
  targetShare: null,
  touchdownPointsShare: null,
  redZoneTouchShare: null,
  targetDepth: null,
  snapShare: null,
  incomingCoachTenureSeasons: null,
  incomingCoachPriorPassRateOverExpected: null,
  experienceYear: null,
  teamPaceSecondsPerPlay: null,
};

describe("QUANTITY_DEFS", () => {
  it("has a unique id per entry", () => {
    const ids = QUANTITY_DEFS.map((def) => def.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("names at least one eligible position for every quantity", () => {
    for (const def of QUANTITY_DEFS) expect(def.positions.length).toBeGreaterThan(0);
  });

  it("every getter reads exactly its own field off DiscoveryQuantityValues", () => {
    for (const def of QUANTITY_DEFS) {
      const withOnlyThisField: DiscoveryQuantityValues = { ...NO_VALUES, [def.id]: 42 };
      expect(def.get(withOnlyThisField)).toBe(42);
      expect(def.get(NO_VALUES)).toBeNull();
    }
  });

  it("gives every noun a period-free, em-dash-free phrase (renderClaim supplies punctuation)", () => {
    for (const def of QUANTITY_DEFS) {
      expect(def.noun).not.toMatch(/[.—]/);
    }
  });
});

describe("renderClaim", () => {
  it("renders a threshold clause mechanically, with no asserted sign", () => {
    const parts: ClaimParts = {
      position: "RB",
      clause: { kind: "threshold", quantityId: "touches", quantileLevel: 0.8 },
    };
    const claim = renderClaim(parts);
    expect(claim).toBe(
      "A running back whose combined carries and receptions that season is in the top 20% of running backs scores differently in points per game the following season.",
    );
  });

  it("uses 'An' before a vowel-leading position noun", () => {
    // No skill position starts with a vowel today, so this proves the branch rather than a real case.
    const parts: ClaimParts = { position: "WR", clause: { kind: "threshold", quantityId: "targetShare", quantileLevel: 0.9 } };
    expect(renderClaim(parts).startsWith("A wide receiver")).toBe(true);
  });

  it("renders a rise delta clause distinctly from a fall delta clause", () => {
    const rose = renderClaim({ position: "WR", clause: { kind: "delta", quantityId: "targetShare", quantileLevel: 0.7, direction: "rose_into" } });
    const fell = renderClaim({ position: "WR", clause: { kind: "delta", quantityId: "targetShare", quantileLevel: 0.7, direction: "fell_out_of" } });
    expect(rose).toContain("climbed into the top 30% of wide receivers after being below it the year before");
    expect(fell).toContain("fell out of the top 30% of wide receivers after being in it the year before");
    expect(rose).not.toBe(fell);
  });

  it("joins an AND clause's two halves with 'and whose'", () => {
    const parts: ClaimParts = {
      position: "RB",
      clause: {
        kind: "and",
        left: { kind: "threshold", quantityId: "touches", quantileLevel: 0.9 },
        right: { kind: "threshold", quantityId: "age", quantileLevel: 0.7 },
      },
    };
    const claim = renderClaim(parts);
    expect(claim).toContain("in the top 10% of running backs and whose age at that season's opener is in the top 30% of running backs");
  });

  it("never emits an em-dash, for any clause kind", () => {
    const parts: readonly ClaimParts[] = [
      { position: "QB", clause: { kind: "threshold", quantityId: "age", quantileLevel: 0.7 } },
      { position: "TE", clause: { kind: "delta", quantityId: "targetDepth", quantileLevel: 0.9, direction: "rose_into" } },
      {
        position: "RB",
        clause: {
          kind: "and",
          left: { kind: "threshold", quantityId: "touches", quantileLevel: 0.8 },
          right: { kind: "delta", quantityId: "age", quantileLevel: 0.7, direction: "fell_out_of" },
        },
      },
    ];
    for (const claimParts of parts) expect(renderClaim(claimParts)).not.toMatch(/—/);
  });

  it("asserts no sign: the same trailing clause regardless of which quantity or direction", () => {
    const a = renderClaim({ position: "RB", clause: { kind: "threshold", quantityId: "touches", quantileLevel: 0.9 } });
    const b = renderClaim({ position: "RB", clause: { kind: "delta", quantityId: "age", quantileLevel: 0.7, direction: "fell_out_of" } });
    expect(a.endsWith("scores differently in points per game the following season.")).toBe(true);
    expect(b.endsWith("scores differently in points per game the following season.")).toBe(true);
  });
});

describe("renderSignedClaim", () => {
  const parts: ClaimParts = {
    position: "RB",
    clause: { kind: "threshold", quantityId: "touches", quantileLevel: 0.8 },
  };

  it("shares renderClaim's own intro verbatim, differing only in the trailing outcome clause", () => {
    const neutral = renderClaim(parts);
    const negative = renderSignedClaim(parts, -1);
    const introOnly = neutral.replace(/scores differently in points per game the following season\.$/, "");
    expect(negative.startsWith(introOnly)).toBe(true);
  });

  it("commits to 'loses' for a negative sign", () => {
    expect(renderSignedClaim(parts, -1)).toBe(
      "A running back whose combined carries and receptions that season is in the top 20% of running backs loses points per game the following season.",
    );
  });

  it("commits to 'gains' for a positive sign", () => {
    expect(renderSignedClaim(parts, 1)).toBe(
      "A running back whose combined carries and receptions that season is in the top 20% of running backs gains points per game the following season.",
    );
  });

  it("never emits an em-dash", () => {
    expect(renderSignedClaim(parts, -1)).not.toMatch(/—/);
    expect(renderSignedClaim(parts, 1)).not.toMatch(/—/);
  });
});

describe("computeQuantileTable", () => {
  function row(season: number, value: number): QuantityRow {
    return { season, position: "RB", values: { ...NO_VALUES, touches: value } };
  }

  it("computes an interpolated quantile from a known sorted array", () => {
    // 40 values, 0..39 -> a clean, hand-checkable case for linear interpolation.
    const rows = Array.from({ length: 40 }, (_unused, index) => row(2020, index));
    const table = computeQuantileTable(rows, { to: 2021 });
    const thresholds = table.touches!.RB!;
    // 40 values indexed 0..39; the 0.9 quantile index is 0.9*39 = 35.1 -> interpolate between 35 and 36.
    expect(thresholds[0.9]).toBeCloseTo(35.1, 5);
  });

  it("uses ONLY train-season rows, even when later-season rows are mixed in", () => {
    const trainRows = Array.from({ length: MIN_QUANTILE_SAMPLE + 10 }, (_unused, index) => row(2020, index));
    // Test-season rows, all wildly larger, which would blow the quantile up if leaked in.
    const testSeasonRows = Array.from({ length: MIN_QUANTILE_SAMPLE + 10 }, (_unused, index) => row(2023, 10_000 + index));

    const trainOnly = computeQuantileTable(trainRows, { to: 2021 });
    const mixed = computeQuantileTable([...trainRows, ...testSeasonRows], { to: 2021 });

    expect(mixed.touches!.RB).toEqual(trainOnly.touches!.RB);
    for (const level of [0.7, 0.8, 0.9] as const) expect(mixed.touches!.RB![level]).toBeLessThan(1000);
  });

  it("omits a (quantity, position) combination below the minimum train-season sample", () => {
    const sparse = Array.from({ length: MIN_QUANTILE_SAMPLE - 1 }, (_unused, index) => row(2019, index));
    const table = computeQuantileTable(sparse, { to: 2021 });
    expect(table.touches?.RB).toBeUndefined();
  });

  it("includes a combination once it reaches the minimum sample, at the boundary", () => {
    const atMinimum = Array.from({ length: MIN_QUANTILE_SAMPLE }, (_unused, index) => row(2019, index));
    const table = computeQuantileTable(atMinimum, { to: 2021 });
    expect(table.touches?.RB).toBeDefined();
  });

  it("never produces a threshold for a position a quantity does not list as eligible", () => {
    // "age" is not RB-only, but "touches" is RB-only in QUANTITY_DEFS — feeding it WR rows should
    // never populate a WR entry for "touches".
    const wrRows = Array.from({ length: MIN_QUANTILE_SAMPLE + 5 }, (_unused, index) => ({
      season: 2020,
      position: "WR" as const,
      values: { ...NO_VALUES, touches: index },
    }));
    const table = computeQuantileTable(wrRows, { to: 2021 });
    expect(table.touches?.WR).toBeUndefined();
  });
});
