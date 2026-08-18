import type { BidAction, NominateAction } from "@/domain/draft";
import { rosterFor, type AuctionState, type DraftReduceResult, type DraftState } from "./state";
import { assignSlot } from "./slotting";
import { applyPick, expectApplied } from "./apply-pick";
import { bestAvailableFor, nextNominator, remainingBudget } from "./selectors";

/**
 * Every function here takes the already-resolved `AuctionState`. The "is this even an
 * auction" question is answered once, in `reduce.ts`'s dispatch, so these functions have no
 * unreachable null-guard to defend (and no unreachable branch to chase for coverage).
 *
 * The nomination rotation itself (`nextNominator`) lives in `selectors.ts`, because the
 * lookahead `upcomingOnClock` publishes on the clock view walks exactly the same rotation —
 * one walk, imported by both, rather than two that could drift.
 */

/**
 * Shared guard: this team can still roster this player. The money half — the bid floor, the
 * increment and the budget ceiling — reads `AUCTION_CONFIG` and therefore lives in `admit.ts`,
 * so that raising a bid tunable can never make a persisted NOMINATE or BID unreplayable.
 */
function checkRosterable(state: DraftState, teamId: string, playerId: string): string | null {
  const entry = state.pool.find((p) => p.playerId === playerId);
  if (entry === undefined) return "That player isn't in this draft's player pool.";
  const assignment = assignSlot({ position: entry.position, roster: rosterFor(state, teamId), slotConfig: state.config.slotConfig });
  if (!assignment.ok) return assignment.reason;
  return null;
}

export function reduceNominate(state: DraftState, auction: AuctionState, action: NominateAction): DraftReduceResult {
  if (auction.lot !== null) return { ok: false, reason: "There's already a player up for bid." };
  if (auction.nominatingTeamId !== action.teamId) return { ok: false, reason: "It's not your turn to nominate." };
  if (state.picks.some((p) => p.playerId === action.playerId)) {
    return { ok: false, reason: "That player has already been drafted." };
  }
  const problem = checkRosterable(state, action.teamId, action.playerId);
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
      ...state.auction!,
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
  const problem = checkRosterable(state, action.teamId, lot.playerId);
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
    return { ok: true, state: openLot(state, nominator, best.playerId, auction.minBid, timestamp, true) };
  }

  const winner = lot.highBidTeamId;
  const applied = applyPick(state, {
    teamId: winner,
    playerId: lot.playerId,
    price: lot.highBid,
    auto: lot.autoNominated && winner === lot.nominatedByTeamId,
    timestamp,
  });
  const wonState = expectApplied(
    applied,
    "auction award: high bidder was validated at bid time and no roster changed while the lot was open",
  );

  const paid: DraftState = {
    ...wonState,
    budgets: { ...wonState.budgets, [winner]: remainingBudget(wonState, winner) - lot.highBid },
    pickNumber: wonState.pickNumber + 1,
  };
  const nominator = nextNominator(paid, lot.nominatedByTeamId);
  return {
    ok: true,
    state:
      nominator === null
        ? { ...paid, phase: "complete", auction: { ...auction, nominatingTeamId: null, lot: null }, turnStartedAt: null }
        : { ...paid, auction: { ...auction, nominatingTeamId: nominator, lot: null }, turnStartedAt: timestamp },
  };
}
