"use client";

import { useMemo } from "react";
import { Button } from "@/components/ui";
import { useReusedValue } from "@/design/use-stable-list";
import { SheetColumn } from "@/draft-room/quilt/components/sheet-column";
import { SheetScroller } from "@/draft-room/quilt/components/sheet-scroller";
import { buildSheetColumns, movesOffBoard, reuseSheetColumns, SHEET_COLUMN_LABEL } from "@/draft-room/quilt/state/sheet-columns";
import type { SheetTag } from "./types";
import type { SheetColumnsPayload } from "./columns-payload";

/**
 * YOUR SHEET, OUTSIDE A ROOM (the Draft area round, 2026-09-12, founder amendment 2) — the SAME
 * seven columns the founder approved inside the draft room, standing on their own.
 *
 * IT IS THE ROOM'S COMPONENT, NOT A COPY OF IT. `SheetColumn`, `SheetScroller` and
 * `buildSheetColumns` are imported from the room; the drag on a pointer, the arrows on a
 * keyboard, the sticky tier bands, the depth cap and the window math are one implementation.
 * What a room has and this does not is absent BY PROP: no odds and no jump to the next open tier
 * (there is no next pick), no queue verb (there is no queue), no Hide taken switch (nothing is
 * taken), no card to open on a name. The row's number is the board's own ranking key instead,
 * with its basis stated once above the columns.
 *
 * EVERY EDIT IS A SERVER WRITE. The order this renders is the server's; a move posts and the page
 * re-renders, so what this shows can never drift from what the room's own sheet tab reads off the
 * same store. That is the existing `MySheetClient` contract, kept.
 */
export interface SheetColumnsViewProps {
  readonly payload: SheetColumnsPayload;
  /** Whose rules every number on these rows is under, as one finished sentence
   *  (`basisSentence`) — the same sentence the Board prints, because it is the same board. */
  readonly basis: string;
  readonly onMove: (playerId: string, delta: number) => void;
  readonly onPlace: (playerId: string, to: number) => void;
  readonly onMatchBoard: () => void;
  /** The manager's own marks on a row, written straight through to the sheet's API. */
  readonly onNote: (playerId: string, note: string) => void;
  readonly onTag: (playerId: string, tag: SheetTag | null) => void;
  readonly onTierLabel: (playerId: string, tierLabel: string | null) => void;
  readonly onRemove: (playerId: string) => void;
}

const EMPTY_SET: ReadonlySet<string> = new Set();

/** The word a band counts in. The column that spans positions counts players. */
function bandNounFor(key: string): string {
  return key === "overall" ? "ALL" : SHEET_COLUMN_LABEL[key as keyof typeof SHEET_COLUMN_LABEL];
}

export function SheetColumnsView({ payload, basis, onMove, onPlace, onMatchBoard, onNote, onTag, onTierLabel, onRemove }: SheetColumnsViewProps) {
  const playersById = useMemo(() => new Map(payload.players.map((player) => [player.id, player] as const)), [payload.players]);
  const available = useMemo(() => new Set(payload.players.map((player) => player.id)), [payload.players]);
  const values = useMemo(() => new Map(payload.values), [payload.values]);
  const targets = useMemo(() => new Set(payload.targets), [payload.targets]);
  const marks = useMemo(() => new Map(payload.marks), [payload.marks]);
  const built = useMemo(
    () =>
      buildSheetColumns({
        order: payload.order,
        playersById,
        available,
        myPlayerIds: EMPTY_SET,
        queuedPlayerIds: targets,
        tiers: payload.tiers,
        overallTiers: payload.overallTiers,
        odds: null,
        hideTaken: false,
        values,
        marks,
      }),
    [payload.order, payload.tiers, payload.overallTiers, playersById, available, values, targets, marks],
  );
  const columns = useReusedValue(built, reuseSheetColumns);
  const moved = useMemo(() => movesOffBoard(payload.order, payload.boardIds), [payload.order, payload.boardIds]);

  return (
    <div data-testid="draft-area-sheet" className="group/sheet flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-0.5">
        {/* ONE LINE ON A PHONE (fix round 1, H4), the whole sentence from `sm:` up. */}
        <p data-testid="sheet-basis" className="max-w-[78ch] truncate text-sm text-text-muted sm:whitespace-normal">
          {moved === 0 ? (
            <>
              <span className="font-semibold text-text-primary">Our board, untouched</span>.{" "}
            </>
          ) : (
            <>
              Started from our board, <span className="font-semibold text-text-primary">{moved} of yours moved</span>.{" "}
            </>
          )}
          {`The number is points over a replacement at his position. ${basis} K and D/ST are in ADP order.`}
        </p>
        <span className="flex-1" />
        {moved === 0 ? null : (
          <Button size="sm" variant="ghost" onClick={onMatchBoard}>
            Match our board
          </Button>
        )}
      </div>
      <SheetScroller
        columns={columns}
        countOf={(column) => column.total}
        renderColumn={(column) => (
          <SheetColumn
            column={column}
            head="depth"
            bandNoun={bandNounFor(column.key)}
            jumpToOpenTier={false}
            onMove={column.key === "overall" ? onMove : null}
            onPlace={column.key === "overall" ? onPlace : null}
            canDraft={false}
            submitting={false}
            onDraft={() => {}}
            onQueueToggle={null}
            onPeek={null}
            onNote={onNote}
            onTag={onTag}
            onTierLabel={onTierLabel}
            onRemove={onRemove}
          />
        )}
      />
    </div>
  );
}
