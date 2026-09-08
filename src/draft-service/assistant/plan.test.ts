import { describe, expect, it } from "vitest";
import { teamOnClock } from "@/draft-engine";
import { upcomingTurnsFor } from "../sim/horizon-odds";
import { ADVISOR_CONFIG } from "./config";
import { computePlan, planDelta } from "./plan";
import { FIXTURE_TEAM_IDS, fixtureAdvance, fixtureStart, fixtureValued } from "./test-fixture";

const ASKING = FIXTURE_TEAM_IDS[3]!; // seat 4 of 10: picks 4, 17, 24, 37, ...
const RUNS = 40;

function planAfter(picks: number) {
  const state = fixtureAdvance(fixtureStart(), picks);
  return { state, result: computePlan({ state, askingTeamId: ASKING, valued: fixtureValued(), seed: 5, runs: RUNS }) };
}

describe("computePlan", () => {
  it("plans one turn per upcoming turn, stamped with the pick it was computed at and the runs behind it", () => {
    const { state, result } = planAfter(3);
    expect(teamOnClock(state)).toBe(ASKING);
    const { plan } = result;
    expect(plan.computedAtPick).toBe(4);
    expect(plan.runs).toBe(RUNS);
    expect(plan.horizon).toBe(ADVISOR_CONFIG.plan.horizon);
    expect(plan.reachFloor).toBe(ADVISOR_CONFIG.plan.reachFloor);
    expect(plan.turns.map((turn) => turn.pickNumber)).toEqual(upcomingTurnsFor(state, ASKING, ADVISOR_CONFIG.plan.horizon));
    expect(plan.turns.map((turn) => turn.turn)).toEqual([1, 2, 3]);
    expect(plan.turns.map((turn) => turn.round)).toEqual([2, 3, 4]);
  });

  it("every target clears the reach floor at its own turn, carries odds per column with the run count, and names its position", () => {
    const { plan } = planAfter(3).result;
    for (const turn of plan.turns) {
      expect(turn.targets.length).toBeGreaterThan(0);
      expect(turn.targets.length).toBeLessThanOrEqual(ADVISOR_CONFIG.plan.targetsPerTurn);
      for (const target of turn.targets) {
        expect(target.position).toBe(turn.position);
        const own = target.oddsByTurn[turn.turn - 1];
        expect(own).not.toBeNull();
        expect(own!.survival).toBeGreaterThanOrEqual(plan.reachFloor);
        expect(own!.runs).toBe(RUNS);
        expect(target.oddsByTurn).toHaveLength(plan.turns.length);
        if (target.reachFromTurn !== null) expect(target.reachFromTurn).toBeGreaterThan(turn.turn);
      }
    }
  });

  it("never names the same target at two turns, and a fallback clears the fallback floor at its turn", () => {
    const { plan } = planAfter(3).result;
    const named = plan.turns.flatMap((turn) => turn.targets.map((target) => target.playerId));
    expect(new Set(named).size).toBe(named.length);
    for (const turn of plan.turns) {
      if (turn.fallback === null) continue;
      expect(turn.fallback.position).toBe(turn.position);
      expect(turn.fallback.oddsByTurn[turn.turn - 1]!.survival).toBeGreaterThanOrEqual(ADVISOR_CONFIG.plan.fallbackFloor);
      expect(named).not.toContain(turn.fallback.playerId);
    }
  });

  it("targets no kicker or defence while starters are still open", () => {
    const { plan } = planAfter(3).result;
    for (const turn of plan.turns) expect(["K", "DEF"]).not.toContain(turn.position);
  });

  it("is reproducible for the same state and seed", () => {
    const a = planAfter(12).result.plan;
    const b = planAfter(12).result.plan;
    expect(a).toEqual(b);
  });

  it("has no turns when the asking seat has no upcoming turn", () => {
    const state = fixtureAdvance(fixtureStart(), 149); // pick 150 of 150 is up; seat 4 finished earlier
    expect(teamOnClock(state)).not.toBe(ASKING);
    const { plan } = computePlan({ state, askingTeamId: ASKING, valued: fixtureValued(), seed: 1, runs: 5 });
    expect(plan.turns).toEqual([]);
  });
});

describe("planDelta", () => {
  it("reports nothing when the plan is unchanged", () => {
    const { plan } = planAfter(3).result;
    expect(planDelta(plan, plan)).toEqual([]);
  });

  it("names a target whose odds moved past the band, and one who left the plan", () => {
    const before = planAfter(3).result.plan;
    const first = before.turns[0]!;
    const moved = { ...first.targets[0]!, oddsByTurn: first.targets[0]!.oddsByTurn.map((cell) => (cell === null ? null : { ...cell, survival: Math.max(0, cell.survival - 0.5) })) };
    const after = { ...before, computedAtPick: before.computedAtPick + 1, turns: [{ ...first, targets: [moved] }, ...before.turns.slice(1)] };
    const delta = planDelta(before, after);
    expect(delta.some((change) => change.kind === "odds_moved" && change.playerId === moved.playerId)).toBe(true);
    const gone = first.targets.slice(1).map((target) => target.playerId);
    for (const id of gone) expect(delta.some((change) => change.kind === "left_plan" && change.playerId === id)).toBe(true);
  });
});
