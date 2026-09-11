"use client";

import { memo, useMemo } from "react";
import type { Player } from "@/domain/player";
import type { SurvivalOdds } from "@/draft-service/assistant/view";
import { Button, MotionList, type MotionRowProps } from "@/components/ui";
import { useStableList } from "@/design/use-stable-list";
import { OddsFigure } from "../../advisor/components/odds-glance";
import type { CheatSheet } from "../state/sheet";
import { sheetQueueSeed } from "../state/sheet";
import { QUILT_CONFIG } from "../state/config";
import { DrawerRow } from "./drawer-row";
import { PagedFooter, usePaging } from "./paged-list";
import type { RoomActs } from "./room-acts";

export interface DrawerSheetTabProps extends Pick<RoomActs, "canDraft" | "submitting" | "onDraft" | "onPeek"> {
  readonly leagueId: string;
  readonly sheet: CheatSheet;
  readonly playersById: ReadonlyMap<string, Player>;
  /** playerId → 1-based rank on OUR board, for the "you N · board M" comparison. */
  readonly boardRanks: ReadonlyMap<string, number>;
  readonly available: ReadonlySet<string>;
  readonly onMove: (playerId: string, delta: number) => void;
  readonly onSeedQueue: (playerIds: readonly string[]) => void;
  readonly onReset: () => void;
  /** Draft HQ's sync contract (spec §4, Task 5): whether this room found a server sheet (My
   *  Sheet, `/api/draft/sheets`) for this league. `false` offers to start one from the room's
   *  current local sheet — every row below still behaves exactly as it always has either way. */
  readonly hasServerSheet: boolean;
  readonly onStartServerSheet: () => void;
  /** The advisor's next-turn odds; `null` prints none. */
  readonly odds?: SurvivalOdds | null;
}

/** One sheet row with every printed fact resolved to a primitive (the memo boundary). */
interface SheetRowModel {
  readonly player: Player;
  readonly you: number;
  readonly board: number | null;
  readonly drafted: boolean;
  readonly highlight: boolean;
  readonly note: string | undefined;
  readonly first: boolean;
  readonly last: boolean;
  readonly survived: number | undefined;
  readonly runs: number | null;
}

const keyOf = (row: SheetRowModel): string => row.player.id;

function buildRows(sheet: CheatSheet, count: number, playersById: ReadonlyMap<string, Player>, boardRanks: ReadonlyMap<string, number>, available: ReadonlySet<string>, odds: SurvivalOdds | null): readonly SheetRowModel[] {
  const lastIndex = sheet.order.length - 1;
  let firstAvailableSeen = false;
  return sheet.order.slice(0, count).flatMap((playerId, index) => {
    const player = playersById.get(playerId);
    if (player === undefined) return [];
    const drafted = !available.has(playerId);
    const highlight = !drafted && !firstAvailableSeen;
    if (highlight) firstAvailableSeen = true;
    return [
      {
        player,
        you: index + 1,
        board: boardRanks.get(playerId) ?? null,
        drafted,
        highlight,
        note: sheet.notes[playerId],
        first: index === 0,
        last: index === lastIndex,
        survived: odds === null || drafted ? undefined : odds.survived[playerId],
        runs: odds === null || odds.runs === 0 ? null : odds.runs,
      },
    ];
  });
}

interface SheetRowProps extends Pick<RoomActs, "canDraft" | "submitting" | "onDraft" | "onPeek"> {
  readonly leagueId: string;
  readonly item: SheetRowModel;
  readonly onMove: (playerId: string, delta: number) => void;
  readonly row: MotionRowProps;
}

const SheetRow = memo(function SheetRow({ leagueId, item, onMove, canDraft, submitting, onDraft, onPeek, row }: SheetRowProps) {
  const { player, you, board, drafted, highlight, note, first, last, survived, runs } = item;
  return (
    <DrawerRow
      leagueId={leagueId}
      player={player}
      rank={you}
      rankAccent={highlight}
      drafted={drafted}
      highlight={highlight}
      onPeek={onPeek}
      row={row}
      meta={note === undefined ? undefined : <span className="italic">&ldquo;{note}&rdquo;</span>}
      verdict={
        <>
          {board === null ? null : (
            <span data-testid="sheet-vs-board" className={`font-mono text-xs tabular-nums ${you < board ? "text-positive" : you > board ? "text-negative" : "text-text-faint"}`}>
              you {you} · board {board}
            </span>
          )}
          {runs === null || survived === undefined ? null : <OddsFigure survived={survived} runs={runs} />}
        </>
      }
      actions={
        drafted ? null : (
          <>
            <Button size="sm" variant="ghost" disabled={first} aria-label={`Move ${player.name} up your sheet`} onClick={() => onMove(player.id, -1)}>
              <span aria-hidden="true">↑</span>
            </Button>
            <Button size="sm" variant="ghost" disabled={last} aria-label={`Move ${player.name} down your sheet`} onClick={() => onMove(player.id, 1)}>
              <span aria-hidden="true">↓</span>
            </Button>
            {canDraft ? (
              <Button size="sm" variant={highlight ? "verb" : "secondary"} disabled={submitting} onClick={() => onDraft(player.id)}>
                Draft
              </Button>
            ) : null}
          </>
        )
      }
    />
  );
});

/**
 * MY SHEET — the manager's own copy of the board, live in the room (`SheetAndLens` mock).
 * Drafted players strike through in place (the list is prep, not inventory), every row says
 * where the manager and the board disagree, and the sheet's one bridge to the server is the
 * queue seed: the top five undrafted names become the autopick queue in one tap.
 *
 * PAGED (fluidity round, 2026-09-10): the sheet used to render every board player — 1,779 rows,
 * 14,000 components per commit, a 300 ms tab open. It now shows the pool's own page
 * (`poolPageSize`) and offers the next page on request; a move slides its two rows through
 * `MotionList` rather than repainting the list.
 */
export function DrawerSheetTab({ leagueId, sheet, playersById, boardRanks, available, onMove, onSeedQueue, onReset, canDraft, submitting, onDraft, onPeek, hasServerSheet, onStartServerSheet, odds = null }: DrawerSheetTabProps) {
  const seed = useMemo(() => sheetQueueSeed(sheet, available, QUILT_CONFIG.sheetQueueSeedCount), [sheet, available]);
  const paging = usePaging(sheet.order.length);
  const built = useMemo(() => buildRows(sheet, paging.shown, playersById, boardRanks, available, odds), [sheet, paging.shown, playersById, boardRanks, available, odds]);
  const rows = useStableList(built, keyOf);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      {hasServerSheet ? null : (
        <div className="flex items-center gap-2 rounded-md bg-surface-elevated px-2 py-1.5 text-xs text-text-muted">
          <span>{"This room's sheet is local to this browser only."}</span>
          <Button size="sm" variant="secondary" className="ml-auto" onClick={onStartServerSheet}>
            Save it to My Sheet
          </Button>
        </div>
      )}
      <div className="flex items-center gap-2">
        <p className="text-xs text-text-faint">Your prep, live. Drafted players strike through. Notes live on the player card.</p>
        <span className="ml-auto flex items-center gap-1">
          <Button size="sm" variant="secondary" disabled={seed.length === 0} onClick={() => onSeedQueue(seed)}>
            Send top {Math.min(seed.length, QUILT_CONFIG.sheetQueueSeedCount)} to queue
          </Button>
          <Button size="sm" variant="ghost" onClick={onReset}>
            Match our board
          </Button>
        </span>
      </div>
      <ol aria-label="Your sheet, your order" className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
        <MotionList items={rows} keyOf={keyOf}>
          {(item, row) => <SheetRow leagueId={leagueId} item={item} onMove={onMove} canDraft={canDraft} submitting={submitting} onDraft={onDraft} onPeek={onPeek} row={row} />}
        </MotionList>
        <PagedFooter paging={paging} total={sheet.order.length} />
      </ol>
    </div>
  );
}
