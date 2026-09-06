import { describe, expect, it } from "vitest";
import type { LeagueShape } from "@/projections/decide/replacement";
import type { SimPlayerEvidence } from "@/draft-service/sim/types";
import { gradeEvidenceMaps } from "./evidence-maps";

const SHAPE: LeagueShape = {
  teamCount: 2,
  rosterSlots: [
    { slot: "QB", count: 1, eligiblePositions: ["QB"] },
    { slot: "RB", count: 1, eligiblePositions: ["RB"] },
  ],
};

const POOL: readonly SimPlayerEvidence[] = [
  { playerId: "q1", position: "QB", marketRank: 0, projectedPoints: 300 },
  { playerId: "q2", position: "QB", marketRank: 1, projectedPoints: 250 },
  { playerId: "r1", position: "RB", marketRank: 2, projectedPoints: 200 },
  { playerId: "r2", position: "RB", marketRank: 3, projectedPoints: 150 },
];

describe("gradeEvidenceMaps", () => {
  it("carries raw projected points straight through, unmodified by league shape", () => {
    const { pointsByPlayerId } = gradeEvidenceMaps(POOL, SHAPE);
    expect(pointsByPlayerId.get("q1")).toBe(300);
    expect(pointsByPlayerId.get("r2")).toBe(150);
  });

  it("values every player over this league's own replacement level, indexed by id", () => {
    const { valueByPlayerId } = gradeEvidenceMaps(POOL, SHAPE);
    // A 2-team, 1-QB/1-RB league starts 2 QBs and 2 RBs: replacement is the worst starter at
    // each position, so both q2 and r2 (themselves the replacement level) value at exactly 0.
    expect(valueByPlayerId.get("q1")).toBe(50);
    expect(valueByPlayerId.get("q2")).toBe(0);
    expect(valueByPlayerId.get("r1")).toBe(50);
    expect(valueByPlayerId.get("r2")).toBe(0);
  });

  it("omits a player the pool never carried", () => {
    const { pointsByPlayerId, valueByPlayerId } = gradeEvidenceMaps([], SHAPE);
    expect(pointsByPlayerId.size).toBe(0);
    expect(valueByPlayerId.size).toBe(0);
  });
});
