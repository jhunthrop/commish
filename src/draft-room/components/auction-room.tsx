"use client";

import { useState } from "react";
import type { Player } from "@/domain/player";
import type { ClientDraftAction } from "@/draft-engine";
import type { DraftRoom as DraftRoomState } from "../hooks/use-draft-room";
import { useQueueHandlers } from "../hooks/use-queue-handlers";
import { playerName } from "../lib/lookups";
import { DraftBoard } from "./draft-board";
import { RoomHeader } from "./room-header";
import { NudgeBanner } from "./nudge-banner";
import { PickCelebration } from "./pick-celebration";
import { AuctionLotPanel } from "./auction-lot";
import { BidControls } from "./bid-controls";
import { NominateModal } from "./nominate-modal";
import { BudgetTable } from "./budget-table";
import { PlayerPool } from "./player-pool";
import { QueuePanel } from "./queue-panel";
import { RosterBoard } from "./roster-board";
import { PickHistory } from "./pick-history";

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

  return (
    <div className="flex flex-col gap-4">
      <RoomHeader leagueName={room.leagueName} view={view} teams={room.teams} myTeamId={room.myTeamId} playersById={playersById} />
      <NudgeBanner nudge={room.nudge} sequence={view.sequence} />
      <DraftBoard
        view={view}
        teams={room.teams}
        playersById={playersById}
        myTeamId={room.myTeamId}
        landedPickNumber={room.lastPick?.pick.pickNumber ?? null}
      />
      <PickCelebration lastPick={room.lastPick} playersById={playersById} teams={room.teams} />
      <AuctionLotPanel view={view} teams={room.teams} playersById={playersById} />
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="flex flex-col gap-4">
          <BidControls view={view} myTeamId={room.myTeamId} submitting={room.submitting} onBid={(amount) => onAct({ type: "BID", amount })} />
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
        <div className="flex flex-col gap-4">
          <BudgetTable view={view} teams={room.teams} myTeamId={room.myTeamId} />
          <RosterBoard view={view} teams={room.teams} playersById={playersById} myTeamId={room.myTeamId} />
          <QueuePanel
            queue={room.queue}
            playersById={playersById}
            availablePlayerIds={view.availablePlayerIds}
            busy={room.submitting}
            onChange={onQueueChange}
          />
          <PickHistory view={view} teams={room.teams} playersById={playersById} />
        </div>
      </div>
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
    </div>
  );
}
