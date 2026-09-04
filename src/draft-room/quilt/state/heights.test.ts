import { describe, expect, it } from "vitest";
import type { QuiltRowKind } from "./board";
import { BOARD_HEIGHTS, planBoardHeights, type HeightPlanInput } from "./heights";

/** A live room's usual shape: round 2 on the clock, one track round ahead, the rest micro. */
const LIVE_KINDS: readonly QuiltRowKind[] = ["micro", "full", "track", ...Array.from({ length: 12 }, (): QuiltRowKind => "micro")];

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
  it("caps every kind at its old max-h ceiling and keeps the manager row full", () => {
    const result = plan(1000);
    expect(result.managerCompact).toBe(false);
    expect(result.rows[1]!.height).toBe(BOARD_HEIGHTS.row.full.max);
    expect(result.rows[2]!.height).toBe(BOARD_HEIGHTS.row.track.max);
    for (const index of [0, 3, 14]) expect(result.rows[index]!.height).toBe(BOARD_HEIGHTS.row.micro.max);
    expect(result.rows.every((row) => row.label)).toBe(true);
  });

  it("gives the active round the biggest share of a partial surplus", () => {
    // Preferred total is 44 + 14×14 = 240; hand the rounds ~90px of surplus.
    const result = plan(560);
    const [micro, full, track] = [result.rows[0]!.height, result.rows[1]!.height, result.rows[2]!.height];
    expect(full).toBeGreaterThan(track);
    expect(track).toBeGreaterThan(micro);
    expect(full).toBeLessThanOrEqual(BOARD_HEIGHTS.row.full.max);
  });

  it("never spends more than the stage it was given", () => {
    for (const height of [1200, 900, 700, 560, 430, 380, 330, 260, 200, 120]) {
      expect(spent(height)).toBeLessThanOrEqual(height + 0.5);
    }
  });
});

describe("planBoardHeights — the degradation ladder", () => {
  // Fixed costs at manager-full: 48 header + 15×6 gaps = 138; preferred rounds need 240 more.
  it("holds every row at its preferred height when the budget exactly covers it", () => {
    const result = plan(378);
    expect(result.managerCompact).toBe(false);
    expect(result.rows[1]!.height).toBeCloseTo(BOARD_HEIGHTS.row.full.preferred, 5);
    expect(result.rows[0]!.height).toBeCloseTo(BOARD_HEIGHTS.row.micro.preferred, 5);
  });

  it("step 1: compacts the manager row before touching the rounds", () => {
    // 370 misses the manager-full budget by 8; compacting the header buys back 20, so every
    // round keeps at least its preferred height (the 12px change waterfills as surplus).
    const result = plan(370);
    expect(result.managerCompact).toBe(true);
    expect(result.rows[1]!.height).toBeGreaterThanOrEqual(BOARD_HEIGHTS.row.full.preferred);
    expect(result.rows[0]!.height).toBeGreaterThanOrEqual(BOARD_HEIGHTS.row.micro.preferred);
    expect(result.rows.every((row) => row.label)).toBe(true);
  });

  it("step 2: squeezes track and micro rows evenly while the active round holds 44, and their labels hide", () => {
    const result = plan(330);
    expect(result.managerCompact).toBe(true);
    const full = result.rows[1]!;
    expect(full.height).toBeCloseTo(BOARD_HEIGHTS.row.full.preferred, 5);
    expect(full.label).toBe(true);
    const others = result.rows.filter((_, index) => index !== 1);
    const first = others[0]!.height;
    for (const row of others) {
      expect(row.height).toBeCloseTo(first, 5);
      expect(row.height).toBeGreaterThanOrEqual(BOARD_HEIGHTS.row.micro.floor);
      expect(row.height).toBeLessThan(BOARD_HEIGHTS.labelMinPx);
      expect(row.label).toBe(false);
    }
  });

  it("step 3: the active round gives ground only after the others reach their floor", () => {
    const result = plan(240);
    const full = result.rows[1]!;
    expect(full.height).toBeLessThan(BOARD_HEIGHTS.row.full.preferred);
    expect(full.height).toBeGreaterThanOrEqual(BOARD_HEIGHTS.row.full.floor);
    for (const row of result.rows.filter((_, index) => index !== 1)) {
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
