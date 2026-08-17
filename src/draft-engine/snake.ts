import type { MakePickAction } from "@/domain/draft";
import { totalRosterSlots, type DraftReduceResult, type DraftState } from "./state";
import { snakeTeamForPick } from "./order";
import { applyPick } from "./apply-pick";
import { bestAvailableFor } from "./selectors";

/** Moves to the next pick, or ends the draft once every roster spot is filled. */
export function advanceSnake(state: DraftState, timestamp: string): DraftState {
  const next = state.pickNumber + 1;
  const totalPicks = state.draftOrder.length * totalRosterSlots(state.config.slotConfig);
  return next > totalPicks
    ? { ...state, pickNumber: next, phase: "complete", turnStartedAt: null }
    : { ...state, pickNumber: next, turnStartedAt: timestamp };
}

export function reduceMakePick(state: DraftState, action: MakePickAction): DraftReduceResult {
  if (state.config.format !== "snake") {
    return { ok: false, reason: "This is an auction draft — nominate a player instead of picking." };
  }
  if (snakeTeamForPick(state.draftOrder, state.pickNumber) !== action.teamId) {
    return { ok: false, reason: "It's not your turn to pick." };
  }
  const applied = applyPick(state, {
    teamId: action.teamId,
    playerId: action.playerId,
    price: null,
    auto: false,
    timestamp: action.timestamp,
  });
  if (!applied.ok) return applied;
  return { ok: true, state: advanceSnake(applied.state, action.timestamp) };
}

/**
 * Autopick policy: the highest-ranked undrafted player the team on the clock can legally
 * roster. `state.pool` is the ranking — an explicit input snapshotted at START_DRAFT — so
 * the same action log always produces the same autopick.
 */
export function reduceSnakeExpiry(state: DraftState, timestamp: string): DraftReduceResult {
  const teamId = snakeTeamForPick(state.draftOrder, state.pickNumber);
  const best = bestAvailableFor(state, teamId);
  if (best === null) return { ok: false, reason: "No eligible player is available to auto-pick." };
  const applied = applyPick(state, { teamId, playerId: best.playerId, price: null, auto: true, timestamp });
  if (!applied.ok) return applied;
  return { ok: true, state: advanceSnake(applied.state, timestamp) };
}
