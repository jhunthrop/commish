import { describe, it, expect } from "vitest";
import { DRAFT_ROOM_CONFIG } from "./config";

/**
 * `config.ts` is a bare object literal — no functions, no branches. This smoke test is the
 * "imports it and asserts its exports exist" case `vitest.config.mts` calls out for a file
 * with no logic of its own: without it, the 100%-gated `src/draft-room/state/**` directory
 * would report this file uncovered (0/0 would trivially pass a threshold, but v8 still
 * counts the literal's own statement/line as unexecuted until something imports it).
 *
 * Asserts the SHAPE (every tunable a hook/component might read, each a positive number), not
 * the literal values — a value tweak (e.g. a shorter celebration) shouldn't require touching
 * this test.
 */
describe("DRAFT_ROOM_CONFIG", () => {
  it("defines every tunable as a positive number", () => {
    const keys: readonly (keyof typeof DRAFT_ROOM_CONFIG)[] = ["countdownTickMs", "poolPageSize", "celebrationMs"];
    expect(Object.keys(DRAFT_ROOM_CONFIG).sort()).toEqual([...keys].sort());
    for (const key of keys) {
      expect(Number.isFinite(DRAFT_ROOM_CONFIG[key])).toBe(true);
      expect(DRAFT_ROOM_CONFIG[key]).toBeGreaterThan(0);
    }
  });
});
