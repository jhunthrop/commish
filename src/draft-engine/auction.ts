import type { BidAction, NominateAction } from "@/domain/draft";
import { rosterFor, type AuctionState, type DraftReduceResult, type DraftState } from "./state";
import { AUCTION_CONFIG } from "./config";
import { assignSlot } from "./slotting";
import { applyPick } from "./apply-pick";
import { bestAvailableFor, maxBidFor, openSlotCount, remainingBudget } from "./selectors";

/**
 * Every function here takes the already-resolved `AuctionState`. The "is this even an
 * auction" question is answered once, in `reduce.ts`'s dispatch, so these functions have no
 * unreachable null-guard to defend (and no unreachable branch to chase for coverage).
 */

/** Next team in nomination order after `afterTeamId`, skipping full rosters. Null when nobody can nominate. */
export function nextNominator(state: DraftState, afterTeamId: string): string | null {
  const order = state.draftOrder;
  const start = order.indexOf(afterTeamId);
  const rotated = [...order.slice(start + 1), ...order.slice(0, start + 1)];
  return rotated.find((teamId) => openSlotCount(state, teamId) > 0) ?? null;
}

/** Shared guard: this team can still roster this player, and the amount is within their budget. */
function checkAffordable(state: DraftState, teamId: string, playerId: string, amount: number): string | null {
  const entry = state.pool.find((p) => p.playerId === playerId);
  if (entry === undefined) return "That player isn't in this draft's player pool.";
  const assignment = assignSlot({ position: entry.position, roster: rosterFor(state, teamId), slotConfig: state.config.slotConfig });
  if (!assignment.ok) return assignment.reason;
  const max = maxBidFor(state, teamId);
  if (amount > max) {
    return `You can only bid up to $${max} — you need $${AUCTION_CONFIG.reservePerOpenSlot} for each of your remaining roster spots.`;
  }
  return null;
}

export function reduceNominate(state: DraftState, auction: AuctionState, action: NominateAction): DraftReduceResult {
  if (auction.lot !== null) return { ok: false, reason: "There's already a player up for bid." };
  if (auction.nominatingTeamId !== action.teamId) return { ok: false, reason: "It's not your turn to nominate." };
  if (action.openingBid < AUCTION_CONFIG.minBid) {
    return { ok: false, reason: `The opening bid must be at least $${AUCTION_CONFIG.minBid}.` };
  }
  if (state.picks.some((p) => p.playerId === action.playerId)) {
    return { ok: false, reason: "That player has already been drafted." };
  }
  const problem = checkAffordable(state, action.teamId, action.playerId, action.openingBid);
  if (problem !== null) return { ok: false, reason: problem };
  return { ok: true, state: openLot(state, action.teamId, action.playerId, action.openingBid, action.timestamp, false) };
}

function openLot(
  state: DraftState,
  teamId: string,
  playerId: string,
  amount: number,
  timestamp: string,
  autoNominated: boolean,
): DraftState {
  return {
    ...state,
    auction: {
      nominatingTeamId: teamId,
      lot: { playerId, highBid: amount, highBidTeamId: teamId, nominatedByTeamId: teamId, autoNominated },
    },
    turnStartedAt: timestamp,
  };
}

export function reduceBid(state: DraftState, auction: AuctionState, action: BidAction): DraftReduceResult {
  const lot = auction.lot;
  if (lot === null) return { ok: false, reason: "There's no player up for bid right now." };
  if (lot.highBidTeamId === action.teamId) return { ok: false, reason: "You can't outbid yourself." };
  const minimum = lot.highBid + AUCTION_CONFIG.bidIncrement;
  if (action.amount < minimum) return { ok: false, reason: `Your bid must be at least $${minimum}.` };
  const problem = checkAffordable(state, action.teamId, lot.playerId, action.amount);
  if (problem !== null) return { ok: false, reason: problem };
  return {
    ok: true,
    state: {
      ...state,
      auction: { ...auction, lot: { ...lot, highBid: action.amount, highBidTeamId: action.teamId } },
      turnStartedAt: action.timestamp,
    },
  };
}

/**
 * The clock ran out. With a lot open, the high bidder wins it at the high bid and the
 * nomination rotates. With no lot open, the nominating team stalled, so the clock
 * nominates their best available player at the minimum bid.
 */
export function reduceAuctionExpiry(state: DraftState, auction: AuctionState, timestamp: string): DraftReduceResult {
  const lot = auction.lot;

  if (lot === null) {
    // `nominatingTeamId` is only ever null together with `phase: "complete"`, and
    // `reduceDraft` rejects every action once the draft is complete before dispatch
    // reaches here — so a live call always has a real nominator.
    const nominator = auction.nominatingTeamId!;
    const best = bestAvailableFor(state, nominator);
    if (best === null) return { ok: false, reason: "No eligible player is available to auto-pick." };
    return { ok: true, state: openLot(state, nominator, best.playerId, AUCTION_CONFIG.minBid, timestamp, true) };
  }

  const winner = lot.highBidTeamId;
  // The winner's budget and roster space were already validated by checkAffordable when
  // they placed the bid or nomination that made them the high bidder (reduceBid /
  // reduceNominate), and nothing else can touch their roster or budget while this lot is
  // still open — applyPick can never fail here.
  const applied = applyPick(state, {
    teamId: winner,
    playerId: lot.playerId,
    price: lot.highBid,
    auto: lot.autoNominated && winner === lot.nominatedByTeamId,
    timestamp,
  }) as { readonly ok: true; readonly state: DraftState };

  const paid: DraftState = {
    ...applied.state,
    budgets: { ...applied.state.budgets, [winner]: remainingBudget(applied.state, winner) - lot.highBid },
    pickNumber: applied.state.pickNumber + 1,
  };
  const nominator = nextNominator(paid, lot.nominatedByTeamId);
  return {
    ok: true,
    state:
      nominator === null
        ? { ...paid, phase: "complete", auction: { nominatingTeamId: null, lot: null }, turnStartedAt: null }
        : { ...paid, auction: { nominatingTeamId: nominator, lot: null }, turnStartedAt: timestamp },
  };
}
