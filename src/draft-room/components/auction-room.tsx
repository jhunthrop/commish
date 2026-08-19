"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import type { Player } from "@/domain/player";
import type { ClientDraftAction } from "@/draft-engine";
import type { DraftRoom as DraftRoomState } from "../hooks/use-draft-room";
import { useQueueHandlers } from "../hooks/use-queue-handlers";
import { playerName } from "../lib/lookups";
import { BidControls } from "./bid-controls";
import { BudgetTable } from "./budget-table";
import { NominateModal } from "./nominate-modal";
import { RoomShell } from "./room-shell";

export interface AuctionRoomProps {
  readonly room: DraftRoomState;
  readonly playersById: ReadonlyMap<string, Player>;
  readonly onAct: (action: ClientDraftAction) => void;
  /** The social band down the right edge (league chat), or nothing. Built by `DraftRoom`. */
  readonly aside?: ReactNode;
}

export function AuctionRoom({ room, playersById, onAct, aside }: AuctionRoomProps) {
  const view = room.view!;
  const [nominating, setNominating] = useState<string | null>(null);
  // Affordance only. `onClockTeamId` is the engine's nominator, and it is null while a lot is live.
  const canNominate = view.phase === "in_progress" && room.myTeamId !== null && view.onClockTeamId === room.myTeamId;
  const queueHandlers = useQueueHandlers(room);
  const lotIsLive = view.auction?.lot != null;

  return (
    <>
      <RoomShell
        room={room}
        view={view}
        playersById={playersById}
        canAct={canNominate}
        actionLabel="Nominate"
        onAct={setNominating}
        {...queueHandlers}
        poolFooter={<BudgetTable view={view} teams={room.teams} myTeamId={room.myTeamId} />}
        bidConsole={
          lotIsLive ? (
            <BidControls view={view} myTeamId={room.myTeamId} submitting={room.submitting} onBid={(amount) => onAct({ type: "BID", amount })} />
          ) : null
        }
        aside={aside}
      />
      {/* `view.minBid` is only null before an auction has started (`draftStateView`,
          `src/draft-engine/selectors.ts`) — the modal itself only ever opens once `canNominate`
          is true, which already implies `phase === "in_progress"`, but narrowing here (rather
          than defaulting to a magic `1` inside the modal) is what lets `NominateModal` require
          a plain `number` instead of re-deriving a fallback of its own. */}
      {view.minBid === null ? null : (
        <NominateModal
          open={nominating !== null}
          playerId={nominating}
          playerName={nominating === null ? "" : playerName(playersById, nominating)}
          view={view}
          minBid={view.minBid}
          myTeamId={room.myTeamId}
          onClose={() => setNominating(null)}
          onNominate={(playerId, openingBid) => {
            setNominating(null);
            onAct({ type: "NOMINATE", playerId, openingBid });
          }}
        />
      )}
    </>
  );
}
