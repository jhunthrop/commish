"use client";

import { useMemo } from "react";
import type { Player } from "@/domain/player";
import type { DraftStateView } from "@/draft-engine";
import { Icon } from "@/components/ui/icon";
import { MICRO_LABEL } from "@/components/ui/config";
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
 * The head's chevron plate — founder addition 3 (WarmQuilt mock, the 40x30 rounded button):
 * an EXPLICIT toggle in the spine's head, chevron flipping while open, inside the motion
 * budget with a reduced-motion branch. The rotated vertical micro-text is retired.
 */
function RosterToggle({ expanded, filled, total, onToggle }: { readonly expanded: boolean; readonly filled: number; readonly total: number; readonly onToggle: () => void }) {
  return (
    <button
      type="button"
      data-testid="roster-toggle"
      aria-expanded={expanded}
      aria-label={`Your roster, ${filled} of ${total} slots filled. ${expanded ? "Collapse" : "Expand"}`}
      onClick={onToggle}
      className="flex flex-col items-center gap-1 focus-visible:outline-2 focus-visible:outline-accent"
    >
      <span className="flex h-[30px] w-10 items-center justify-center rounded-md bg-surface-raised">
        <span
          data-testid="roster-chevron"
          aria-hidden="true"
          className={`inline-flex text-accent transition-transform duration-200 motion-reduce:transition-none ${expanded ? "rotate-180" : ""}`}
        >
          <Icon name="chevron-right" size={16} />
        </span>
      </span>
      <span aria-hidden="true" className={`${MICRO_LABEL} text-text-faint`}>
        roster
      </span>
    </button>
  );
}

/**
 * THE ROSTER SPINE (law 5): a 44px rail of slot dots down the quilt's left edge — filled dots
 * wear the position's sticker color, open ones stay dashed — expanding in place to name every
 * slot on tap. The head is now an explicit ROSTER chevron button (founder addition 3); the
 * dots below are furniture the button speaks for.
 */
export function RosterSpine({ view, myTeamId, playersById, expanded, onToggle }: RosterSpineProps) {
  const slots = useMemo(() => spineSlots(view, myTeamId, playersById), [view, myTeamId, playersById]);
  const filled = slots.filter((slot) => slot.player !== null).length;

  if (!expanded) {
    return (
      <div data-testid="roster-spine" className="flex w-11 shrink-0 flex-col items-center gap-1.5 border-r border-line bg-surface-elevated py-2">
        <RosterToggle expanded={false} filled={filled} total={slots.length} onToggle={onToggle} />
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
      </div>
    );
  }

  return (
    <div data-testid="roster-spine" className="flex w-60 shrink-0 flex-col border-r border-line bg-surface-elevated">
      <div className="flex items-center justify-between border-b border-line px-3 py-2">
        <RosterToggle expanded filled={filled} total={slots.length} onToggle={onToggle} />
        <span className="font-display text-xs font-bold text-text-muted tabular-nums">
          {filled}/{slots.length}
        </span>
      </div>
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
