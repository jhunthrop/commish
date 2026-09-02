import { describe, expect, it } from "vitest";
import type { DiscoveryQuantityValues } from "../discovery-facts";
import { DISCOVERY_QUANTILES } from "./quantiles";
import {
  computeQuantileTable,
  emitsLevelConditions,
  HIGH_QUANTILE_LEVELS,
  LOW_QUANTILE_LEVELS,
  MIN_QUANTILE_SAMPLE,
  quantileCoverageGaps,
  quantityIdsOf,
  QUANTILE_LEVELS,
  QUANTITY_DEFS,
  renderClaim,
  renderSignedClaim,
  renderTitle,
  roundingForSide,
  sideOf,
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
  incomingTeamWinTotal: null,
  incomingTeamWinTotalDelta: null,
  insideTenTouchShare: null,
  teamAirYardsShare: null,
  gamesPlayed: null,
  draftPick: null,
  pointsPerGame: null,
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

describe("QUANTILE_LEVELS — the two bands (Task 2)", () => {
  it("is the low band then the high band, ascending throughout, with no duplicates", () => {
    expect(QUANTILE_LEVELS).toEqual([...LOW_QUANTILE_LEVELS, ...HIGH_QUANTILE_LEVELS]);
    expect(new Set(QUANTILE_LEVELS).size).toBe(QUANTILE_LEVELS.length);
    expect([...QUANTILE_LEVELS]).toEqual([...QUANTILE_LEVELS].sort((a, b) => a - b));
  });

  it("keeps the three high levels byte-identical to what they were before the low band existed", () => {
    expect(HIGH_QUANTILE_LEVELS).toEqual([0.7, 0.8, 0.9]);
  });

  it("mirrors each low level against a high one at the same distance from its extreme", () => {
    for (let index = 0; index < LOW_QUANTILE_LEVELS.length; index += 1) {
      const low = LOW_QUANTILE_LEVELS[index]!;
      const high = HIGH_QUANTILE_LEVELS[HIGH_QUANTILE_LEVELS.length - 1 - index]!;
      expect(low + high).toBeCloseTo(1, 10);
    }
  });

  it("sideOf names the band every level belongs to, with no level unclassified", () => {
    for (const level of LOW_QUANTILE_LEVELS) expect(sideOf(level)).toBe("low");
    for (const level of HIGH_QUANTILE_LEVELS) expect(sideOf(level)).toBe("high");
  });
});

describe("QUANTITY_DEFS — the Task 2 additions", () => {
  function defFor(id: string) {
    const def = QUANTITY_DEFS.find((entry) => entry.id === id);
    if (def === undefined) throw new Error(`no QuantityDef for "${id}"`);
    return def;
  }

  it("carries the five new quantities, appended after the team-market pair so no committed threshold moves", () => {
    const ids = QUANTITY_DEFS.map((def) => def.id);
    expect(ids.slice(-5)).toEqual(["insideTenTouchShare", "teamAirYardsShare", "gamesPlayed", "draftPick", "pointsPerGame"]);
  });

  it("marks pointsPerGame, and ONLY pointsPerGame, as the matched design's own match key", () => {
    const flagged = QUANTITY_DEFS.filter((def) => def.isMatchKeyQuantity).map((def) => def.id);
    expect(flagged).toEqual(["pointsPerGame"]);
  });

  it("marks gamesPlayed, and ONLY gamesPlayed, as the match key's own reliability", () => {
    // The second exclusion, and a DIFFERENT defect from the first: points per game IS the match key,
    // games played is the denominator it is measured over. Kept as its own flag so the registry says
    // which reason each excluded quantity is excluded for.
    const flagged = QUANTITY_DEFS.filter((def) => def.isMatchKeyReliabilityQuantity).map((def) => def.id);
    expect(flagged).toEqual(["gamesPlayed"]);
  });

  it("bars level conditions for exactly the two quantities the matcher would answer for, and no others", () => {
    const barred = QUANTITY_DEFS.filter((def) => !emitsLevelConditions(def)).map((def) => def.id);
    expect(barred).toEqual(["gamesPlayed", "pointsPerGame"]);
  });

  it("keeps the year-over-year template ON the reliability quantity, which is the whole point of the split", () => {
    expect(defFor("gamesPlayed").supportsYearOverYearDelta).toBe(true);
  });

  it("keeps the year-over-year template off the two quantities it cannot mean anything for", () => {
    const excluded = QUANTITY_DEFS.filter((def) => !def.supportsYearOverYearDelta).map((def) => def.id);
    // A quantity that is itself a difference, and a quantity that is a career constant.
    expect(excluded).toEqual(["incomingTeamWinTotalDelta", "draftPick"]);
  });

  it("keeps the year-over-year template ON the match-key quantity, which is the whole point of the split", () => {
    expect(defFor("pointsPerGame").supportsYearOverYearDelta).toBe(true);
  });

  it("names the direction inside the draft-pick noun, since a bigger pick is a worse one", () => {
    expect(defFor("draftPick").noun).toContain("larger number");
  });
});

describe("quantileCoverageGaps", () => {
  it("reports nothing for a table carrying every level of every combination it covers", () => {
    const complete: QuantileTable = {
      touches: { RB: Object.fromEntries(QUANTILE_LEVELS.map((level) => [level, level * 100])) },
    };
    expect(quantileCoverageGaps(complete)).toEqual([]);
  });

  it("reports one gap per missing level for a table fitted before the low band existed", () => {
    const highOnly: QuantileTable = { touches: { RB: { 0.7: 100, 0.8: 150, 0.9: 200 } } };
    const gaps = quantileCoverageGaps(highOnly);
    expect(gaps.map((gap) => gap.level).sort((a, b) => a - b)).toEqual([...LOW_QUANTILE_LEVELS]);
    for (const gap of gaps) expect(gap).toMatchObject({ quantityId: "touches", position: "RB" });
  });

  it("stays silent about a (quantity, position) the table covers at NO level — that is the sample floor, not a stale table", () => {
    const highOnly: QuantileTable = { touches: { RB: { 0.7: 100, 0.8: 150, 0.9: 200 } } };
    // `age` is eligible for all four positions and absent entirely; not one of its combinations is a gap.
    expect(quantileCoverageGaps(highOnly).some((gap) => gap.quantityId === "age")).toBe(false);
  });

  it("finds NOTHING in the real committed table, because the refit has been run", () => {
    // Inverted deliberately (2026-09-01, Task 3 stage 3). While the grammar carried a low band and
    // the committed table did not, this asserted the gap existed and named the three missing levels;
    // that was the visible half of a KNOWN stale table, and `discover-laws.ts` printed the same fact
    // above its summary. `npm run laws:discover:quantiles` has since refitted the table on the
    // extended train window, so every (quantity, position) it covers is covered at all six levels.
    // A gap reappearing here means the table is behind the grammar again, which is exactly the
    // silent family-shrink this function exists to make loud.
    expect(quantileCoverageGaps(DISCOVERY_QUANTILES)).toEqual([]);
  });
});

describe("renderClaim — the low band", () => {
  it("says BOTTOM rather than top, at the same percentage its mirrored high level says", () => {
    const low = renderClaim({ position: "RB", clause: { kind: "threshold", quantityId: "incomingTeamWinTotal", quantileLevel: 0.2 } });
    const high = renderClaim({ position: "RB", clause: { kind: "threshold", quantityId: "incomingTeamWinTotal", quantileLevel: 0.8 } });
    expect(low).toContain("is in the bottom 20% of running backs");
    expect(high).toContain("is in the top 20% of running backs");
  });

  it("states the founder's collapse hypothesis in plain words, on the win total and on its delta", () => {
    const winTotal = renderClaim({ position: "RB", clause: { kind: "threshold", quantityId: "incomingTeamWinTotal", quantileLevel: 0.1 } });
    expect(winTotal).toBe(
      "A running back whose team's Vegas win total for the season ahead is in the bottom 10% of running backs scores differently in points per game the following season.",
    );
    const delta = renderClaim({ position: "RB", clause: { kind: "threshold", quantityId: "incomingTeamWinTotalDelta", quantileLevel: 0.1 } });
    expect(delta).toContain(
      "team's Vegas win total for the season ahead minus its actual wins in the season just played is in the bottom 10% of running backs",
    );
  });

  it("reads a fall INTO the bottom band and a rise OUT of it, never the high band's wording", () => {
    const fell = renderClaim({ position: "WR", clause: { kind: "delta", quantityId: "targetShare", quantileLevel: 0.2, direction: "fell_out_of" } });
    const rose = renderClaim({ position: "WR", clause: { kind: "delta", quantityId: "targetShare", quantileLevel: 0.2, direction: "rose_into" } });
    expect(fell).toContain("fell into the bottom 20% of wide receivers after being above it the year before");
    expect(rose).toContain("climbed out of the bottom 20% of wide receivers after being in it the year before");
  });

  it("keeps the high band's own delta wording byte-identical (the low band is additive, not a rewrite)", () => {
    const rose = renderClaim({ position: "WR", clause: { kind: "delta", quantityId: "targetShare", quantileLevel: 0.7, direction: "rose_into" } });
    const fell = renderClaim({ position: "WR", clause: { kind: "delta", quantityId: "targetShare", quantileLevel: 0.7, direction: "fell_out_of" } });
    expect(rose).toContain("climbed into the top 30% of wide receivers after being below it the year before");
    expect(fell).toContain("fell out of the top 30% of wide receivers after being in it the year before");
  });

  it("renders the production-conditional quantity as ordinary plain words", () => {
    const claim = renderClaim({ position: "RB", clause: { kind: "delta", quantityId: "pointsPerGame", quantileLevel: 0.8, direction: "rose_into" } });
    expect(claim).toBe(
      "A running back whose points per game that season climbed into the top 20% of running backs after being below it the year before scores differently in points per game the following season.",
    );
  });

  it("never emits an em-dash, on either band, for any clause kind", () => {
    const parts: readonly ClaimParts[] = [
      { position: "QB", clause: { kind: "threshold", quantityId: "gamesPlayed", quantileLevel: 0.1 } },
      { position: "TE", clause: { kind: "delta", quantityId: "insideTenTouchShare", quantileLevel: 0.3, direction: "fell_out_of" } },
      { position: "WR", clause: { kind: "delta", quantityId: "pointsPerGame", quantileLevel: 0.2, direction: "rose_into" } },
      { position: "QB", clause: { kind: "threshold", quantityId: "draftPick", quantileLevel: 0.9 } },
      {
        position: "RB",
        clause: {
          kind: "and",
          left: { kind: "threshold", quantityId: "teamAirYardsShare", quantileLevel: 0.2 },
          right: { kind: "threshold", quantityId: "touches", quantileLevel: 0.1 },
        },
      },
    ];
    for (const claimParts of parts) expect(renderClaim(claimParts)).not.toMatch(/—/);
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

describe("renderSignedClaim — the low band (Task 2)", () => {
  const QUANTILES: QuantileTable = {
    incomingTeamWinTotal: { RB: { 0.1: 6.44, 0.2: 7.5, 0.3: 8, 0.7: 9, 0.8: 9.5, 0.9: 10.5 } },
    touches: { RB: { 0.1: 12.6, 0.2: 30, 0.3: 55, 0.7: 100, 0.8: 150, 0.9: 200 } },
    pointsPerGame: { RB: { 0.1: 3.04, 0.2: 5.5, 0.3: 7, 0.7: 12, 0.8: 14.5, 0.9: 17 } },
  };

  it("says 'or less', with the threshold rounded DOWN so the words never admit a player the predicate rejects", () => {
    const parts: ClaimParts = { position: "RB", clause: { kind: "threshold", quantityId: "incomingTeamWinTotal", quantileLevel: 0.1 } };
    const claim = renderSignedClaim(parts, -1, QUANTILES);
    expect(claim).toContain("team's Vegas win total for the season ahead is 6.4 or less");
    expect(claim).not.toContain("or more");
    // 6.5 would have been the "nearest" rendering and would have admitted a team at 6.5 that 6.5 <= 6.44 rejects.
    expect(claim).not.toContain("6.5");
  });

  it("keeps the high band's 'or more' on the same quantity, with the threshold rounded UP", () => {
    const parts: ClaimParts = { position: "RB", clause: { kind: "threshold", quantityId: "incomingTeamWinTotal", quantileLevel: 0.9 } };
    expect(renderSignedClaim(parts, 1, QUANTILES)).toContain("team's Vegas win total for the season ahead is 10.5 or more");
  });

  it("renders the low band's two crossings with the band's own comparison on both halves of the sentence", () => {
    const fell: ClaimParts = { position: "RB", clause: { kind: "delta", quantityId: "touches", quantileLevel: 0.1, direction: "fell_out_of" } };
    const rose: ClaimParts = { position: "RB", clause: { kind: "delta", quantityId: "touches", quantileLevel: 0.1, direction: "rose_into" } };
    expect(renderSignedClaim(fell, -1, QUANTILES)).toContain(
      "combined carries and receptions that season fell to 12 or less after being above that mark the season before",
    );
    expect(renderSignedClaim(rose, 1, QUANTILES)).toContain(
      "combined carries and receptions that season rose above 12 after being at or below that mark the season before",
    );
  });

  it("prints ONE number per clause, never two roundings of one fitted threshold in a single sentence", () => {
    const fell: ClaimParts = { position: "RB", clause: { kind: "delta", quantityId: "touches", quantileLevel: 0.1, direction: "fell_out_of" } };
    const numbers = renderSignedClaim(fell, -1, QUANTILES).match(/\d+(\.\d+)?/g) ?? [];
    expect(new Set(numbers).size).toBe(1);
  });

  it("renders the production-conditional crossing with a real value and a committed sign", () => {
    const rose: ClaimParts = { position: "RB", clause: { kind: "delta", quantityId: "pointsPerGame", quantileLevel: 0.8, direction: "rose_into" } };
    expect(renderSignedClaim(rose, -1, QUANTILES)).toBe(
      "Running back points per game (14.5): A running back whose points per game that season rose to 14.5 or more after being below that mark the season before loses points per game the following season.",
    );
  });

  it("never emits an em-dash on the low band either", () => {
    const parts: ClaimParts = { position: "RB", clause: { kind: "threshold", quantityId: "incomingTeamWinTotal", quantileLevel: 0.2 } };
    expect(renderSignedClaim(parts, -1, QUANTILES)).not.toMatch(/—/);
  });

  it("throws on a level the table has not been refitted for, rather than rendering a guess", () => {
    const staleTable: QuantileTable = { touches: { RB: { 0.7: 100, 0.8: 150, 0.9: 200 } } };
    const lowSide: ClaimParts = { position: "RB", clause: { kind: "threshold", quantityId: "touches", quantileLevel: 0.2 } };
    expect(() => renderSignedClaim(lowSide, -1, staleTable)).toThrow(/no committed quantile for touches\/RB\/0\.2/);
  });
});

describe("renderTitle — the low band", () => {
  const QUANTILES: QuantileTable = {
    incomingTeamWinTotal: { RB: { 0.1: 6.44, 0.2: 7.5, 0.3: 8, 0.7: 9, 0.8: 9.5, 0.9: 10.5 } },
  };

  it("carries the band's comparison into the heading, so a low and a high candidate can never read alike", () => {
    const low: ClaimParts = { position: "RB", clause: { kind: "threshold", quantityId: "incomingTeamWinTotal", quantileLevel: 0.3 } };
    const high: ClaimParts = { position: "RB", clause: { kind: "threshold", quantityId: "incomingTeamWinTotal", quantileLevel: 0.7 } };
    expect(renderTitle(low, QUANTILES)).toBe("Running back incoming team win total (8.0 or less)");
    expect(renderTitle(high, QUANTILES)).toBe("Running back incoming team win total (9.0)");
    expect(renderTitle(low, QUANTILES)).not.toBe(renderTitle(high, QUANTILES));
  });

  it("still emits no colon and no em-dash", () => {
    const low: ClaimParts = { position: "RB", clause: { kind: "threshold", quantityId: "incomingTeamWinTotal", quantileLevel: 0.1 } };
    expect(renderTitle(low, QUANTILES)).not.toMatch(/[—:]/);
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
 * NEW-3 (fix round 2), extended to the low band by Task 2 — every `formatValue` must round AWAY from
 * the population its clause admits. On the high band ("threshold or more") the displayed number must
 * itself satisfy `displayed >= threshold`; on the low band ("threshold or less") it must satisfy
 * `displayed <= threshold`. Either way the displayed predicate is never LOOSER than the real one.
 */
describe("formatValue — the band-preserving rounding direction (NEW-3, both bands)", () => {
  function defFor(id: string) {
    const def = QUANTITY_DEFS.find((d) => d.id === id);
    if (def === undefined) throw new Error(`no QuantityDef for "${id}"`);
    return def;
  }

  it("touches: 237.29999999999995 rounds UP to 238 on the high band, never down to 237 (a player with exactly 237 touches does not satisfy >= 237.3)", () => {
    expect(defFor("touches").formatValue(237.29999999999995, "ceil")).toBe("238");
  });

  it("touches: the SAME value rounds DOWN to 237 on the low band (a player with exactly 238 touches does not satisfy <= 237.3)", () => {
    expect(defFor("touches").formatValue(237.29999999999995, "floor")).toBe("237");
  });

  it("touches: an already-exact integer threshold is unchanged in either direction", () => {
    expect(defFor("touches").formatValue(129, "ceil")).toBe("129");
    expect(defFor("touches").formatValue(129, "floor")).toBe("129");
  });

  it("touchdownPointsShare: 19.489% (0.19489) rounds UP to 19.5% on the high band, never down to 19% (a player at 19.2% must not read as satisfying the claim)", () => {
    expect(defFor("touchdownPointsShare").formatValue(0.19489, "ceil")).toBe("19.5%");
  });

  it("touchdownPointsShare: 19.489% rounds DOWN to 19.4% on the low band (a player at 19.45% must not read as satisfying 'or less')", () => {
    expect(defFor("touchdownPointsShare").formatValue(0.19489, "floor")).toBe("19.4%");
  });

  it("age: rounds up at the second decimal on the high band, down on the low one", () => {
    // 26.664750131761778 -> ceil at 2 decimals -> 26.67; floor -> 26.66.
    expect(defFor("age").formatValue(26.664750131761778, "ceil")).toBe("26.67");
    expect(defFor("age").formatValue(26.664750131761778, "floor")).toBe("26.66");
  });

  it("roundingForSide pairs each band with the direction that cannot loosen its own comparison", () => {
    expect(roundingForSide("high")).toBe("ceil");
    expect(roundingForSide("low")).toBe("floor");
  });

  it("property test: for every real committed quantile, the rendered value parsed back never loosens its band's own comparison", () => {
    let checked = 0;
    for (const def of QUANTITY_DEFS) {
      const forQuantity = DISCOVERY_QUANTILES[def.id];
      if (forQuantity === undefined) continue;
      for (const position of Object.keys(forQuantity) as LawPosition[]) {
        const thresholds = forQuantity[position];
        if (thresholds === undefined) continue;
        for (const level of QUANTILE_LEVELS) {
          const threshold = thresholds[level];
          // A level the committed table does not carry yet — see `QuantileThresholds`' own docblock.
          if (threshold === undefined) continue;
          checked += 1;
          const side = sideOf(level);
          const formatted = def.formatValue(threshold, roundingForSide(side));
          const parsedBack = formatted.endsWith("%") ? parseFloat(formatted) / 100 : parseFloat(formatted);
          const message = `${def.id}/${position}/${level} (${side}): formatted "${formatted}" parsed back to ${parsedBack} against threshold ${threshold}`;
          if (side === "high") expect(parsedBack, message).toBeGreaterThanOrEqual(threshold);
          else expect(parsedBack, message).toBeLessThanOrEqual(threshold);
        }
      }
    }
    // The committed table is never empty; a property test that silently checked nothing would pass.
    expect(checked).toBeGreaterThan(0);
  });

  it("property test, SYNTHETIC low band: the same guarantee holds on deliberately awkward values", () => {
    // The property above now checks real low-band thresholds too (the committed table was refitted on
    // 2026-09-01), but a fitted percentile is a tame number and can round cleanly by luck. These are
    // the same quantities with values chosen to be nasty for each formatter, one per formatter, so
    // the low band's floor rounding is exercised whatever the committed table happens to hold.
    const awkward: readonly (readonly [string, number])[] = [
      ["touches", 84.7],
      ["age", 23.4449],
      ["targetShare", 0.031415],
      ["incomingTeamWinTotal", 6.44],
      ["pointsPerGame", 4.06],
    ];
    for (const [id, threshold] of awkward) {
      const formatted = defFor(id).formatValue(threshold, "floor");
      const parsedBack = formatted.endsWith("%") ? parseFloat(formatted) / 100 : parseFloat(formatted);
      expect(parsedBack, `${id}: "${formatted}" parsed back to ${parsedBack}, above threshold ${threshold}`).toBeLessThanOrEqual(threshold);
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
