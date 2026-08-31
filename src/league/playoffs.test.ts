import { describe, expect, it } from "vitest";
import { championshipPairing, firstRoundPairings, playoffRoundOf, semifinalPairings } from "./playoffs";

const SEEDS = [
  { teamId: "t1", seed: 1 },
  { teamId: "t2", seed: 2 },
  { teamId: "t3", seed: 3 },
  { teamId: "t4", seed: 4 },
  { teamId: "t5", seed: 5 },
  { teamId: "t6", seed: 6 },
];

describe("the playoff bracket", () => {
  it("round 1 is 3v6 and 4v5 with the top two on bye, better seed at home", () => {
    expect(firstRoundPairings(SEEDS)).toEqual([
      { homeTeamId: "t3", awayTeamId: "t6" },
      { homeTeamId: "t4", awayTeamId: "t5" },
    ]);
  });

  it("refuses a bracket that is not exactly six named seeds", () => {
    expect(() => firstRoundPairings(SEEDS.slice(0, 4))).toThrow("expected exactly 6 seeds");
    expect(() => firstRoundPairings([...SEEDS.slice(0, 5), { teamId: "t7", seed: 7 }])).toThrow("seed 6 is missing");
  });

  it("round 2 reseeds: 1 hosts the lowest survivor, 2 hosts the other", () => {
    // 6 upset 3; 4 beat 5 -> 1 hosts 6 (the worst survivor), 2 hosts 4.
    expect(semifinalPairings(SEEDS, ["t6", "t4"])).toEqual([
      { homeTeamId: "t1", awayTeamId: "t6" },
      { homeTeamId: "t2", awayTeamId: "t4" },
    ]);
    // Chalk: 3 and 4 advance -> 1 hosts 4, 2 hosts 3.
    expect(semifinalPairings(SEEDS, ["t3", "t4"])).toEqual([
      { homeTeamId: "t1", awayTeamId: "t4" },
      { homeTeamId: "t2", awayTeamId: "t3" },
    ]);
  });

  it("the championship puts the better surviving seed at home", () => {
    expect(championshipPairing(SEEDS, ["t2", "t1"])).toEqual({ homeTeamId: "t1", awayTeamId: "t2" });
    expect(championshipPairing(SEEDS, ["t6", "t2"])).toEqual({ homeTeamId: "t2", awayTeamId: "t6" });
  });

  it("maps weeks to rounds off the regular season's own length", () => {
    expect(playoffRoundOf(14, 14)).toBeNull();
    expect(playoffRoundOf(15, 14)).toBe(1);
    expect(playoffRoundOf(16, 14)).toBe(2);
    expect(playoffRoundOf(17, 14)).toBe(3);
    expect(playoffRoundOf(18, 14)).toBeNull();
  });
});
