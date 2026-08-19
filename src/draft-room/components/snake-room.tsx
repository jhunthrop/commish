"use client";

import type { ReactNode } from "react";
import type { Player } from "@/domain/player";
import type { ClientDraftAction } from "@/draft-engine";
import type { DraftRoom as DraftRoomState } from "../hooks/use-draft-room";
import { useQueueHandlers } from "../hooks/use-queue-handlers";
import { RoomShell } from "./room-shell";

export interface SnakeRoomProps {
  readonly room: DraftRoomState;
  readonly playersById: ReadonlyMap<string, Player>;
  readonly onAct: (action: ClientDraftAction) => void;
  /** The social band down the right edge (league chat), or nothing. Built by `DraftRoom`. */
  readonly aside?: ReactNode;
}

export function SnakeRoom({ room, playersById, onAct, aside }: SnakeRoomProps) {
  const view = room.view!;
  // Affordance only — the server decides. `onClockTeamId` is the engine's answer, not ours.
  const canAct = view.phase === "in_progress" && room.myTeamId !== null && view.onClockTeamId === room.myTeamId;
  const queueHandlers = useQueueHandlers(room);
  const draft = (playerId: string): void => onAct({ type: "MAKE_PICK", playerId });

  return (
    <RoomShell
      room={room}
      view={view}
      playersById={playersById}
      canAct={canAct}
      actionLabel="Draft"
      onAct={draft}
      {...queueHandlers}
      aside={aside}
    />
  );
}
