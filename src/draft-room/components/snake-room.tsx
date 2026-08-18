"use client";

import type { Player } from "@/domain/player";
import type { ClientDraftAction } from "@/draft-engine";
import type { DraftRoom as DraftRoomState } from "../hooks/use-draft-room";
import { useQueueHandlers } from "../hooks/use-queue-handlers";
import { DraftBoard } from "./draft-board";
import { NudgeBanner } from "./nudge-banner";
import { PickCelebration } from "./pick-celebration";
import { PlayerPool } from "./player-pool";
import { RoomDock } from "./room-dock";
import { RoomLayout } from "./room-layout";
import { RoomRail } from "./room-rail";

export interface SnakeRoomProps {
  readonly room: DraftRoomState;
  readonly playersById: ReadonlyMap<string, Player>;
  readonly onAct: (action: ClientDraftAction) => void;
}

export function SnakeRoom({ room, playersById, onAct }: SnakeRoomProps) {
  const view = room.view!;
  // Affordance only — the server decides. `onClockTeamId` is the engine's answer, not ours.
  const canAct = view.phase === "in_progress" && room.myTeamId !== null && view.onClockTeamId === room.myTeamId;
  const { queuedPlayerIds, onQueueChange, onQueueToggle } = useQueueHandlers(room);
  const draft = (playerId: string): void => onAct({ type: "MAKE_PICK", playerId });

  return (
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
        <PlayerPool
          players={room.players}
          view={view}
          pendingPlayerId={room.pendingPlayerId}
          canAct={canAct}
          actionLabel="Draft"
          submitting={room.submitting}
          onAct={draft}
          queuedPlayerIds={queuedPlayerIds}
          onQueue={onQueueToggle}
        />
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
          canAct={canAct}
          actionLabel="Draft"
          onAct={draft}
          onQueueChange={onQueueChange}
        />
      }
    />
  );
}
