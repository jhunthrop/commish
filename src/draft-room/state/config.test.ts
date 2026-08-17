import { describe, it, expect } from "vitest";
import { DRAFT_ROOM_CONFIG } from "./config";

/**
 * `config.ts` is a bare object literal — no functions, no branches. This smoke test is the
 * "imports it and asserts its exports exist" case `vitest.config.mts` calls out for a file
 * with no logic of its own: without it, the 100%-gated `src/draft-room/state/**` directory
 * would report this file uncovered (0/0 would trivially pass a threshold, but v8 still
 * counts the literal's own statement/line as unexecuted until something imports it).
 */
describe("DRAFT_ROOM_CONFIG", () => {
  it("defines every tunable the draft room uses", () => {
    expect(DRAFT_ROOM_CONFIG).toEqual({
      countdownTickMs: 1_000,
      poolPageSize: 60,
      celebrationMs: 2_400,
    });
  });
});
