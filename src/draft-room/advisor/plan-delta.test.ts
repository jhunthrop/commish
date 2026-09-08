import { describe, expect, it } from "vitest";
import type { DraftPlan, PlanTarget } from "@/draft-service/assistant/view";
import { planDelta } from "./plan-delta";

function target(playerId: string, survival: number): PlanTarget {
  return { playerId, position: "RB", valueOverReplacement: 40, positionRank: 4, oddsByTurn: [{ survival, runs: 200 }, null, null], reachFromTurn: null };
}

function plan(targets: readonly PlanTarget[], computedAtPick = 4): DraftPlan {
  return { computedAtPick, runs: 200, horizon: 3, reachFloor: 0.25, turns: [{ turn: 1, pickNumber: 17, round: 2, position: "RB", targets, fallback: null }] };
}

describe("planDelta", () => {
  it("reports nothing when the plan is unchanged", () => {
    const p = plan([target("rb4", 0.5)]);
    expect(planDelta(p, p)).toEqual([]);
  });

  it("names a target whose odds moved past the band, and one who left the plan, and ignores a move inside the band", () => {
    const before = plan([target("rb4", 0.5), target("rb5", 0.7), target("rb6", 0.9)]);
    const after = plan([target("rb4", 0.2), target("rb6", 0.8)], 5);
    expect(planDelta(before, after)).toEqual([
      { kind: "odds_moved", playerId: "rb4", turn: 1, from: 0.5, to: 0.2 },
      { kind: "left_plan", playerId: "rb5", turn: 1 },
    ]);
  });
});
