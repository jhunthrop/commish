import { describe, expect, it } from "vitest";
import { VERIFIED_BADGE_LABEL, VERIFIED_BADGE_TOOLTIP, isVerifiedPlayer } from "./verified";

describe("isVerifiedPlayer", () => {
  it("is false below the cutoff, true at it and above it", () => {
    expect(isVerifiedPlayer(0, 1)).toBe(false);
    expect(isVerifiedPlayer(1, 1)).toBe(true);
    expect(isVerifiedPlayer(2, 1)).toBe(true);
  });

  it("refuses a negative count rather than classifying it", () => {
    expect(() => isVerifiedPlayer(-1, 1)).toThrow(/completedSeasons/);
  });
});

describe("VERIFIED_BADGE_LABEL and VERIFIED_BADGE_TOOLTIP", () => {
  it("states the claim rather than implying a broader one", () => {
    expect(VERIFIED_BADGE_LABEL).toBe("Verified");
    expect(VERIFIED_BADGE_TOOLTIP).toBe("This reviewer finished at least one full season on Commish.");
  });
});
