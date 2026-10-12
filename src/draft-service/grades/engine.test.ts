import { describe, expect, it } from "vitest";
import type { RosterSlotConfig } from "@research/domain/roster";
import { gradeDraft, type GradeDraftInput, type GradePick, type TeamGrade } from "./engine";

/**
 * A minimal 4-slot league (one QB, one RB, one WR, one TE, no FLEX, no bench) so every roster
 * below fills every slot with exactly the four players it drafted — no greedy-assignment
 * ambiguity to reason through by hand.
 */
const SLOT_CONFIG: readonly RosterSlotConfig[] = [
  { slot: "QB", count: 1, eligiblePositions: ["QB"] },
  { slot: "RB", count: 1, eligiblePositions: ["RB"] },
  { slot: "WR", count: 1, eligiblePositions: ["WR"] },
  { slot: "TE", count: 1, eligiblePositions: ["TE"] },
];

/**
 * THE 4-TEAM FIXTURE, hand-computable. Four straight (non-snake) rounds, one position drafted
 * per round (QBs in round 1, RBs in round 2, WRs in round 3, TEs in round 4), teams always
 * picking in the order A, B, C, D.
 *
 * `valueByPlayerId` is deliberately NOT tied to `pointsByPlayerId`: team A always takes the
 * single most valuable player still on the board (a "perfect" value drafter, so every one of
 * its picks nets a zero delta), team D always reaches for the worst player left in every round
 * (a "punt"), and B/C sit in between — but team C's players happen to score the most projected
 * points despite C's own reaches on the value board, so `projectedRank` and the value-quartile
 * letter can be shown to come from two independent signals rather than one relabeling the other.
 *
 * Every number below (the `bestAvailable` at each pick, each team's summed `valueCaptured`, and
 * each team's summed `projectedPoints`) was traced by hand against the exact formula this
 * module's docblock states — see the worked table in `engine.ts`'s own docblock.
 */
const PICKS: readonly GradePick[] = [
  { pickNumber: 1, teamId: "A", playerId: "Q_A" },
  { pickNumber: 2, teamId: "B", playerId: "Q_B" },
  { pickNumber: 3, teamId: "C", playerId: "Q_C" },
  { pickNumber: 4, teamId: "D", playerId: "Q_D" },
  { pickNumber: 5, teamId: "A", playerId: "R_A" },
  { pickNumber: 6, teamId: "B", playerId: "R_B" },
  { pickNumber: 7, teamId: "C", playerId: "R_C" },
  { pickNumber: 8, teamId: "D", playerId: "R_D" },
  { pickNumber: 9, teamId: "A", playerId: "W_A" },
  { pickNumber: 10, teamId: "B", playerId: "W_B" },
  { pickNumber: 11, teamId: "C", playerId: "W_C" },
  { pickNumber: 12, teamId: "D", playerId: "W_D" },
  { pickNumber: 13, teamId: "A", playerId: "T_A" },
  { pickNumber: 14, teamId: "B", playerId: "T_B" },
  { pickNumber: 15, teamId: "C", playerId: "T_C" },
  { pickNumber: 16, teamId: "D", playerId: "T_D" },
];

const ROSTERS = new Map([
  ["A", [
    { playerId: "Q_A", position: "QB" as const },
    { playerId: "R_A", position: "RB" as const },
    { playerId: "W_A", position: "WR" as const },
    { playerId: "T_A", position: "TE" as const },
  ]],
  ["B", [
    { playerId: "Q_B", position: "QB" as const },
    { playerId: "R_B", position: "RB" as const },
    { playerId: "W_B", position: "WR" as const },
    { playerId: "T_B", position: "TE" as const },
  ]],
  ["C", [
    { playerId: "Q_C", position: "QB" as const },
    { playerId: "R_C", position: "RB" as const },
    { playerId: "W_C", position: "WR" as const },
    { playerId: "T_C", position: "TE" as const },
  ]],
  ["D", [
    { playerId: "Q_D", position: "QB" as const },
    { playerId: "R_D", position: "RB" as const },
    { playerId: "W_D", position: "WR" as const },
    { playerId: "T_D", position: "TE" as const },
  ]],
]);

const VALUE_BY_PLAYER_ID = new Map(Object.entries({
  Q_A: 100, Q_B: 95, Q_C: 30, Q_D: 10,
  R_A: 90, R_B: 40, R_C: 85, R_D: 5,
  W_A: 50, W_B: 45, W_C: 48, W_D: 8,
  T_A: 20, T_B: 15, T_C: 18, T_D: 2,
}));

const POINTS_BY_PLAYER_ID = new Map(Object.entries({
  Q_A: 20, R_A: 18, W_A: 12, T_A: 8,
  Q_B: 22, R_B: 10, W_B: 14, T_B: 9,
  Q_C: 50, R_C: 25, W_C: 13, T_C: 10,
  Q_D: 3, R_D: 2, W_D: 4, T_D: 1,
}));

/** Team A's four starters share one bye week (3 of 4) — the only team in this fixture whose
 *  starters collide; B, C and D each carry four distinct bye weeks. */
const NFL_TEAM_BY_PLAYER_ID = new Map(Object.entries({
  Q_A: "NE", R_A: "BUF", W_A: "MIA", T_A: "NYJ",
  Q_B: "DAL", R_B: "PHI", W_B: "NYG", T_B: "WAS",
  Q_C: "KC", R_C: "DEN", W_C: "LAC", T_C: "LV",
  Q_D: "ARI", R_D: "SEA", W_D: "SF", T_D: "LAR",
}));

const BYE_WEEKS = new Map(Object.entries({
  NE: 9, BUF: 9, MIA: 9, NYJ: 5,
  DAL: 7, PHI: 10, NYG: 11, WAS: 12,
  KC: 6, DEN: 8, LAC: 13, LV: 14,
  ARI: 6, SEA: 5, SF: 4, LAR: 9,
}));

function fourTeamInput(): GradeDraftInput {
  return {
    picks: PICKS,
    rosters: ROSTERS,
    slotConfig: SLOT_CONFIG,
    pointsByPlayerId: POINTS_BY_PLAYER_ID,
    valueByPlayerId: VALUE_BY_PLAYER_ID,
    byeWeeks: BYE_WEEKS,
    nflTeamByPlayerId: NFL_TEAM_BY_PLAYER_ID,
  };
}

function gradeOf(grades: readonly TeamGrade[], teamId: string): TeamGrade {
  const grade = grades.find((entry) => entry.teamId === teamId);
  if (grade === undefined) throw new Error(`no grade for ${teamId}`);
  return grade;
}

describe("gradeDraft — 4-team fixture", () => {
  it("computes valueCaptured as the sum of (pick value - best available value) over each team's own picks", () => {
    const grades = gradeDraft(fourTeamInput());
    // A always took the round's single most valuable player left on the whole board: zero every pick.
    expect(gradeOf(grades, "A").components.valueCaptured).toBe(0);
    // B: 0 (Q_B) + (40-85) + (45-48) + (15-18) = 0 - 45 - 3 - 3 = -51
    expect(gradeOf(grades, "B").components.valueCaptured).toBe(-51);
    // C: (30-90) + 0 (R_C) + 0 (W_C) + 0 (T_C) = -60
    expect(gradeOf(grades, "C").components.valueCaptured).toBe(-60);
    // D: (10-90) + (5-50) + (8-20) + 0 (T_D) = -80 - 45 - 12 + 0 = -137
    expect(gradeOf(grades, "D").components.valueCaptured).toBe(-137);
  });

  it("assigns room-relative quartile letters off the valueCaptured ranking (A best, D worst)", () => {
    const grades = gradeDraft(fourTeamInput());
    expect(gradeOf(grades, "A").letter).toBe("A");
    expect(gradeOf(grades, "B").letter).toBe("B");
    expect(gradeOf(grades, "C").letter).toBe("C");
    expect(gradeOf(grades, "D").letter).toBe("D");
  });

  it("shows a team that punted value as a D with its negative valueCaptured stated as-is, never floored or hidden", () => {
    const grades = gradeDraft(fourTeamInput());
    const teamD = gradeOf(grades, "D");
    expect(teamD.letter).toBe("D");
    expect(teamD.components.valueCaptured).toBe(-137);
    expect(teamD.components.valueCaptured).toBeLessThan(0);
  });

  it("ranks projectedRank by projectedPoints alone, independent of the valueCaptured letter", () => {
    const grades = gradeDraft(fourTeamInput());
    // Team C reaches on the value board (letter C, third of four) but its four players score the
    // most projected points of the room (98), so it ranks #1 by projectedRank despite the worse
    // letter — the two facts are not the same fact restated.
    expect(gradeOf(grades, "C").components.projectedPoints).toBe(98);
    expect(gradeOf(grades, "C").projectedRank).toBe(1);
    expect(gradeOf(grades, "A").components.projectedPoints).toBe(58);
    expect(gradeOf(grades, "A").projectedRank).toBe(2);
    expect(gradeOf(grades, "B").components.projectedPoints).toBe(55);
    expect(gradeOf(grades, "B").projectedRank).toBe(3);
    expect(gradeOf(grades, "D").components.projectedPoints).toBe(10);
    expect(gradeOf(grades, "D").projectedRank).toBe(4);
  });

  it("fills every startable slot when the roster has exactly one player per required position", () => {
    const grades = gradeDraft(fourTeamInput());
    for (const teamId of ["A", "B", "C", "D"]) {
      const { startingSlotsFilled, startingSlotsTotal } = gradeOf(grades, teamId).components;
      expect(startingSlotsTotal).toBe(4);
      expect(startingSlotsFilled).toBe(4);
    }
  });

  it("counts a bye collision only for the team whose starters actually stack 3+ on one week", () => {
    const grades = gradeDraft(fourTeamInput());
    expect(gradeOf(grades, "A").components.byeCollisions).toBe(1);
    expect(gradeOf(grades, "B").components.byeCollisions).toBe(0);
    expect(gradeOf(grades, "C").components.byeCollisions).toBe(0);
    expect(gradeOf(grades, "D").components.byeCollisions).toBe(0);
  });

  it("never invents evidence for a player missing from pointsByPlayerId — that player scores 0", () => {
    const input = fourTeamInput();
    const sparsePoints = new Map(input.pointsByPlayerId);
    sparsePoints.delete("T_A"); // team A's tight end has no evidence-board points entry
    const grades = gradeDraft({ ...input, pointsByPlayerId: sparsePoints });
    // A's total drops from 58 to 50 (loses T_A's 8 points) rather than throwing or guessing.
    expect(gradeOf(grades, "A").components.projectedPoints).toBe(50);
  });

  it("is deterministic: two identical calls produce deep-equal results", () => {
    const first = gradeDraft(fourTeamInput());
    const second = gradeDraft(fourTeamInput());
    expect(second).toEqual(first);
  });
});

describe("gradeDraft — 10-team ceil rule", () => {
  /**
   * Ten teams, each drafting a single QB in straight order, each always taking the single most
   * valuable player still on the board — every team's valueCaptured is therefore tied at 0, so
   * the ranking (and the letter each rank earns) comes entirely from the documented tie-break,
   * projectedPoints, assigned here in strict team order (T1 highest, T10 lowest) so team Tn's
   * rank is always exactly n.
   *
   * `Math.ceil(4 * rank / 10)` for rank 1..10: 1,1,2,2,2,3,3,4,4,4 — pinning A={1,2}, B={3,4,5},
   * C={6,7}, D={8,9,10}, the exact distribution a plain "divide into four groups" scheme would
   * NOT produce (10 does not divide evenly by 4).
   */
  const TEN_TEAM_SLOTS: readonly RosterSlotConfig[] = [{ slot: "QB", count: 1, eligiblePositions: ["QB"] }];
  const teamIds = Array.from({ length: 10 }, (_, index) => `T${index + 1}`);
  const picks: readonly GradePick[] = teamIds.map((teamId, index) => ({
    pickNumber: index + 1,
    teamId,
    playerId: `P${index + 1}`,
  }));
  const rosters = new Map(teamIds.map((teamId, index) => [teamId, [{ playerId: `P${index + 1}`, position: "QB" as const }]]));
  const valueByPlayerId = new Map(teamIds.map((_, index) => [`P${index + 1}`, 100 - index * 10]));
  const pointsByPlayerId = new Map(teamIds.map((_, index) => [`P${index + 1}`, 100 - index * 10]));

  function tenTeamInput(): GradeDraftInput {
    return {
      picks,
      rosters,
      slotConfig: TEN_TEAM_SLOTS,
      pointsByPlayerId,
      valueByPlayerId,
      byeWeeks: new Map(),
      nflTeamByPlayerId: new Map(),
    };
  }

  it("matches Math.ceil(4 * rank / teamCount) exactly for a 10-team room", () => {
    const grades = gradeDraft(tenTeamInput());
    const expectedLetterByTeam: Record<string, TeamGrade["letter"]> = {
      T1: "A", T2: "A",
      T3: "B", T4: "B", T5: "B",
      T6: "C", T7: "C",
      T8: "D", T9: "D", T10: "D",
    };
    for (const [teamId, expectedLetter] of Object.entries(expectedLetterByTeam)) {
      const grade = gradeOf(grades, teamId);
      expect(grade.components.valueCaptured).toBe(0);
      expect(grade.letter).toBe(expectedLetter);
    }
  });
});
