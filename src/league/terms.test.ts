import { describe, it, expect } from "vitest";
import { SCORING_PRESETS } from "@/domain/scoring";
import { STANDARD_ROSTER_SLOTS } from "@/domain/roster";
import { MATCHMAKING_CONFIG } from "@/matchmaking/config";
import { SUPERFLEX_ROSTER_SLOTS } from "./roster-shape";
import { formatDraftTime, leagueTerms, type LeagueTermsInput } from "./terms";

/** A small custom roster shape — distinct from `STANDARD_ROSTER_SLOTS` so a test that swaps one
 *  in for the other proves `leagueTerms` reads the SLOTS it was given, not a fixed default. */
const SMALL_ROSTER = [
  { slot: "QB" as const, count: 1, eligiblePositions: ["QB" as const] },
  { slot: "BENCH" as const, count: 2, eligiblePositions: ["QB" as const] },
];

const BASE: LeagueTermsInput = {
  name: "Sunday Money",
  format: "snake",
  teamCount: 12,
  filledTeams: 8,
  scoring: SCORING_PRESETS.ppr,
  rosterSlots: SMALL_ROSTER,
  stakeTier: 1,
  medianGame: false,
  commissioner: { displayName: "Alex Rivera", avatarUrl: "preset:crown" },
  kickoffAt: "2026-09-12T23:00:00.000Z",
  now: "2026-09-09T23:00:00.000Z",
};

describe("leagueTerms", () => {
  it("carries the league's own facts straight through", () => {
    const terms = leagueTerms(BASE);
    expect(terms.name).toBe("Sunday Money");
    expect(terms.format).toBe("snake");
    expect(terms.teamCount).toBe(12);
    expect(terms.filledTeams).toBe(8);
  });

  it("derives the scoring label from the weights, never a stored preset name", () => {
    expect(leagueTerms(BASE).scoringLabel).toBe("PPR");
    expect(leagueTerms({ ...BASE, scoring: { ...SCORING_PRESETS.ppr, pointsPerPassingTouchdown: 6 } }).scoringLabel).toBe(
      "Custom",
    );
  });

  it("renders a roster shape a human can read, not a config array", () => {
    expect(leagueTerms({ ...BASE, rosterSlots: STANDARD_ROSTER_SLOTS }).rosterLine).toBe(
      "1 QB, 2 RB, 2 WR, 1 TE, 1 FLEX, 1 K, 1 DEF, 6 bench",
    );
  });

  it("lower-cases the bench slot in a smaller custom roster too", () => {
    expect(leagueTerms(BASE).rosterLine).toBe("1 QB, 2 bench");
  });

  it("names the stake tier from the same label browse uses", () => {
    expect(leagueTerms(BASE).stakeLabel).toBe("Friendly");
    expect(leagueTerms({ ...BASE, stakeTier: 0 }).stakeLabel).toBe("Free");
  });

  it("carries the stake disclosure verbatim, from the one place it is written", () => {
    // Phase 1 wrote this sentence once and put it on /browse. The invite page is the other place
    // somebody decides to enter a league, and two hand-written versions of "no money changes
    // hands" is exactly how one of them ends up out of date the week money starts changing hands.
    expect(leagueTerms(BASE).stakeDisclosure).toBe(MATCHMAKING_CONFIG.stakeDisclosure);
  });

  it("carries no format notes for a plain standard-shape, non-median league", () => {
    expect(leagueTerms(BASE).formatNotes).toEqual([]);
  });

  it("notes the median game, derived from the stored toggle, not a remembered preset", () => {
    expect(leagueTerms({ ...BASE, medianGame: true }).formatNotes).toEqual([
      "Every team also plays the league median each week.",
    ]);
  });

  it("notes superflex, derived from the stored roster slots, not a remembered preset name", () => {
    expect(leagueTerms({ ...BASE, rosterSlots: SUPERFLEX_ROSTER_SLOTS }).formatNotes).toEqual([
      "Superflex: you can start a second quarterback.",
    ]);
  });

  it("lists both notes, median first, when a league opts into both", () => {
    expect(leagueTerms({ ...BASE, medianGame: true, rosterSlots: SUPERFLEX_ROSTER_SLOTS }).formatNotes).toEqual([
      "Every team also plays the league median each week.",
      "Superflex: you can start a second quarterback.",
    ]);
  });

  it("names the commissioner", () => {
    expect(leagueTerms({ ...BASE, commissioner: { displayName: "Ada Lovelace", avatarUrl: "preset:crown" } }).commissionerName).toBe(
      "Ada Lovelace",
    );
  });

  it("carries the commissioner's avatar ref through, including when they have none", () => {
    expect(leagueTerms(BASE).commissionerAvatar).toBe("preset:crown");
    expect(leagueTerms({ ...BASE, commissioner: { displayName: "Ada Lovelace", avatarUrl: null } }).commissionerAvatar).toBeNull();
  });

  it("renders the draft's scheduled time absolute-first, then relative", () => {
    expect(leagueTerms(BASE).draftAt).toBe("Saturday 12 September, 11:00 PM UTC (in 3 days)");
  });
});

describe("formatDraftTime", () => {
  it("puts the absolute time before the relative one", () => {
    expect(formatDraftTime("2026-09-12T23:00:00.000Z", "2026-09-09T23:00:00.000Z")).toBe(
      "Saturday 12 September, 11:00 PM UTC (in 3 days)",
    );
  });

  it("counts down in hours inside the final day", () => {
    expect(formatDraftTime("2026-09-12T23:00:00.000Z", "2026-09-12T18:00:00.000Z")).toBe(
      "Saturday 12 September, 11:00 PM UTC (in 5 hours)",
    );
  });

  it("counts down in minutes inside the final hour", () => {
    expect(formatDraftTime("2026-09-12T23:00:00.000Z", "2026-09-12T22:40:00.000Z")).toBe(
      "Saturday 12 September, 11:00 PM UTC (in 20 minutes)",
    );
  });

  it("uses the singular for exactly one day, hour or minute", () => {
    expect(formatDraftTime("2026-09-12T23:00:00.000Z", "2026-09-11T23:00:00.000Z")).toBe(
      "Saturday 12 September, 11:00 PM UTC (in 1 day)",
    );
    expect(formatDraftTime("2026-09-12T23:00:00.000Z", "2026-09-12T22:00:00.000Z")).toBe(
      "Saturday 12 September, 11:00 PM UTC (in 1 hour)",
    );
    expect(formatDraftTime("2026-09-12T23:00:00.000Z", "2026-09-12T22:59:00.000Z")).toBe(
      "Saturday 12 September, 11:00 PM UTC (in 1 minute)",
    );
  });

  it("never goes negative — a kickoff at or past now reads as starting now", () => {
    expect(formatDraftTime("2026-09-12T23:00:00.000Z", "2026-09-12T23:00:00.000Z")).toBe(
      "Saturday 12 September, 11:00 PM UTC (starting now)",
    );
    expect(formatDraftTime("2026-09-12T23:00:00.000Z", "2026-09-13T00:00:00.000Z")).toBe(
      "Saturday 12 September, 11:00 PM UTC (starting now)",
    );
  });
});
