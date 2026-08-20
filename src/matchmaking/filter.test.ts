import { describe, it, expect } from "vitest";
import { MATCHMAKING_CONFIG } from "./config";
import type { PublicLeagueSummary } from "./contract";
import {
  EMPTY_BROWSE_FILTER,
  hasOpenSeat,
  matchesBrowseFilter,
  normalizeBrowseFilter,
  stakeTierLabel,
} from "./filter";

const league = (over: Partial<PublicLeagueSummary> = {}): PublicLeagueSummary => ({
  id: "l1",
  name: "Rookie Snake Room",
  format: "snake",
  experienceTier: "beginner",
  stakeTier: 0,
  teamCount: 12,
  filledTeams: 8,
  scoringLabel: "Standard",
  ...over,
});

describe("normalizeBrowseFilter", () => {
  it("reads every supported value off a query string", () => {
    expect(normalizeBrowseFilter({ format: "auction", experienceTier: "experienced", stakeTier: "2" })).toEqual({
      format: "auction",
      experienceTier: "experienced",
      stakeTier: 2,
    });
  });

  it("treats absent params as no narrowing at all", () => {
    expect(normalizeBrowseFilter({})).toEqual(EMPTY_BROWSE_FILTER);
    expect(normalizeBrowseFilter({ format: null, experienceTier: null, stakeTier: null })).toEqual(EMPTY_BROWSE_FILTER);
    expect(normalizeBrowseFilter({ format: "", experienceTier: "", stakeTier: "" })).toEqual(EMPTY_BROWSE_FILTER);
  });

  it("normalizes a format the draft engine cannot run to 'any' rather than erroring", () => {
    // Browse is a public read reached by hand-edited URLs and stale bookmarks. The honest
    // answer to ?format=dynasty is the unfiltered list, not a 400.
    expect(normalizeBrowseFilter({ format: "dynasty" }).format).toBe(MATCHMAKING_CONFIG.anyValue);
    expect(normalizeBrowseFilter({ format: "best_ball" }).format).toBe(MATCHMAKING_CONFIG.anyValue);
  });

  it("normalizes junk in every other field too", () => {
    expect(normalizeBrowseFilter({ experienceTier: "wizard" }).experienceTier).toBe(MATCHMAKING_CONFIG.anyValue);
    expect(normalizeBrowseFilter({ stakeTier: "9" }).stakeTier).toBe(MATCHMAKING_CONFIG.anyValue);
    expect(normalizeBrowseFilter({ stakeTier: "1.5" }).stakeTier).toBe(MATCHMAKING_CONFIG.anyValue);
    expect(normalizeBrowseFilter({ stakeTier: "not-a-number" }).stakeTier).toBe(MATCHMAKING_CONFIG.anyValue);
  });
});

describe("matchesBrowseFilter", () => {
  it("keeps everything when nothing is narrowed", () => {
    expect(matchesBrowseFilter(league(), EMPTY_BROWSE_FILTER)).toBe(true);
  });

  it("narrows on format", () => {
    expect(matchesBrowseFilter(league(), { ...EMPTY_BROWSE_FILTER, format: "snake" })).toBe(true);
    expect(matchesBrowseFilter(league(), { ...EMPTY_BROWSE_FILTER, format: "auction" })).toBe(false);
  });

  it("narrows on experience tier", () => {
    expect(matchesBrowseFilter(league(), { ...EMPTY_BROWSE_FILTER, experienceTier: "beginner" })).toBe(true);
    expect(matchesBrowseFilter(league(), { ...EMPTY_BROWSE_FILTER, experienceTier: "experienced" })).toBe(false);
  });

  it("narrows on stake tier, including tier 0", () => {
    expect(matchesBrowseFilter(league(), { ...EMPTY_BROWSE_FILTER, stakeTier: 0 })).toBe(true);
    expect(matchesBrowseFilter(league(), { ...EMPTY_BROWSE_FILTER, stakeTier: 3 })).toBe(false);
  });

  it("requires every narrowed field at once", () => {
    const filter = { format: "snake" as const, experienceTier: "experienced" as const, stakeTier: 0 };
    expect(matchesBrowseFilter(league(), filter)).toBe(false);
    expect(matchesBrowseFilter(league({ experienceTier: "experienced" }), filter)).toBe(true);
  });
});

describe("hasOpenSeat", () => {
  it("is true only while a seat is left", () => {
    expect(hasOpenSeat({ teamCount: 12, filledTeams: 11 })).toBe(true);
    expect(hasOpenSeat({ teamCount: 12, filledTeams: 12 })).toBe(false);
    expect(hasOpenSeat({ teamCount: 12, filledTeams: 13 })).toBe(false);
  });
});

describe("stakeTierLabel", () => {
  it("labels every configured tier", () => {
    for (const entry of MATCHMAKING_CONFIG.stakeTiers) {
      expect(stakeTierLabel(entry.tier)).toBe(entry.label);
    }
  });

  it("falls back to the lowest tier's label for a tier nothing configured", () => {
    expect(stakeTierLabel(99)).toBe(MATCHMAKING_CONFIG.stakeTiers[0].label);
  });
});

describe("MATCHMAKING_CONFIG", () => {
  it("offers only the two formats the draft engine can actually run", () => {
    expect([...MATCHMAKING_CONFIG.formats]).toEqual(["snake", "auction"]);
  });

  it("says plainly that stake tiers are cosmetic, with no em-dash in the copy", () => {
    expect(MATCHMAKING_CONFIG.stakeDisclosure).toContain("No money changes hands");
    expect(MATCHMAKING_CONFIG.stakeDisclosure).not.toContain("—");
  });
});
