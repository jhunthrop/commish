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
    const allKeys = [...numericKeys, "emptyCellBorderClass"] as const;
    expect(Object.keys(DRAFT_ROOM_CONFIG).sort()).toEqual([...allKeys].sort());
    for (const key of numericKeys) {
      expect(Number.isFinite(DRAFT_ROOM_CONFIG[key])).toBe(true);
      expect(DRAFT_ROOM_CONFIG[key]).toBeGreaterThan(0);
    }
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
