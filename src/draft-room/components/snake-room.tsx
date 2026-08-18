"use client";

import type { Player } from "@/domain/player";
import type { ClientDraftAction } from "@/draft-engine";
import type { DraftRoom as DraftRoomState } from "../hooks/use-draft-room";
import { ClockBanner } from "./clock-banner";
import { PlayerPool } from "./player-pool";
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

  return (
    <div className="flex flex-col gap-4">
      <ClockBanner view={view} teams={room.teams} myTeamId={room.myTeamId} />
      <div className="grid gap-4 lg:grid-cols-2">
        <PlayerPool
          players={room.players}
          view={view}
          pendingPlayerId={room.pendingPlayerId}
          canAct={canAct}
          actionLabel="Draft"
          submitting={room.submitting}
          onAct={(playerId) => onAct({ type: "MAKE_PICK", playerId })}
        />
        <div className="flex flex-col gap-4">
          <RosterBoard view={view} teams={room.teams} playersById={playersById} myTeamId={room.myTeamId} />
          <PickHistory view={view} teams={room.teams} playersById={playersById} />
        </div>
      </div>
    </div>
  );
}
