import type { DraftAction, StartDraftAction } from "@/domain/draft";
import { auctionOf, totalRosterSlots, type DraftReduceResult, type DraftState } from "./state";
import { reduceMakePick, reduceSnakeExpiry } from "./snake";
import { reduceAuctionExpiry, reduceBid, reduceNominate } from "./auction";

export type { DraftReduceResult } from "./state";

function reduceStart(state: DraftState, action: StartDraftAction): DraftReduceResult {
  if (state.phase !== "scheduled") return { ok: false, reason: "This draft has already started." };
  if (action.draftOrder.length < 2) return { ok: false, reason: "A draft needs at least two teams." };
  if (new Set(action.draftOrder).size !== action.draftOrder.length) {
    return { ok: false, reason: "Every team may appear in the draft order only once." };
  }
  if (new Set(action.pool.map((p) => p.playerId)).size !== action.pool.length) {
    return { ok: false, reason: "Every player may appear in the draft pool only once." };
  }
  const isAuction = state.config.format === "auction";
  const budget = state.config.auctionBudget;
  if (isAuction && (budget === null || budget <= 0)) {
    return { ok: false, reason: "An auction draft needs a budget before it can start." };
  }
  if (isAuction && (budget as number) < totalRosterSlots(state.config.slotConfig)) {
    return { ok: false, reason: "An auction budget must be at least $1 for every roster spot." };
  }
  const rosters = Object.fromEntries(action.draftOrder.map((teamId) => [teamId, []]));
  const budgets = isAuction ? Object.fromEntries(action.draftOrder.map((teamId) => [teamId, budget as number])) : {};
  return {
    ok: true,
    state: {
      ...state,
      phase: "in_progress",
      draftOrder: action.draftOrder,
      pool: action.pool,
      rosters,
      budgets,
      auction: isAuction ? { nominatingTeamId: action.draftOrder[0] ?? null, lot: null } : null,
      pickNumber: 1,
      turnStartedAt: action.timestamp,
    },
  };
}

/**
 * The one draft reducer. Pure: no I/O, no ambient clock — every action carries its own
 * `timestamp`. On success the returned state's `sequence` is exactly one higher, which is
 * what the durable store uses as its optimistic-concurrency expectation.
 */
export function reduceDraft(state: DraftState, action: DraftAction): DraftReduceResult {
  if (action.type !== "START_DRAFT") {
    if (state.phase === "scheduled") return { ok: false, reason: "This draft hasn't started yet." };
    if (state.phase === "complete") return { ok: false, reason: "This draft has already finished." };
  }
  const result = dispatch(state, action);
  if (!result.ok) return result;
  return { ok: true, state: { ...result.state, sequence: state.sequence + 1 } };
}

function dispatch(state: DraftState, action: DraftAction): DraftReduceResult {
  switch (action.type) {
    case "START_DRAFT":
      return reduceStart(state, action);
    case "MAKE_PICK":
      return reduceMakePick(state, action);
    case "NOMINATE": {
      const auction = auctionOf(state);
      return auction === null
        ? { ok: false, reason: "This is a snake draft — make a pick instead of nominating." }
        : reduceNominate(state, auction, action);
    }
    case "BID": {
      const auction = auctionOf(state);
      return auction === null
        ? { ok: false, reason: "This is a snake draft — there's nothing to bid on." }
        : reduceBid(state, auction, action);
    }
    case "TIMER_EXPIRE": {
      const auction = auctionOf(state);
      return auction === null
        ? reduceSnakeExpiry(state, action.timestamp)
        : reduceAuctionExpiry(state, auction, action.timestamp);
    }
  }
}
