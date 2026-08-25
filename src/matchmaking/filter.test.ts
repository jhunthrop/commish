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
  entryFeeCents: 0,
  teamCount: 12,
  filledTeams: 8,
  scoringLabel: "Standard",
  compositionCategory: "all_newcomers",
  draftAt: "Saturday 12 September, 7:00 PM UTC (in 3 days)",
  medianGame: false,
  startTrigger: "scheduled",
  houseRung: null,
  heldSeats: 0,
  rosterSummary: "15 slots, 1 flex",
  playoffWeeks: [15, 16, 17],
  kickoffRolls: 0,
  ...over,
});

const newcomerLeague = league({ id: "l_newcomer", compositionCategory: "all_newcomers" });
const veteranLeague = league({ id: "l_veteran", compositionCategory: "open" });

describe("normalizeBrowseFilter", () => {
  it("reads every supported value off a query string", () => {
    expect(
      normalizeBrowseFilter({ format: "auction", experienceTier: "experienced", stakeTier: "2", participationTier: "veteran" }),
    ).toEqual({
      format: "auction",
      experienceTier: "experienced",
      stakeTier: 2,
      participationTier: "veteran",
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

  it("reads participation tier as a first-class filter, beside the two that already exist", () => {
    expect(normalizeBrowseFilter({ participationTier: "newcomer" }).participationTier).toBe("newcomer");
    expect(normalizeBrowseFilter({ participationTier: "veteran" }).participationTier).toBe("veteran");
  });

  it("defaults participation tier to any, so the filter is visible by default without being applied by default", () => {
    // Step 6 says "default, always-visible", and those are two different properties. Always
    // visible is a rendering decision (the control is on the page with no disclosure to open);
    // defaulting to `any` is what keeps a browse page from hiding leagues from a visitor who
    // never touched the control.
    expect(normalizeBrowseFilter({}).participationTier).toBe("any");
  });

  it("refuses an unknown participation tier by falling back to any, never by throwing at a stranger", () => {
    expect(normalizeBrowseFilter({ participationTier: "expert" }).participationTier).toBe("any");
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
    const filter = { format: "snake" as const, experienceTier: "experienced" as const, stakeTier: 0, participationTier: "any" as const };
    expect(matchesBrowseFilter(league(), filter)).toBe(false);
    expect(matchesBrowseFilter(league({ experienceTier: "experienced" }), filter)).toBe(true);
  });

  it("filters on participation tier as a first-class filter, beside the two that already exist", () => {
    const filter = normalizeBrowseFilter({ participationTier: "newcomer" });
    expect(filter.participationTier).toBe("newcomer");
    expect(matchesBrowseFilter(newcomerLeague, filter)).toBe(true);
    expect(matchesBrowseFilter(veteranLeague, filter)).toBe(false);
  });

  it("matches the veteran filter against everything that is not newcomer-leaning, including a tie", () => {
    const filter = normalizeBrowseFilter({ participationTier: "veteran" });
    expect(matchesBrowseFilter(veteranLeague, filter)).toBe(true);
    expect(matchesBrowseFilter(newcomerLeague, filter)).toBe(false);
    expect(matchesBrowseFilter(league({ compositionCategory: "open" }), filter)).toBe(true);
  });
});

describe("hasOpenSeat", () => {
  it("is true only while a seat is left", () => {
    expect(hasOpenSeat({ teamCount: 12, filledTeams: 11 })).toBe(true);
    expect(hasOpenSeat({ teamCount: 12, filledTeams: 12 })).toBe(false);
    expect(hasOpenSeat({ teamCount: 12, filledTeams: 13 })).toBe(false);
  });

  // Phase 3.6, Task 6: a live seat hold counts against capacity exactly like a real member does,
  // for anyone without that hold's own token — `heldSeats` defaults to `0`, so every caller that
  // predates seat holds keeps its exact prior meaning unchanged.
  it("counts a live seat hold against capacity when the caller passes one", () => {
    expect(hasOpenSeat({ teamCount: 12, filledTeams: 11 }, 1)).toBe(false);
    expect(hasOpenSeat({ teamCount: 12, filledTeams: 10 }, 1)).toBe(true);
    expect(hasOpenSeat({ teamCount: 12, filledTeams: 11 })).toBe(true);
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

  // 2026-08-25, the absolutism sweep's carried finding: the shelf's live disclosure defers to
  // the per-league Entry column rather than re-asserting a blanket "no money" claim for a merged
  // list that can now hold a real fee.
  it("defers the shelf's live disclosure to the per-league Entry column, with no em-dash in the copy", () => {
    expect(MATCHMAKING_CONFIG.liveShelfStakeDisclosure).toContain("Entry fees are listed per league");
    expect(MATCHMAKING_CONFIG.liveShelfStakeDisclosure).not.toContain("—");
    expect(MATCHMAKING_CONFIG.liveShelfStakeDisclosure).not.toContain("No money changes hands");
  });

  it("offers the same two participation tiers the platform computes, and no third one", () => {
    expect([...MATCHMAKING_CONFIG.participationTiers]).toEqual(["newcomer", "veteran"]);
  });
});
