"use client";

import type { Player } from "@/domain/player";
import { Badge, Button, EmptyState } from "@/components/ui";
import { playerName, queueButtonLabel } from "../lib/lookups";
import { moveInQueue, removeFromQueue } from "../state/queue";

export interface QueuePanelProps {
  readonly queue: readonly string[];
  readonly playersById: ReadonlyMap<string, Player>;
  readonly availablePlayerIds: readonly string[];
  readonly busy: boolean;
  readonly onChange: (playerIds: readonly string[]) => void;
}

/**
 * The manager's ranked autopick queue: if their clock runs out, the engine takes the first
 * player here they can still legally roster. An ordered list rather than a `Table` because
 * position IS the meaning — `<ol>` says that to a screen reader for free — and because drag
 * reordering is not keyboard-operable; the up/down buttons are.
 */
export function QueuePanel({ queue, playersById, availablePlayerIds, busy, onChange }: QueuePanelProps) {
  if (queue.length === 0) {
    return (
      <EmptyState
        title="Nobody queued yet"
        description="Add players from the pool and we'll auto-pick the top one if your clock runs out."
        action={<Button disabled>Queue from the player pool</Button>}
      />
    );
  }

  const available = new Set(availablePlayerIds);
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-medium text-text-muted">Your queue</h2>
      <ol className="flex flex-col gap-1">
        {queue.map((playerId, index) => {
          const name = playerName(playersById, playerId);
          return (
            <li key={playerId} className="flex items-center gap-2 rounded-md border border-border bg-surface-elevated px-2 py-1">
              <span className="w-6 tabular-nums text-text-muted">{index + 1}</span>
              <span className="flex-1 text-text-primary">{name}</span>
              {available.has(playerId) ? null : <Badge tone="neutral">Drafted</Badge>}
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => onChange(moveInQueue(queue, playerId, -1))}>
                {`Move ${name} up`}
              </Button>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => onChange(moveInQueue(queue, playerId, 1))}>
                {`Move ${name} down`}
              </Button>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => onChange(removeFromQueue(queue, playerId))}>
                {queueButtonLabel(name, true)}
              </Button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
