"use client";

import { useMemo } from "react";
import type { Player } from "@/domain/player";
import type { DraftStateView } from "@/draft-engine";
import { positionStickerClass } from "@/components/ui/position-badge";
import { SLOT_POSITION } from "../../components/room-dock";

interface SpineSlot {
  readonly key: string;
  readonly slot: string;
  readonly player: Player | null;
}

function spineSlots(view: DraftStateView, myTeamId: string, playersById: ReadonlyMap<string, Player>): readonly SpineSlot[] {
  const roster = view.rosters[myTeamId] ?? [];
  const byCopy = new Map(roster.map((slot) => [`${slot.slot}:${slot.slotIndex}`, slot.playerId]));
  const slots: SpineSlot[] = [];
  for (const config of view.slotConfig) {
    for (let index = 0; index < config.count; index += 1) {
      const playerId = byCopy.get(`${config.slot}:${index}`) ?? null;
      slots.push({ key: `${config.slot}:${index}`, slot: config.slot, player: playerId === null ? null : (playersById.get(playerId) ?? null) });
    }
  }
  return slots;
}

export interface RosterSpineProps {
  readonly view: DraftStateView;
  readonly myTeamId: string;
  readonly playersById: ReadonlyMap<string, Player>;
  readonly expanded: boolean;
  readonly onToggle: () => void;
}

/**
 * THE ROSTER SPINE (law 5): a 44px rail of slot dots down the quilt's left edge — filled dots
 * wear the position's sticker color, open ones stay dashed — expanding in place to name every
 * slot on tap. One toggle button owns the whole rail, so the keyboard reaches it in one stop.
 */
export function RosterSpine({ view, myTeamId, playersById, expanded, onToggle }: RosterSpineProps) {
  const slots = useMemo(() => spineSlots(view, myTeamId, playersById), [view, myTeamId, playersById]);
  const filled = slots.filter((slot) => slot.player !== null).length;

  if (!expanded) {
    return (
      <button
        type="button"
        data-testid="roster-spine"
        aria-expanded={false}
        aria-label={`Your roster, ${filled} of ${slots.length} slots filled. Expand`}
        onClick={onToggle}
        className="flex w-11 shrink-0 flex-col items-center gap-1.5 border-r border-line bg-surface-elevated py-3 focus-visible:outline-2 focus-visible:outline-accent"
      >
        <span aria-hidden="true" className="mb-1 font-mono text-[9px] uppercase tracking-wide text-text-faint [writing-mode:vertical-rl] rotate-180">
          roster
        </span>
        {slots.map((slot) => {
          const position = slot.player?.position ?? SLOT_POSITION[slot.slot as keyof typeof SLOT_POSITION];
          return slot.player === null ? (
            <span key={slot.key} aria-hidden="true" className="h-[18px] w-[18px] rounded-xs border border-dashed border-line" />
          ) : (
            <span key={slot.key} aria-hidden="true" className={`flex h-[18px] w-[18px] items-center justify-center rounded-xs ${position === undefined ? "bg-surface-raised" : positionStickerClass(position)}`}>
              <span className="h-1.5 w-1.5 rounded-full bg-current opacity-80" />
            </span>
          );
        })}
      </button>
    );
  }

  return (
    <div data-testid="roster-spine" className="flex w-60 shrink-0 flex-col border-r border-line bg-surface-elevated">
      <button
        type="button"
        aria-expanded
        onClick={onToggle}
        className="flex items-center justify-between border-b border-line px-3 py-2 focus-visible:outline-2 focus-visible:outline-accent"
      >
        <span className="font-mono text-xs uppercase tracking-wide text-text-faint">My roster</span>
        <span className="font-display text-xs font-bold text-text-muted tabular-nums">
          {filled}/{slots.length}
        </span>
      </button>
      <ul className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-2">
        {slots.map((slot) => (
          <li key={slot.key} className="flex items-center gap-2 rounded-sm bg-surface-raised px-2 py-1.5">
            <span className="w-9 font-display text-xs font-bold text-text-faint">{slot.slot}</span>
            {slot.player === null ? (
              <span className="text-xs text-text-faint">Open</span>
            ) : (
              <span className="truncate text-sm text-text-primary">{slot.player.name}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
