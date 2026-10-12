import { describe, expect, it } from "vitest";
import { HALF_PPR_SCORING, PPR_SCORING, SCORING_PRESETS, STANDARD_SCORING, TE_PREMIUM_SCORING } from "@research-ts/domain/scoring";
import { scoringHashOf } from "./hash";

describe("scoringHashOf", () => {
  it("does not depend on key order", () => {
    const reversed = Object.fromEntries(Object.entries(PPR_SCORING).reverse()) as typeof PPR_SCORING;
    expect(scoringHashOf(reversed)).toBe(scoringHashOf(PPR_SCORING));
  });

  it("ignores a leagueId that rides along", () => {
    expect(scoringHashOf({ ...PPR_SCORING, leagueId: "league_a" })).toBe(scoringHashOf({ ...PPR_SCORING, leagueId: "league_b" }));
    expect(scoringHashOf({ ...PPR_SCORING, leagueId: "league_a" })).toBe(scoringHashOf(PPR_SCORING));
  });

  it("moves when any weight moves", () => {
    expect(scoringHashOf({ ...PPR_SCORING, pointsPerReception: 0.9 })).not.toBe(scoringHashOf(PPR_SCORING));
    expect(scoringHashOf({ ...PPR_SCORING, pointsPerSafety: 3 })).not.toBe(scoringHashOf(PPR_SCORING));
    expect(scoringHashOf({ ...PPR_SCORING, teReceptionBonus: 0.25 })).not.toBe(scoringHashOf(PPR_SCORING));
  });

  it("collapses the four presets to four hashes and no fewer", () => {
    const hashes = new Set(Object.values(SCORING_PRESETS).map((preset) => scoringHashOf(preset)));
    expect(hashes.size).toBe(4);
    expect(scoringHashOf(STANDARD_SCORING)).not.toBe(scoringHashOf(HALF_PPR_SCORING));
    expect(scoringHashOf(PPR_SCORING)).not.toBe(scoringHashOf(TE_PREMIUM_SCORING));
  });

  it("is a stable hex digest", () => {
    expect(scoringHashOf(PPR_SCORING)).toMatch(/^[0-9a-f]{64}$/);
    expect(scoringHashOf(PPR_SCORING)).toBe(scoringHashOf(PPR_SCORING));
  });

  it("refuses a rule set that is missing a weight rather than hashing an absence", () => {
    const missing = { ...PPR_SCORING } as Record<string, unknown>;
    delete missing.pointsPerSafety;
    expect(() => scoringHashOf(missing as never)).toThrow(/pointsPerSafety/);
  });
});
