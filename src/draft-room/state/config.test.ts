import { describe, it, expect } from "vitest";
import { DRAFT_ROOM_CONFIG } from "./config";

/**
 * `config.ts` is a bare object literal — no functions, no branches. This smoke test is the
 * "imports it and asserts its exports exist" case `vitest.config.mts` calls out for a file
 * with no logic of its own: without it, the 100%-gated `src/draft-room/state/**` directory
 * would report this file uncovered (0/0 would trivially pass a threshold, but v8 still
 * counts the literal's own statement/line as unexecuted until something imports it).
 *
 * Asserts the SHAPE (every tunable a hook/component might read, each a positive number, plus
 * the one non-numeric tunable's own shape), not the literal values — a value tweak (e.g. a
 * shorter celebration) shouldn't require touching this test.
 */
describe("DRAFT_ROOM_CONFIG", () => {
  it("defines every numeric tunable as a positive number", () => {
    const numericKeys: readonly (keyof typeof DRAFT_ROOM_CONFIG)[] = ["poolPageSize", "celebrationMs"];
    const allKeys = [...numericKeys, "emptyCellBorderClass", "wire", "tv", "verdict"] as const;
    expect(Object.keys(DRAFT_ROOM_CONFIG).sort()).toEqual([...allKeys].sort());
    for (const key of numericKeys) {
      expect(Number.isFinite(DRAFT_ROOM_CONFIG[key])).toBe(true);
      expect(DRAFT_ROOM_CONFIG[key]).toBeGreaterThan(0);
    }
  });

  // `PickWire`'s own tunable: a positive item count, or the band silently shows nothing (0)
  // or an unbounded history (a negative/non-finite cap would never trim).
  it("caps the pick wire at a positive number of items", () => {
    expect(Number.isFinite(DRAFT_ROOM_CONFIG.wire.maxItems)).toBe(true);
    expect(DRAFT_ROOM_CONFIG.wire.maxItems).toBeGreaterThan(0);
  });

  // Task 2 (review E5/E7): the TV's own tunables — the ms threshold the spotlight clock goes
  // hot at, and how many rounds past the active one the board still draws before collapsing
  // the rest into one summary line. Both positive, or the rule they gate never fires (a
  // zero/negative threshold never goes hot; a zero/negative round count collapses everything,
  // including the active round).
  it("defines the TV's own hot-threshold and future-rounds-shown as positive numbers", () => {
    expect(Number.isFinite(DRAFT_ROOM_CONFIG.tv.hotThresholdMs)).toBe(true);
    expect(DRAFT_ROOM_CONFIG.tv.hotThresholdMs).toBeGreaterThan(0);
    expect(Number.isFinite(DRAFT_ROOM_CONFIG.tv.futureRoundsShown)).toBe(true);
    expect(DRAFT_ROOM_CONFIG.tv.futureRoundsShown).toBeGreaterThan(0);
  });

  // Task 7 (the fun pass): the even band has to be a positive count of picks, or every pick in
  // every room becomes a verdict — a zero band makes "took him one slot early" a reach, which is
  // the manufactured judgement the band exists to prevent.
  it("keeps the verdict's even band a positive number of picks", () => {
    expect(Number.isFinite(DRAFT_ROOM_CONFIG.verdict.evenBandPicks)).toBe(true);
    expect(DRAFT_ROOM_CONFIG.verdict.evenBandPicks).toBeGreaterThan(0);
  });

  // `DraftBoard`'s empty-cell recede: a future round's border may shrink, never dim past
  // `border-line`'s own decorative-hairline contrast (see `config.ts`'s own docblock for the
  // founder-reported defect this floor fixes).
  it("floors both empty-cell border classes at border-line, never a diluted border-line/NN", () => {
    const { emptyCellBorderClass } = DRAFT_ROOM_CONFIG;
    for (const value of Object.values(emptyCellBorderClass)) {
      expect(value).toMatch(/(?:^|\s)border-line(?:\s|$)/);
      expect(value).not.toMatch(/border-line\//);
    }
    // The two classes differ only by height — the recede is shape, never color.
    expect(emptyCellBorderClass.future).not.toBe(emptyCellBorderClass.near);
  });
});
