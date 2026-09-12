"use client";

import { memo, type DragEvent } from "react";
import { Button, PlayerFace, PositionBadge } from "@/components/ui";
import { OddsFigure } from "../../advisor/components/odds-glance";
import { QUILT_CONFIG } from "../state/config";
import type { SheetColumnKey, SheetRowModel } from "../state/sheet-columns";
import { sheetDisplayName } from "../state/sheet-name";
import type { RoomActs } from "./room-acts";

export interface SheetRowProps extends Pick<RoomActs, "canDraft" | "submitting" | "onDraft"> {
  /** Null outside a room, where there is no queue to put a man in. */
  readonly onQueueToggle: RoomActs["onQueueToggle"] | null;
  /** Null where no card exists to open: the name is then text, not a button that does nothing. */
  readonly onPeek: RoomActs["onPeek"] | null;
  readonly row: SheetRowModel;
  /** The row's top edge inside the column's window, px. */
  readonly top: number;
  /** Which column this row sits in: Overall shows the position and reorders by drag, and each
   *  column has its own name budget (`sheetDisplayName`). */
  readonly column: SheetColumnKey;
  readonly onMove: ((playerId: string, delta: number) => void) | null;
  readonly onDragStart: ((playerId: string) => void) | null;
  readonly onDropOn: ((playerId: string) => void) | null;
  readonly first: boolean;
  readonly last: boolean;
}

const ROW_HEIGHT = { height: QUILT_CONFIG.sheet.rowPx } as const;

/** The name and face: a button where a card can open, plain text where none can. One element
 *  either way, so the row's grid is the same shape on both surfaces. */
function Identity({ as: Tag, ...rest }: { readonly as: "span" | "button" } & React.ComponentPropsWithoutRef<"button">) {
  return <Tag {...rest} />;
}

function allowDrop(event: DragEvent<HTMLElement>): void {
  event.preventDefault();
}

/**
 * ONE ROW OF YOUR SHEET (ruling 1): the rank, the face, the name largest, the club, and one odds
 * number as runs over runs in the pool's bands. A taken player is struck in place (the sheet is
 * prep, not inventory); your own pick sits on the amber wash and says "yours"; a queued player
 * carries the amber flag on the row's edge. Pointing at a row (or tabbing into it) swaps the
 * number for the verb: Draft when you are on the clock, Queue when you are not, so a viewport
 * holds one solid pill at a time (P3). The face and the name open the room's own player card.
 *
 * MEMOIZED over a row model whose facts are primitives, so a pick landing re-renders the row
 * that was taken and nothing else in the column.
 */
export const SheetRow = memo(function SheetRow({ row, top, column, onMove, onDragStart, onDropOn, first, last, canDraft, submitting, onDraft, onQueueToggle, onPeek }: SheetRowProps) {
  const { player, rank, taken, mine, queued, survived, runs, value } = row;
  const draggable = onDragStart !== null && !taken;
  const overall = column === "overall";
  return (
    // The drag is a pointer-only extra over the row: the keyboard reorders through the Move up
    // and Move down buttons inside it, so the row itself never needs to be focusable.
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <li
      data-testid="sheet-row"
      data-player-id={player.id}
      data-taken={taken ? "true" : undefined}
      data-mine={mine ? "true" : undefined}
      draggable={draggable}
      onDragStart={draggable ? () => onDragStart(player.id) : undefined}
      onDragOver={onDropOn === null ? undefined : allowDrop}
      onDrop={onDropOn === null ? undefined : () => onDropOn(player.id)}
      style={{ ...ROW_HEIGHT, top }}
      className={`group absolute inset-x-1 grid grid-cols-[1.25rem_1.75rem_minmax(0,1fr)_auto] items-center gap-1.5 rounded-md pl-1 pr-1.5 focus-within:bg-surface focus-within:ring-1 focus-within:ring-accent hover:bg-surface hover:ring-1 hover:ring-accent ${
        mine ? "self-wash" : ""
      } ${taken && !mine ? "opacity-45" : ""}`}
    >
      {queued && !taken ? <span aria-hidden="true" className="absolute -left-0.5 top-3 h-5 w-1 rounded-xs bg-self" /> : null}
      <span className="text-right font-display text-xs font-semibold tabular-nums text-text-faint">{rank}</span>
      <Identity as={onPeek === null ? "span" : "button"} type={onPeek === null ? undefined : "button"} aria-label={onPeek === null ? undefined : `${player.name}, open the card`} onClick={onPeek === null ? undefined : () => onPeek(player.id)} className="col-span-2 flex min-w-0 items-center gap-1.5 rounded-md text-left focus-visible:outline-2 focus-visible:outline-accent">
        <PlayerFace player={player} size="xs" />
        <span className="flex min-w-0 flex-col leading-tight">
          <span title={player.name} className={`truncate font-display text-sm font-bold text-text-primary ${taken && !mine ? "line-through decoration-2" : ""}`}>
            {sheetDisplayName(player.name, column)}
          </span>
          <span className="flex min-w-0 items-center gap-1 truncate text-[10.5px] text-text-muted">
            {overall ? <PositionBadge position={player.position} size="sm" /> : null}
            <span className="truncate">
              {player.nflTeam}
              {mine ? " · yours" : taken ? " · taken" : ""}
            </span>
          </span>
        </span>
      </Identity>
      {taken ? (
        <span className="text-[11px] text-text-faint">{mine ? "" : "taken"}</span>
      ) : (
        <span className="flex items-center justify-end">
          {/* THE ODDS, OR THE BOARD'S OWN KEY (the Draft area round, 2026-09-12). In a room the
              number is how many runs he survived to your next pick. Outside one there is no next
              pick, so the row leads with points over replacement instead — the quantity the board
              is ordered by, with its basis named once above the columns. Neither, and the row
              prints the dash it earns rather than a zero. */}
          <span className="group-focus-within:hidden group-hover:hidden group-data-[recomputing=true]/sheet:opacity-60">
            {runs !== null && survived !== undefined ? (
              <OddsFigure survived={survived} runs={runs} form="count" />
            ) : value !== null ? (
              <span className="font-display text-sm font-bold tabular-nums text-text-primary">{value.toFixed(1)}</span>
            ) : (
              <span className="text-[11px] text-text-faint">–</span>
            )}
          </span>
          <span className="hidden items-center gap-0.5 group-focus-within:flex group-hover:flex group-data-[pointer=coarse]/room:flex">
            {onMove === null ? null : (
              <>
                <Button size="sm" variant="ghost" disabled={first} aria-label={`Move ${player.name} up your sheet`} onClick={() => onMove(player.id, -1)}>
                  <span aria-hidden="true">↑</span>
                </Button>
                <Button size="sm" variant="ghost" disabled={last} aria-label={`Move ${player.name} down your sheet`} onClick={() => onMove(player.id, 1)}>
                  <span aria-hidden="true">↓</span>
                </Button>
              </>
            )}
            {/* No verb outside a room (`onQueueToggle` null): there is nothing to draft and no
                queue to hold him in, and a pill that did nothing would be the loudest thing on a
                sheet whose one act is reordering. */}
            {canDraft ? (
              <Button size="sm" variant="verb" disabled={submitting} aria-label={`Draft ${player.name}`} onClick={() => onDraft(player.id)}>
                Draft
              </Button>
            ) : onQueueToggle === null ? null : (
              <Button size="sm" variant="secondary" disabled={submitting} aria-pressed={queued} aria-label={queued ? `Remove ${player.name} from your queue` : `Queue ${player.name}`} onClick={() => onQueueToggle(player.id)}>
                {queued ? "Queued" : "Queue"}
              </Button>
            )}
          </span>
        </span>
      )}
    </li>
  );
});
