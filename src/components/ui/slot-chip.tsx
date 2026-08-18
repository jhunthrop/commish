import type { RosterSlotType } from "@/domain/roster";

export interface SlotChipProps {
  readonly slot: RosterSlotType;
  readonly className?: string;
}

/**
 * The bordered display chip for a roster slot LETTER (e.g. "FLEX", "BENCH") — for slot types
 * that are not themselves a position and so cannot wear a `PositionBadge` sticker. The one
 * shared treatment for both rooms; do not reintroduce a bare `<span>{slot}</span>`.
 */
export function SlotChip({ slot, className = "" }: SlotChipProps) {
  return (
    <span
      className={`rounded-sm border border-border px-2 font-display text-xs font-semibold uppercase tracking-wide text-text-muted ${className}`}
    >
      {slot}
    </span>
  );
}
