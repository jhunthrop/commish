import type { DraftAction, StartDraftAction } from "@/domain/draft";
import { auctionOf, totalRosterSlots, type DraftReduceResult, type DraftState } from "./state";
import { AUCTION_CONFIG } from "./config";
import { currentDeadline } from "./selectors";
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
  if (isAuction && (budget as number) < totalRosterSlots(state.config.slotConfig) * AUCTION_CONFIG.minBid) {
    return { ok: false, reason: `An auction budget must be at least $${AUCTION_CONFIG.minBid} for every roster spot.` };
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
      // The `draftOrder.length < 2` guard above already rejects any draft order without a
      // first team, so `[0]` is always defined here — no `?? null` fallback needed.
      auction: isAuction ? { nominatingTeamId: action.draftOrder[0]!, lot: null } : null,
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
      // Checked once, here, so every expiry producer (the ticker today, anything else
      // later) inherits it: a clock can only be expired once it has actually run out.
      // This closes a check-then-act race — the ticker reads state and computes a
      // deadline in one step, then submits TIMER_EXPIRE in a later, separate step; a
      // legitimate action can land in between and start a fresh clock for someone else,
      // and the ticker's now-stale timestamp must not be allowed to expire THAT clock.
      // No clock running (`currentDeadline` null) means nothing to guard — allow through.
      const deadline = currentDeadline(state);
      if (deadline !== null && Date.parse(action.timestamp) < Date.parse(deadline)) {
        return { ok: false, reason: "The clock hasn't run out yet." };
      }
      const auction = auctionOf(state);
      return auction === null
        ? reduceSnakeExpiry(state, action.timestamp)
        : reduceAuctionExpiry(state, auction, action.timestamp);
    }
  }
}
