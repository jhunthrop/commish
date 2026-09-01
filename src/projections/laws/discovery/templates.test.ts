import { describe, expect, it } from "vitest";
import type { DiscoveryQuantityValues } from "../discovery-facts";
import { DISCOVERY_QUANTILES } from "./quantiles";
import {
  computeQuantileTable,
  MIN_QUANTILE_SAMPLE,
  quantityIdsOf,
  QUANTILE_LEVELS,
  QUANTITY_DEFS,
  renderClaim,
  renderSignedClaim,
  renderTitle,
  type ClaimParts,
  type QuantileTable,
  type QuantityRow,
} from "./templates";
import type { LawPosition } from "../populations";

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
  // Not the real committed `DISCOVERY_QUANTILES` — see `generate.ts`'s own docblock for why the
  // renderer is tested against a synthetic table: this is about the RENDERING mechanism, never about
  // what a real fit happened to measure the last time someone ran it.
  const QUANTILES: QuantileTable = {
    touches: { RB: { 0.7: 100, 0.8: 150, 0.9: 200 } },
    age: { RB: { 0.7: 27, 0.8: 28, 0.9: 30 } },
    targetShare: { WR: { 0.7: 0.15, 0.8: 0.19, 0.9: 0.23 } },
  };
  const parts: ClaimParts = {
    position: "RB",
    clause: { kind: "threshold", quantityId: "touches", quantileLevel: 0.8 },
  };

  it("renders the real committed threshold value, never a quantile percentage", () => {
    const claim = renderSignedClaim(parts, -1, QUANTILES);
    expect(claim).toContain("combined carries and receptions that season is 150 or more");
    expect(claim).not.toContain("%");
    expect(claim).not.toContain("top");
  });

  it("prefixes a mechanical 'Title (value): ' the same way a hand-authored tribal claim does, for splitClaim to colon-split", () => {
    const claim = renderSignedClaim(parts, -1, QUANTILES);
    expect(claim.startsWith("Running back carries and receptions (150): ")).toBe(true);
  });

  it("commits to 'loses' for a negative sign", () => {
    expect(renderSignedClaim(parts, -1, QUANTILES)).toBe(
      "Running back carries and receptions (150): A running back whose combined carries and receptions that season is 150 or more loses points per game the following season.",
    );
  });

  it("commits to 'gains' for a positive sign", () => {
    expect(renderSignedClaim(parts, 1, QUANTILES)).toBe(
      "Running back carries and receptions (150): A running back whose combined carries and receptions that season is 150 or more gains points per game the following season.",
    );
  });

  it("renders a delta clause's rise/fall wording with the real value, not a percentage", () => {
    const rose: ClaimParts = { position: "WR", clause: { kind: "delta", quantityId: "targetShare", quantileLevel: 0.7, direction: "rose_into" } };
    const fell: ClaimParts = { position: "WR", clause: { kind: "delta", quantityId: "targetShare", quantileLevel: 0.7, direction: "fell_out_of" } };
    // Percent renders at one decimal (fix round 2, NEW-3) — "15.0%", not "15%".
    expect(renderSignedClaim(rose, 1, QUANTILES)).toContain(
      "share of his team's targets that season rose to 15.0% or more after being below that mark the season before",
    );
    expect(renderSignedClaim(fell, -1, QUANTILES)).toContain(
      "share of his team's targets that season fell below 15.0% after being at or above that mark the season before",
    );
  });

  it("joins an AND clause's two halves with 'and whose', each stating its own value", () => {
    const and: ClaimParts = {
      position: "RB",
      clause: {
        kind: "and",
        left: { kind: "threshold", quantityId: "touches", quantileLevel: 0.9 },
        right: { kind: "threshold", quantityId: "age", quantileLevel: 0.7 },
      },
    };
    const claim = renderSignedClaim(and, -1, QUANTILES);
    // Age renders at two decimals (fix round 2, NEW-3) — "27.00", not "27.0".
    expect(claim).toContain(
      "combined carries and receptions that season is 200 or more and whose age at that season's opener is 27.00 or more",
    );
  });

  it("throws when the quantile table has no entry for the clause's own (quantity, position, level) — table and candidate have drifted", () => {
    const missing: ClaimParts = { position: "TE", clause: { kind: "threshold", quantityId: "touches", quantileLevel: 0.8 } };
    expect(() => renderSignedClaim(missing, -1, QUANTILES)).toThrow(/no committed quantile for touches\/TE\/0\.8/);
  });

  it("never emits an em-dash", () => {
    expect(renderSignedClaim(parts, -1, QUANTILES)).not.toMatch(/—/);
    expect(renderSignedClaim(parts, 1, QUANTILES)).not.toMatch(/—/);
  });
});

describe("renderTitle", () => {
  const QUANTILES: QuantileTable = {
    touches: { RB: { 0.7: 100, 0.8: 150, 0.9: 200 } },
    age: { RB: { 0.7: 27, 0.8: 28, 0.9: 30 } },
    targetShare: { WR: { 0.7: 0.15, 0.8: 0.19, 0.9: 0.23 } },
  };

  it("names position + quantity short label + real value for a single clause", () => {
    const parts: ClaimParts = { position: "RB", clause: { kind: "threshold", quantityId: "touches", quantileLevel: 0.8 } };
    expect(renderTitle(parts, QUANTILES)).toBe("Running back carries and receptions (150)");
  });

  it("joins two short labels, each with its own value, with '+' for an AND clause", () => {
    const parts: ClaimParts = {
      position: "RB",
      clause: {
        kind: "and",
        left: { kind: "threshold", quantityId: "touches", quantileLevel: 0.9 },
        right: { kind: "threshold", quantityId: "age", quantileLevel: 0.7 },
      },
    };
    expect(renderTitle(parts, QUANTILES)).toBe("Running back carries and receptions (200) + age (27.00)");
  });

  it("never emits an em-dash or a colon (it is meant to be the half BEFORE splitClaim's colon)", () => {
    const parts: ClaimParts = { position: "WR", clause: { kind: "threshold", quantityId: "targetShare", quantileLevel: 0.9 } };
    expect(renderTitle(parts, QUANTILES)).not.toMatch(/[—:]/);
  });

  it("FIX ROUND 2 — gives two candidates sharing a quantity at different quantile levels distinct titles, never byte-identical", () => {
    const lower: ClaimParts = { position: "RB", clause: { kind: "threshold", quantityId: "touches", quantileLevel: 0.7 } };
    const higher: ClaimParts = { position: "RB", clause: { kind: "threshold", quantityId: "touches", quantileLevel: 0.9 } };
    expect(renderTitle(lower, QUANTILES)).not.toBe(renderTitle(higher, QUANTILES));
  });
});

describe("quantityIdsOf (NESTING RULING, fix round 2)", () => {
  it("returns a single-element set for a threshold clause", () => {
    const clause: ClaimParts["clause"] = { kind: "threshold", quantityId: "touches", quantileLevel: 0.8 };
    expect(quantityIdsOf(clause)).toEqual(new Set(["touches"]));
  });

  it("returns a single-element set for a delta clause", () => {
    const clause: ClaimParts["clause"] = { kind: "delta", quantityId: "age", quantileLevel: 0.7, direction: "rose_into" };
    expect(quantityIdsOf(clause)).toEqual(new Set(["age"]));
  });

  it("unions both halves of an AND clause, deduplicated", () => {
    const clause: ClaimParts["clause"] = {
      kind: "and",
      left: { kind: "threshold", quantityId: "touches", quantileLevel: 0.9 },
      right: { kind: "threshold", quantityId: "age", quantileLevel: 0.7 },
    };
    expect(quantityIdsOf(clause)).toEqual(new Set(["touches", "age"]));
  });

  it("collapses an AND of the SAME quantity at two levels to a single-element set (never happens in practice — generate.ts's own pruning rule — but the function itself must still be correct)", () => {
    const clause: ClaimParts["clause"] = {
      kind: "and",
      left: { kind: "threshold", quantityId: "age", quantileLevel: 0.7 },
      right: { kind: "threshold", quantityId: "age", quantileLevel: 0.9 },
    };
    expect(quantityIdsOf(clause)).toEqual(new Set(["age"]));
  });
});

/**
 * NEW-3 (fix round 2) — every `formatValue` must round in the `>=`-PRESERVING direction: the
 * displayed number must itself satisfy `displayed >= threshold`, never fall short of it, so
 * "displayed value or more" is never a superset of what the real predicate ("threshold or more")
 * actually includes.
 */
describe("formatValue — the >=-preserving rounding direction (NEW-3)", () => {
  function defFor(id: string) {
    const def = QUANTITY_DEFS.find((d) => d.id === id);
    if (def === undefined) throw new Error(`no QuantityDef for "${id}"`);
    return def;
  }

  it("touches: 237.29999999999995 rounds UP to 238, never down to 237 (a player with exactly 237 touches does not satisfy >= 237.3)", () => {
    expect(defFor("touches").formatValue(237.29999999999995)).toBe("238");
  });

  it("touches: an already-exact integer threshold is unchanged", () => {
    expect(defFor("touches").formatValue(129)).toBe("129");
  });

  it("touchdownPointsShare: 19.489% (0.19489) rounds UP to 19.5%, never down to 19% (a player at 19.2% must not read as satisfying the claim)", () => {
    expect(defFor("touchdownPointsShare").formatValue(0.19489)).toBe("19.5%");
  });

  it("age: rounds up at the second decimal, never down", () => {
    // 26.664750131761778 -> ceil at 2 decimals -> 26.67, never 26.66.
    expect(defFor("age").formatValue(26.664750131761778)).toBe("26.67");
  });

  it("property test: for every real committed quantile in DISCOVERY_QUANTILES, the rendered value parsed back is always >= the raw threshold", () => {
    for (const def of QUANTITY_DEFS) {
      const forQuantity = DISCOVERY_QUANTILES[def.id];
      if (forQuantity === undefined) continue;
      for (const position of Object.keys(forQuantity) as LawPosition[]) {
        const thresholds = forQuantity[position];
        if (thresholds === undefined) continue;
        for (const level of QUANTILE_LEVELS) {
          const threshold = thresholds[level];
          const formatted = def.formatValue(threshold);
          const parsedBack = formatted.endsWith("%") ? parseFloat(formatted) / 100 : parseFloat(formatted);
          expect(parsedBack, `${def.id}/${position}/${level}: formatted "${formatted}" parsed back to ${parsedBack}, below threshold ${threshold}`).toBeGreaterThanOrEqual(
            threshold,
          );
        }
      }
    }
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
