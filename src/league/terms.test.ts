import { describe, it, expect } from "vitest";
import { SCORING_PRESETS } from "@/domain/scoring";
import { STANDARD_ROSTER_SLOTS } from "@/domain/roster";
import { MATCHMAKING_CONFIG } from "@/matchmaking/config";
import { leagueTerms, type LeagueTermsInput } from "./terms";

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
  commissioner: { displayName: "Alex Rivera", avatarUrl: "preset:crown" },
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

  it("names the commissioner", () => {
    expect(leagueTerms({ ...BASE, commissioner: { displayName: "Ada Lovelace", avatarUrl: "preset:crown" } }).commissionerName).toBe(
      "Ada Lovelace",
    );
  });

  it("carries the commissioner's avatar ref through, including when they have none", () => {
    expect(leagueTerms(BASE).commissionerAvatar).toBe("preset:crown");
    expect(leagueTerms({ ...BASE, commissioner: { displayName: "Ada Lovelace", avatarUrl: null } }).commissionerAvatar).toBeNull();
  });
});
