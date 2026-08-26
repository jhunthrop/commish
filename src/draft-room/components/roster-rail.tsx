import type { Player } from "@/domain/player";
import { BENCH_SLOT, type RosterSlotConfig, type RosterSlotType } from "@/domain/roster";
import type { DraftStateView } from "@/draft-engine";
import { Avatar, EYEBROW, PositionBadge, SlotChip } from "@/components/ui";
import { rosterFillRows } from "../state/roster-fill";

export interface RosterRailProps {
  readonly view: DraftStateView;
  /** The caller's own team. `DraftRoom` only ever mounts this component once it has already
   *  branched on `myTeamId !== null` — a commissioner watching with no team of their own has
   *  nothing this rail can show, so `DraftRoom` renders the chat panel expanded instead
   *  (founder directive 2026-08-26, room-product pass: "nothing to say" law). */
  readonly myTeamId: string;
  readonly playersById: ReadonlyMap<string, Player>;
  readonly slotConfig: readonly RosterSlotConfig[];
}

/** One roster spot: a filled face-and-name row, or a quiet open placeholder. */
function RosterRow({
  slot,
  slotIndex,
  player,
  className,
}: {
  readonly slot: RosterSlotType;
  readonly slotIndex: number;
  readonly player: Player | null;
  readonly className?: string;
}) {
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

/**
 * The right rail's default content: what I have filled and what is still open, one row per
 * roster spot in the league's own slot order. Founder directive 2026-08-26 (room-product
 * pass): "the right hand side should be your roster and what positions you have filled" — this
 * is that rail, replacing the old default of an open chat panel (see `DraftRoom`'s aside
 * composition for the full supersession).
 *
 * Fill assignment is never computed here: `rosterFillRows` (`../state/roster-fill`) re-shapes
 * the roster the draft engine already assigned (`assignSlot`) into one ordered row per spot —
 * the same shared derivation `MockResults` consumes, so the rule lives in one place.
 */
export function RosterRail({ view, myTeamId, playersById, slotConfig }: RosterRailProps) {
  const rows = rosterFillRows(slotConfig, view.rosters[myTeamId] ?? []);
  // The bench's own quiet hairline lands once, on the first bench row — derived, never a
  // mutable flag in the render map (T2 review MEDIUM): starters and bench are one list (one
  // region, one heading) but visually two groups.
  const firstBenchIndex = rows.findIndex((row) => row.slot === BENCH_SLOT);
  return (
    <div className="flex flex-col gap-2">
      <h2 className={`${EYEBROW} text-text-muted`}>Your roster</h2>
      <ul aria-label="Your roster" className="flex flex-col gap-1.5">
        {rows.map((row, index) => {
          const startsBench = index === firstBenchIndex;
          return (
            <RosterRow
              key={`${row.slot}:${row.slotIndex}`}
              slot={row.slot}
              slotIndex={row.slotIndex}
              player={row.playerId === null ? null : (playersById.get(row.playerId) ?? null)}
              className={startsBench ? "mt-1 border-t border-line pt-2" : undefined}
            />
          );
        })}
      </ul>
    </div>
  );
}
