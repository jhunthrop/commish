"use client";

import { useState } from "react";
import type { Player } from "@/domain/player";
import type { ClientDraftAction } from "@/draft-engine";
import type { DraftRoom as DraftRoomState } from "../hooks/use-draft-room";
import { useQueueHandlers } from "../hooks/use-queue-handlers";
import { playerName } from "../lib/lookups";
import { BidControls } from "./bid-controls";
import { BudgetTable } from "./budget-table";
import { DraftBoard } from "./draft-board";
import { NominateModal } from "./nominate-modal";
import { NudgeBanner } from "./nudge-banner";
import { PickCelebration } from "./pick-celebration";
import { PlayerPool } from "./player-pool";
import { RoomDock } from "./room-dock";
import { RoomLayout } from "./room-layout";
import { RoomRail } from "./room-rail";

export interface AuctionRoomProps {
  readonly room: DraftRoomState;
  readonly playersById: ReadonlyMap<string, Player>;
  readonly onAct: (action: ClientDraftAction) => void;
}

export function AuctionRoom({ room, playersById, onAct }: AuctionRoomProps) {
  const view = room.view!;
  const [nominating, setNominating] = useState<string | null>(null);
  // Affordance only. `onClockTeamId` is the engine's nominator, and it is null while a lot is live.
  const canNominate = view.phase === "in_progress" && room.myTeamId !== null && view.onClockTeamId === room.myTeamId;
  const { queuedPlayerIds, onQueueChange, onQueueToggle } = useQueueHandlers(room);
  const lotIsLive = view.auction?.lot != null;

  return (
    <>
      <RoomLayout
        rail={
          <RoomRail
            leagueName={room.leagueName}
            view={view}
            teams={room.teams}
            myTeamId={room.myTeamId}
            playersById={playersById}
            connection={room.connection}
          />
        }
        pool={
          // Money sits under the players you would spend it on. It is the one auction fact the
          // board and the rail cannot carry — a sticker shows what a pick COST, never what
          // anybody has left — so it gets the foot of this column and nowhere else.
          <div className="flex h-full min-h-0 flex-col">
            <div className="min-h-0 flex-1">
              <PlayerPool
                players={room.players}
                view={view}
                pendingPlayerId={room.pendingPlayerId}
                canAct={canNominate}
                actionLabel="Nominate"
                submitting={room.submitting}
                onAct={setNominating}
                queuedPlayerIds={queuedPlayerIds}
                onQueue={onQueueToggle}
              />
            </div>
            <div className="max-h-48 shrink-0 overflow-auto border-t border-border p-3">
              <BudgetTable view={view} teams={room.teams} myTeamId={room.myTeamId} />
            </div>
          </div>
        }
        stage={
          <div className="flex h-full min-h-0 flex-col gap-3 p-4">
            <NudgeBanner nudge={room.nudge} sequence={view.sequence} />
            <PickCelebration lastPick={room.lastPick} playersById={playersById} teams={room.teams} />
            <DraftBoard
              view={view}
              teams={room.teams}
              playersById={playersById}
              myTeamId={room.myTeamId}
              landedPickNumber={room.lastPick?.pick.pickNumber ?? null}
            />
          </div>
        }
        dock={
          <RoomDock
            view={view}
            queue={room.queue}
            playersById={playersById}
            myTeamId={room.myTeamId}
            submitting={room.submitting}
            canAct={canNominate}
            actionLabel="Nominate"
            onAct={setNominating}
            onQueueChange={onQueueChange}
            bidConsole={
              lotIsLive ? (
                <BidControls view={view} myTeamId={room.myTeamId} submitting={room.submitting} onBid={(amount) => onAct({ type: "BID", amount })} />
              ) : null
            }
          />
        }
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
