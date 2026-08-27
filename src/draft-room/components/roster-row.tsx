import type { Player } from "@/domain/player";
import type { RosterSlotType } from "@/domain/roster";
import { Avatar, PositionBadge, SlotChip } from "@/components/ui";

export interface RosterRowProps {
  readonly slot: RosterSlotType;
  readonly player: Player | null;
  readonly className?: string;
}

/**
 * One roster spot: a filled face-and-name row, or a quiet open placeholder. Extracted out of
 * `RosterRail` (mock-results design review, 2026-08-26, finding D1) so a filled spot draws
 * IDENTICALLY everywhere a roster spot ever appears — the rail beside the board and (a later
 * pass) the mock results panel — rather than two hand-drawings of the same object that a later
 * edit to one could quietly leave the other behind, which is exactly what happened here: the
 * rail was rebuilt with faces and the player's own position, and the results panel never was.
 */
export function RosterRow({ slot, player, className }: RosterRowProps) {
  return (
    <li className={`flex items-center gap-2 ${className ?? ""}`}>
      {player === null ? (
        <>
          {/* Founder directive 2026-08-26 (room-product pass): an OPEN spot names the SLOT it
              is waiting on — the same chip for every slot type, position-named or not, so
              "what's still open" reads as one consistent vocabulary rather than a badge for
              some rows and a chip for others. */}
          <SlotChip slot={slot} />
          <span aria-hidden="true" className="h-6 flex-1 rounded-sm border border-dashed border-line" />
        </>
      ) : (
        <>
          {/* Decorative: the name right beside it already says who this is — same idiom as
              the pool's own row (`player-pool.tsx`, founder directive 2026-08-26). */}
          <Avatar name={player.name} avatar={player.headshotUrl} size="sm" />
          <span className="min-w-0 flex-1 truncate font-display font-semibold text-text-primary">{player.name}</span>
          {/* The player's OWN position, never the slot's — a WR filling FLEX shows WR, so the
              badge always states a real, colored position rather than "FLEX" (which cannot
              wear one). */}
          <PositionBadge position={player.position} size="sm" />
        </>
      )}
    </li>
  );
}
