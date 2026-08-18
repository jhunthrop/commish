import type { ClientDraftAction, DraftStateView } from "@/draft-engine";

export interface OptimisticPatch {
  readonly view: DraftStateView;
  /** The player this user is committing to — rendered as "pending" until the server answers. */
  readonly pendingPlayerId: string | null;
}

/**
 * The acting client's instant feedback — what makes a draft feel live for the person acting,
 * exactly as the spec's "optimistic UI" bullet requires.
 *
 * Deliberately DISPLAY-ONLY. It never guesses a roster slot, a round, a price, a budget, a
 * next-bid floor (`minBid`) or a turn change, because every one of those is a draft rule the
 * engine owns. The authoritative view arrives in the POST response (or over SSE) moments
 * later and replaces this one.
 */
export function optimisticView(view: DraftStateView, action: ClientDraftAction, myTeamId: string | null): OptimisticPatch {
  if (myTeamId === null) return { view, pendingPlayerId: null };

  switch (action.type) {
    case "MAKE_PICK":
      return {
        view: { ...view, availablePlayerIds: view.availablePlayerIds.filter((id) => id !== action.playerId) },
        pendingPlayerId: action.playerId,
      };
    case "NOMINATE":
      if (view.auction === null) return { view, pendingPlayerId: action.playerId };
      return {
        view: {
          ...view,
          auction: {
            ...view.auction,
            nominatingTeamId: myTeamId,
            lot: { playerId: action.playerId, highBid: action.openingBid, highBidTeamId: myTeamId, nominatedByTeamId: myTeamId, autoNominated: false },
          },
        },
        pendingPlayerId: action.playerId,
      };
    case "BID": {
      const auction = view.auction;
      if (auction === null || auction.lot === null) return { view, pendingPlayerId: null };
      return {
        view: { ...view, auction: { ...auction, lot: { ...auction.lot, highBid: action.amount, highBidTeamId: myTeamId } } },
        pendingPlayerId: auction.lot.playerId,
      };
    }
  }
}
