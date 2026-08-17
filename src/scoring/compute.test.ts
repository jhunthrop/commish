import { describe, it, expect } from "vitest";
import type { StatLine } from "@/domain/player";
import { STANDARD_SCORING, PPR_SCORING, HALF_PPR_SCORING, TE_PREMIUM_SCORING } from "@/domain/scoring";
import { computeFantasyPoints, scoreLineup } from "./compute";

const zero: StatLine = {
  playerId: "p", week: 1,
  passingYards: 0, passingTouchdowns: 0, interceptions: 0,
  rushingYards: 0, rushingTouchdowns: 0,
  receivingYards: 0, receivingTouchdowns: 0, receptions: 0, fumblesLost: 0,
  fieldGoalsMade: 0, extraPointsMade: 0, sacks: 0, defensiveInterceptions: 0, defensiveTouchdowns: 0,
};

describe("computeFantasyPoints", () => {
  // QB: 300 pass yds (12) + 3 pass TD (12) + 1 INT (-2) + 20 rush yds (2) = 24
  it("scores a QB line under standard scoring", () => {
    const line = { ...zero, passingYards: 300, passingTouchdowns: 3, interceptions: 1, rushingYards: 20 };
    expect(computeFantasyPoints(line, "QB", STANDARD_SCORING)).toBe(24);
  });

  // WR: 8 rec, 100 yds (10) + 1 TD (6) = 16 standard; 24 PPR; 20 half-PPR
  const wr = { ...zero, receptions: 8, receivingYards: 100, receivingTouchdowns: 1 };
  it.each([
    ["standard", STANDARD_SCORING, 16],
    ["PPR", PPR_SCORING, 24],
    ["half-PPR", HALF_PPR_SCORING, 20],
  ])("scores a WR line under %s", (_name, settings, expected) => {
    expect(computeFantasyPoints(wr, "WR", settings)).toBe(expected);
  });

  it("applies the TE reception bonus only to tight ends", () => {
    const line = { ...zero, receptions: 6, receivingYards: 60 };
    // TE premium = PPR (1/rec) + 0.5 TE bonus → 6*1.5 + 6 = 15 ; WR gets 6 + 6 = 12
    expect(computeFantasyPoints(line, "TE", TE_PREMIUM_SCORING)).toBe(15);
    expect(computeFantasyPoints(line, "WR", TE_PREMIUM_SCORING)).toBe(12);
  });

  it("scores negative stats (fumbles, INTs) as negatives and can go below zero", () => {
    const line = { ...zero, interceptions: 3, fumblesLost: 1 }; // -6 + -2
    expect(computeFantasyPoints(line, "QB", STANDARD_SCORING)).toBe(-8);
  });

  it("scores kickers and defenses from their own categories", () => {
    expect(computeFantasyPoints({ ...zero, fieldGoalsMade: 2, extraPointsMade: 3 }, "K", STANDARD_SCORING)).toBe(9);
    expect(computeFantasyPoints({ ...zero, sacks: 3, defensiveInterceptions: 1, defensiveTouchdowns: 1 }, "DEF", STANDARD_SCORING)).toBe(11);
  });

  it("returns 0 for an all-zero line and rounds to 2 decimals", () => {
    expect(computeFantasyPoints(zero, "RB", STANDARD_SCORING)).toBe(0);
    // 7 rushing yards * 0.1 = 0.7000000000000001 in float math → 0.7
    expect(computeFantasyPoints({ ...zero, rushingYards: 7 }, "RB", STANDARD_SCORING)).toBe(0.7);
  });
});

describe("scoreLineup", () => {
  const settings = PPR_SCORING;
  const lines = new Map<string, StatLine>([
    ["qb1", { ...zero, playerId: "qb1", passingYards: 250, passingTouchdowns: 2 }], // 10 + 8 = 18
    ["wr1", { ...zero, playerId: "wr1", receptions: 5, receivingYards: 50 }],        // 5 + 5 = 10
  ]);

  it("sums starters and reports per-player points", () => {
    const res = scoreLineup({
      starters: [{ playerId: "qb1", position: "QB" }, { playerId: "wr1", position: "WR" }],
      statLinesByPlayerId: lines,
      settings,
    });
    expect(res.total).toBe(28);
    expect(res.byPlayer.get("qb1")).toBe(18);
    expect(res.byPlayer.get("wr1")).toBe(10);
  });

  it("scores a starter with no stat line as 0 (bye/DNP) rather than throwing", () => {
    const res = scoreLineup({ starters: [{ playerId: "ghost", position: "RB" }], statLinesByPlayerId: lines, settings });
    expect(res.total).toBe(0);
    expect(res.byPlayer.get("ghost")).toBe(0);
  });

  it("returns 0 for an empty lineup", () => {
    expect(scoreLineup({ starters: [], statLinesByPlayerId: lines, settings }).total).toBe(0);
  });
});
