import { describe, expect, it } from "vitest";
import { assertGradableMoment } from "./scorecard";

/**
 * TASK 2 — AUDIT (c): "A LIVE BOARD MUST BE STRUCTURALLY UNGRADEABLE."
 *
 * `market-edge-scorecard.ts` and `preseason-report.ts` both score a board against ACTUAL outcomes
 * for a season that has already been played. A board taken at a LIVE moment is a claim about a
 * season that has NOT been played yet — there is no actual outcome to score it against, and grading
 * one anyway would silently produce a meaningless number rather than an honest refusal. This is the
 * scorecard path's own half of the guard `source.ts`'s live-arm read guard establishes on the load
 * side: `assertGradableMoment` is called once, at the top of every grading run
 * (`scripts/market-edge-scorecard.ts`'s own main loop), before a single board is scored.
 */
describe("assertGradableMoment", () => {
  it("REFUSES a live row with a clear message naming the guard", () => {
    expect(() => assertGradableMoment("live", 2026)).toThrow(/live/i);
    expect(() => assertGradableMoment("live", 2026)).toThrow(/2026/);
  });

  it("does not throw for a replay row — the only kind the scorecard has ever graded", () => {
    expect(() => assertGradableMoment("replay", 2024)).not.toThrow();
  });
});
