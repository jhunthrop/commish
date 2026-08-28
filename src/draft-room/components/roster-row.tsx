import type { Player } from "@/domain/player";
import type { RosterSlotType } from "@/domain/roster";
import { PlayerFace, PositionBadge, SlotChip } from "@/components/ui";

export interface RosterRowProps {
  readonly slot: RosterSlotType;
  readonly player: Player | null;
  readonly className?: string;
}

/**
 * One roster spot: a filled face-and-name row, or a quiet open placeholder. Extracted out of
 * `RosterRail` (mock-results design review, 2026-08-26, finding D1) so a filled spot draws
 * IDENTICALLY everywhere a roster spot ever appears — the rail beside the board and the mock
 * results panel — rather than two hand-drawings of the same object that a later edit to one could
 * quietly leave the other behind, which is exactly what happened here: the rail was rebuilt with
 * faces and the player's own position, and the results panel never was.
 *
 * GAMEDAY CHANGED TWO THINGS. The face is now a `PlayerFace` rather than a bare `Avatar`, because
 * law 3 says every surface that draws a player draws his club colour too, and a roster is the
 * surface a manager stares at longest. And an OPEN spot is a hairline rather than a dashed box:
 * the old placeholder drew a 24px empty rectangle per empty slot, so a roster with six bench spots
 * open — which is every roster for the first ten rounds of every draft — spent a third of the rail
 * on eight boxes containing nothing. Law 4: space separates kinds of information, it never exists
 * to fill a column.
 */
export function RosterRow({ slot, player, className }: RosterRowProps) {
  return (
    <li className={`flex items-center gap-2 py-0.5 ${className ?? ""}`}>
      {player === null ? (
        <>
          {/* Founder directive 2026-08-26 (room-product pass): an OPEN spot names the SLOT it
              is waiting on — the same chip for every slot type, position-named or not, so
              "what's still open" reads as one consistent vocabulary rather than a badge for
              some rows and a chip for others. */}
          <SlotChip slot={slot} />
          {/* A rule, not a box. It says "this row is empty" in one pixel of height instead of
              twenty-four, which is the whole of what an unfilled spot has to say. Decorative and
              silent: the row carries the slot chip and no name, which is already how a screen
              reader hears an open spot, and the WORD "Open" was this product's own private idiom
              that the shared row deliberately retired (mock-results review D1/D2). */}
          <span aria-hidden="true" className="h-px flex-1 bg-line" />
        </>
      ) : (
        <>
          {/* Law 3: the club colour behind the face. Decorative — the name right beside it
              already says who this is, and the position badge states the fourth attribute. */}
          <PlayerFace player={player} size="sm" />
          <span className="min-w-0 flex-1 truncate text-sm font-semibold text-text-primary">{player.name}</span>
          {/* The player's OWN position, never the slot's — a WR filling FLEX shows WR, so the
              badge always states a real, colored position rather than "FLEX" (which cannot
              wear one). */}
          <PositionBadge position={player.position} size="sm" />
        </>
      )}
    </li>
  );
}
