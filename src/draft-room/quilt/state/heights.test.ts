import { describe, expect, it } from "vitest";
import type { QuiltRowKind } from "./board";
import { BOARD_HEIGHTS, planBoardHeights, type HeightPlanInput } from "./heights";

/**
 * A live room's usual mid-draft shape under the four-round window (2026-09-03 roster pass):
 * round 5 on the clock, so rounds 2–5 ride full, round 6 is the track ahead, the rest micro.
 * Expectations below are recomputed FROM the constants (spec, "the height math"), never from
 * the code's own output: fixed manager-full spend is 48 header + 15 gaps × 6 = 138, and the
 * preferred rounds total is 4×36 + 11×14 = 298 — an exact-preferred stage of 436.
 */
const LIVE_KINDS: readonly QuiltRowKind[] = ["micro", "full", "full", "full", "full", "track", ...Array.from({ length: 9 }, (): QuiltRowKind => "micro")];
/** The indexes LIVE_KINDS marks full — the window the assertions walk. */
const FULL_INDEXES = [1, 2, 3, 4] as const;

function plan(boardHeight: number, overrides: Partial<HeightPlanInput> = {}) {
  return planBoardHeights({ boardHeight, kinds: LIVE_KINDS, header: "manager", needsRow: false, ...overrides });
}

/** What the plan spends: header + optional needs row + every gap + every row. */
function spent(boardHeight: number, overrides: Partial<HeightPlanInput> = {}): number {
  const input: HeightPlanInput = { boardHeight, kinds: LIVE_KINDS, header: "manager", needsRow: false, ...overrides };
  const result = planBoardHeights(input);
  const headerPx =
    input.header === "codes"
      ? BOARD_HEIGHTS.headerPx.codes
      : result.managerCompact
        ? BOARD_HEIGHTS.headerPx.managerCompact
        : BOARD_HEIGHTS.headerPx.manager;
  const childCount = 1 + (input.needsRow ? 1 : 0) + input.kinds.length;
  return headerPx + (input.needsRow ? BOARD_HEIGHTS.needsRowPx : 0) + (childCount - 1) * BOARD_HEIGHTS.gapPx + result.rows.reduce((total, row) => total + row.height, 0);
}

describe("planBoardHeights — the roomy stage", () => {
  it("caps every kind at its ceiling and keeps the manager row full", () => {
    // Budget 1000 − 138 = 862 clears the cap total 4×56 + 48 + 10×28 = 552.
    const result = plan(1000);
    expect(result.managerCompact).toBe(false);
    for (const index of FULL_INDEXES) expect(result.rows[index]!.height).toBe(BOARD_HEIGHTS.row.full.max);
    expect(result.rows[5]!.height).toBe(BOARD_HEIGHTS.row.track.max);
    for (const index of [0, 6, 14]) expect(result.rows[index]!.height).toBe(BOARD_HEIGHTS.row.micro.max);
    expect(result.rows.every((row) => row.label)).toBe(true);
  });

  it("gives the window's rounds the biggest share of a partial surplus", () => {
    // Budget 422 leaves a 124px surplus over the 298 preferred total; the waterfill weights
    // (full 3, track 2, micro 1) hand each full row 124×3/24 = 15.5.
    const result = plan(560);
    const [micro, full, track] = [result.rows[0]!.height, result.rows[1]!.height, result.rows[5]!.height];
    expect(full).toBeGreaterThan(track);
    expect(track).toBeGreaterThan(micro);
    expect(full).toBeLessThanOrEqual(BOARD_HEIGHTS.row.full.max);
    for (const index of FULL_INDEXES) expect(result.rows[index]!.height).toBeCloseTo(full, 5);
  });

  it("four full rounds, the manager row and the past fit the common stages without degrading", () => {
    // The spec's three-viewport proof: budgets 662 / 762 / 912 all clear the 298 preferred
    // total, so the window never squeezes and the manager row stays full.
    for (const height of [800, 900, 1050]) {
      const result = plan(height);
      expect(result.managerCompact).toBe(false);
      for (const index of FULL_INDEXES) expect(result.rows[index]!.height).toBeGreaterThanOrEqual(BOARD_HEIGHTS.row.full.preferred);
      expect(spent(height)).toBeLessThanOrEqual(height + 0.5);
    }
  });

  it("never spends more than the stage it was given", () => {
    for (const height of [1200, 900, 700, 560, 436, 380, 330, 260, 200, 120]) {
      expect(spent(height)).toBeLessThanOrEqual(height + 0.5);
    }
  });
});

describe("planBoardHeights — the degradation ladder", () => {
  // Fixed costs at manager-full: 48 header + 15×6 gaps = 138; preferred rounds need 298 more.
  it("holds every row at its preferred height when the budget exactly covers it", () => {
    const result = plan(436);
    expect(result.managerCompact).toBe(false);
    for (const index of FULL_INDEXES) expect(result.rows[index]!.height).toBeCloseTo(BOARD_HEIGHTS.row.full.preferred, 5);
    expect(result.rows[0]!.height).toBeCloseTo(BOARD_HEIGHTS.row.micro.preferred, 5);
  });

  it("step 1: compacts the manager row before touching the rounds", () => {
    // 428 misses the manager-full budget by 8; compacting the header buys back 20, so every
    // round keeps at least its preferred height (the 12px change waterfills as surplus).
    const result = plan(428);
    expect(result.managerCompact).toBe(true);
    for (const index of FULL_INDEXES) expect(result.rows[index]!.height).toBeGreaterThanOrEqual(BOARD_HEIGHTS.row.full.preferred);
    expect(result.rows[0]!.height).toBeGreaterThanOrEqual(BOARD_HEIGHTS.row.micro.preferred);
    expect(result.rows.every((row) => row.label)).toBe(true);
  });

  it("step 2: squeezes track and micro rows evenly while the window holds 36, and their labels hide", () => {
    // Compact budget 390 − 118 = 272: the eleven other rows share 272 − 144 = 128 → ~11.64px.
    const result = plan(390);
    expect(result.managerCompact).toBe(true);
    for (const index of FULL_INDEXES) {
      const full = result.rows[index]!;
      expect(full.height).toBeCloseTo(BOARD_HEIGHTS.row.full.preferred, 5);
      expect(full.label).toBe(true);
    }
    const others = result.rows.filter((_, index) => !FULL_INDEXES.includes(index as (typeof FULL_INDEXES)[number]));
    const first = others[0]!.height;
    for (const row of others) {
      expect(row.height).toBeCloseTo(first, 5);
      expect(row.height).toBeGreaterThanOrEqual(BOARD_HEIGHTS.row.micro.floor);
      expect(row.height).toBeLessThan(BOARD_HEIGHTS.labelMinPx);
      expect(row.label).toBe(false);
    }
  });

  it("step 3: the window gives ground only after the others reach their floor", () => {
    // Compact budget 290 − 118 = 172: the others floor at 11×4 = 44 and the four full rows
    // share (172 − 44)/4 = 32 — under preferred, over the 28px readable floor.
    const result = plan(290);
    for (const index of FULL_INDEXES) {
      const full = result.rows[index]!;
      expect(full.height).toBeCloseTo(32, 5);
      expect(full.height).toBeLessThan(BOARD_HEIGHTS.row.full.preferred);
      expect(full.height).toBeGreaterThanOrEqual(BOARD_HEIGHTS.row.full.floor);
    }
    for (const [index, row] of result.rows.entries()) {
      if (FULL_INDEXES.includes(index as (typeof FULL_INDEXES)[number])) continue;
      expect(row.height).toBeCloseTo(BOARD_HEIGHTS.row.micro.floor, 5);
    }
  });

  it("step 4: an absurdly short stage scales every floor proportionally — zero overlap, zero scroll", () => {
    const result = plan(120);
    expect(spent(120)).toBeLessThanOrEqual(120 + 0.5);
    const full = result.rows[1]!;
    for (const row of result.rows) {
      expect(row.height).toBeGreaterThanOrEqual(0);
      expect(row.height).toBeLessThanOrEqual(full.height + 0.001);
    }
  });
});

describe("planBoardHeights — the phone's codes header and the needs row", () => {
  it("the codes header never degrades; a short stage goes straight to the squeeze", () => {
    const kinds = Array.from({ length: 15 }, (): QuiltRowKind => "micro");
    const result = plan(200, { kinds, header: "codes" });
    expect(result.managerCompact).toBe(false);
    expect(result.rows.every((row) => row.height >= BOARD_HEIGHTS.row.micro.floor)).toBe(true);
    expect(spent(200, { kinds, header: "codes" })).toBeLessThanOrEqual(200 + 0.5);
  });

  it("the needs row's fixed height and extra gap come out of the rounds' budget", () => {
    const withNeeds = plan(560, { needsRow: true });
    const without = plan(560);
    expect(withNeeds.rows[1]!.height).toBeLessThan(without.rows[1]!.height);
    expect(spent(560, { needsRow: true })).toBeLessThanOrEqual(560 + 0.5);
  });
});
