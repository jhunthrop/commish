/**
 * "CHANGED SINCE 4.03" — spec 3.1: what moved between the plan the manager last saw and the
 * one on screen. Pure over two `DraftPlan`s, on the client, because only the client knows which
 * plan the manager last looked at. A named target whose odds at his own turn moved by more than
 * the band, or one no longer on the plan (taken, or dropped as a reach).
 */
import type { DraftPlan, PlanTarget } from "@/draft-service/assistant/view";
import { ADVISOR_ROOM_CONFIG } from "./config";

export type PlanChange =
  | { readonly kind: "odds_moved"; readonly playerId: string; readonly turn: number; readonly from: number; readonly to: number }
  | { readonly kind: "left_plan"; readonly playerId: string; readonly turn: number };

function targetsByTurn(plan: DraftPlan): ReadonlyMap<string, { readonly turn: number; readonly target: PlanTarget }> {
  return new Map(plan.turns.flatMap((turn) => turn.targets.map((target) => [target.playerId, { turn: turn.turn, target }] as const)));
}

export function planDelta(previous: DraftPlan, current: DraftPlan): readonly PlanChange[] {
  const band = ADVISOR_ROOM_CONFIG.changedOddsBand;
  const now = targetsByTurn(current);
  const changes: PlanChange[] = [];
  for (const [playerId, { turn, target }] of targetsByTurn(previous)) {
    const latest = now.get(playerId);
    if (latest === undefined) {
      changes.push({ kind: "left_plan", playerId, turn });
      continue;
    }
    const from = target.oddsByTurn[turn - 1]?.survival;
    const to = latest.target.oddsByTurn[latest.turn - 1]?.survival;
    if (from !== undefined && to !== undefined && Math.abs(to - from) > band) changes.push({ kind: "odds_moved", playerId, turn: latest.turn, from, to });
  }
  return changes;
}
