import { describe, it, expect } from "vitest";
import {
  computeFantasyPoints,
  roundPoints,
  scoreLineup,
  SCORING_PRESETS,
  STANDARD_SCORING,
  PPR_SCORING,
  HALF_PPR_SCORING,
  TE_PREMIUM_SCORING,
} from "./index";

// Pure re-export files (index.ts, presets.ts) are never imported by compute.test.ts,
// so v8 never instruments them. This test exercises the barrel so those files are
// covered rather than silently excluded from the coverage report (Controller Ruling R2).
describe("scoring barrel exports", () => {
  it("re-exports the compute functions", () => {
    expect(typeof computeFantasyPoints).toBe("function");
    expect(typeof scoreLineup).toBe("function");
  });

  it("re-exports all scoring presets", () => {
    expect(STANDARD_SCORING).toBeDefined();
    expect(PPR_SCORING).toBeDefined();
    expect(HALF_PPR_SCORING).toBeDefined();
    expect(TE_PREMIUM_SCORING).toBeDefined();
  });

  it("re-exports the name→rules preset lookup a league stores its choice as", () => {
    expect(SCORING_PRESETS).toEqual({
      standard: STANDARD_SCORING,
      ppr: PPR_SCORING,
      half_ppr: HALF_PPR_SCORING,
      te_premium: TE_PREMIUM_SCORING,
    });
  });

  it("re-exports the one rounding rule, so standings can share it", () => {
    expect(roundPoints(0.1 + 0.2)).toBe(0.3);
    expect(roundPoints(12.345)).toBe(12.35);
    expect(roundPoints(-1.005)).toBe(-1);
  });
});
