import type { TradeRoomContext } from "../contract";
import { TradeInbox } from "./trade-inbox";

export interface RoomSurfaceTradesProps {
  readonly leagueId: string;
  readonly tradeContext: TradeRoomContext | null;
}

/** The trades surface at any drawer height: the same inbox/composer the trades route serves.
 *  A commissioner with no team has nothing tradeable, and the surface says so. */
export function RoomSurfaceTrades({ leagueId, tradeContext }: RoomSurfaceTradesProps) {
  if (tradeContext === null) {
    return <p className="text-sm text-text-muted">You do not have a team in this league, so there is nothing to trade.</p>;
  }
  return <TradeInbox leagueId={leagueId} context={tradeContext} />;
}
