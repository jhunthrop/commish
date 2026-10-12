import { describe, expect, it } from "vitest";
import { STANDARD_ROSTER_SLOTS, type RosterSlotConfig } from "@research/domain/roster";
import { bestStartingLineupPoints, type RosteredPlayer } from "./lineup-score";

const SMALL_SLOTS: readonly RosterSlotConfig[] = [
  { slot: "QB", count: 1, eligiblePositions: ["QB"] },
  { slot: "RB", count: 1, eligiblePositions: ["RB"] },
  { slot: "FLEX", count: 1, eligiblePositions: ["RB", "WR", "TE"] },
  { slot: "BENCH", count: 2, eligiblePositions: ["QB", "RB", "WR", "TE"] },
];

function points(entries: readonly (readonly [string, number])[]): ReadonlyMap<string, number> {
  return new Map(entries);
}

describe("bestStartingLineupPoints", () => {
  it("sums exactly the starters, never the bench", () => {
    const roster: RosteredPlayer[] = [
      { playerId: "qb1", position: "QB" },
      { playerId: "rb1", position: "RB" },
      { playerId: "rb2", position: "RB" },
      { playerId: "wr1", position: "WR" },
    ];
    const pts = points([["qb1", 20], ["rb1", 15], ["rb2", 10], ["wr1", 12]]);
    // QB slot takes qb1 (20). RB slot takes the better back, rb1 (15). FLEX takes whichever of
    // {rb2, wr1} scores more: wr1 (12) beats rb2 (10). rb2 rides the bench, uncounted.
    expect(bestStartingLineupPoints(roster, SMALL_SLOTS, pts)).toBe(20 + 15 + 12);
  });

  it("leaves a slot empty rather than fabricating a starter when nobody is eligible", () => {
    const roster: RosteredPlayer[] = [{ playerId: "wr1", position: "WR" }];
    const pts = points([["wr1", 9]]);
    // No QB, no RB: the QB and RB slots go unfilled; FLEX takes the one eligible player.
    expect(bestStartingLineupPoints(roster, SMALL_SLOTS, pts)).toBe(9);
  });

  it("treats a player absent from the points map as scoring zero, never dropping him", () => {
    const roster: RosteredPlayer[] = [{ playerId: "qb1", position: "QB" }, { playerId: "unranked", position: "RB" }];
    const pts = points([["qb1", 18]]);
    expect(bestStartingLineupPoints(roster, SMALL_SLOTS, pts)).toBe(18);
  });

  it("an empty roster scores zero", () => {
    expect(bestStartingLineupPoints([], SMALL_SLOTS, new Map())).toBe(0);
  });

  it("a full standard roster only ever counts its 9 starting slots, never the 6-man bench", () => {
    const roster: RosteredPlayer[] = [
      { playerId: "qb1", position: "QB" },
      { playerId: "rb1", position: "RB" },
      { playerId: "rb2", position: "RB" },
      { playerId: "rb3", position: "RB" },
      { playerId: "wr1", position: "WR" },
      { playerId: "wr2", position: "WR" },
      { playerId: "wr3", position: "WR" },
      { playerId: "te1", position: "TE" },
      { playerId: "k1", position: "K" },
      { playerId: "def1", position: "DEF" },
    ];
    const pts = points([
      ["qb1", 20], ["rb1", 18], ["rb2", 14], ["rb3", 8], ["wr1", 16], ["wr2", 12], ["wr3", 6], ["te1", 10], ["k1", 5], ["def1", 4],
    ]);
    // Starters: QB(20) + RB(18,14) + WR(16,12) + TE(10) + FLEX(best remaining: wr3 6 vs rb3 8 -> rb3) + K(5) + DEF(4).
    const expected = 20 + 18 + 14 + 16 + 12 + 10 + 8 + 5 + 4;
    expect(bestStartingLineupPoints(roster, STANDARD_ROSTER_SLOTS, pts)).toBe(expected);
  });
});
