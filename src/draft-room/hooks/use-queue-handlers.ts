"use client";

import { useMemo } from "react";
import { useToast } from "@/components/ui";
import { addToQueue, removeFromQueue } from "../state/queue";
import type { DraftRoom as DraftRoomState } from "./use-draft-room";

export interface QueueHandlers {
  readonly queuedPlayerIds: ReadonlySet<string>;
  readonly onQueueChange: (playerIds: readonly string[]) => void;
  readonly onQueueToggle: (playerId: string) => void;
}

/**
 * The one place a rejected queue change becomes a toast — shared by `SnakeRoom` and
 * `AuctionRoom` so the wiring isn't declared twice. Mirrors `DraftRoom`'s own `act`/`onAct`
 * for draft actions: a queue edit is the same optimistic-then-toast shape, just through
 * `room.setQueue` instead of `room.submit`, since a queue edit is not a draft action.
 */
export function useQueueHandlers(room: DraftRoomState): QueueHandlers {
  const { show } = useToast();
  const queuedPlayerIds = useMemo(() => new Set(room.queue), [room.queue]);

  const onQueueChange = (playerIds: readonly string[]): void => {
    void room.setQueue(playerIds).then((outcome) => {
      if (!outcome.ok) show({ message: outcome.reason, tone: "error" });
    });
  };

  const onQueueToggle = (playerId: string): void =>
    onQueueChange(queuedPlayerIds.has(playerId) ? removeFromQueue(room.queue, playerId) : addToQueue(room.queue, playerId));

  return { queuedPlayerIds, onQueueChange, onQueueToggle };
}
