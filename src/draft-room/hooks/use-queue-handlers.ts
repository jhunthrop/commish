"use client";

import { useCallback, useMemo } from "react";
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
  const { queue, setQueue } = room;
  const queuedPlayerIds = useMemo(() => new Set(queue), [queue]);

  // Stable across renders (fluidity round, 2026-09-10): every drawer row takes these as props,
  // and a fresh closure per render was one of the things that made sixty rows re-render on a
  // clock tick. They change only when the queue itself does.
  const onQueueChange = useCallback(
    (playerIds: readonly string[]): void => {
      void setQueue(playerIds).then((outcome) => {
        if (!outcome.ok) show({ message: outcome.reason, tone: "error" });
      });
    },
    [setQueue, show],
  );

  const onQueueToggle = useCallback(
    (playerId: string): void => onQueueChange(queuedPlayerIds.has(playerId) ? removeFromQueue(queue, playerId) : addToQueue(queue, playerId)),
    [onQueueChange, queuedPlayerIds, queue],
  );

  return useMemo(() => ({ queuedPlayerIds, onQueueChange, onQueueToggle }), [queuedPlayerIds, onQueueChange, onQueueToggle]);
}
