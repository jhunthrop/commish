"use client";

import type { Player } from "@/domain/player";
import type { ClientDraftAction } from "@/draft-engine";
import type { DraftRoom as DraftRoomState } from "../hooks/use-draft-room";
import { useQueueHandlers } from "../hooks/use-queue-handlers";
import { DraftBoard } from "./draft-board";
import { RoomHeader } from "./room-header";
import { NudgeBanner } from "./nudge-banner";
import { PickCelebration } from "./pick-celebration";
import { PlayerPool } from "./player-pool";
import { QueuePanel } from "./queue-panel";
import { RosterBoard } from "./roster-board";
import { PickHistory } from "./pick-history";

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
      <div className="grid gap-4 lg:grid-cols-2">
        <PlayerPool
          players={room.players}
          view={view}
          pendingPlayerId={room.pendingPlayerId}
          canAct={canAct}
          actionLabel="Draft"
          submitting={room.submitting}
          onAct={(playerId) => onAct({ type: "MAKE_PICK", playerId })}
          queuedPlayerIds={queuedPlayerIds}
          onQueue={onQueueToggle}
        />
        <div className="flex flex-col gap-4">
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
    </div>
  );
}
