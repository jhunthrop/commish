"use client";

import { useMemo } from "react";
import type { Player } from "@/domain/player";
import { Button } from "@/components/ui";
import type { CheatSheet } from "../state/sheet";
import { sheetQueueSeed } from "../state/sheet";
import { QUILT_CONFIG } from "../state/config";
import { DrawerRow } from "./drawer-row";
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
}

/**
 * MY SHEET — the manager's own copy of the board, live in the room (`SheetAndLens` mock).
 * Drafted players strike through in place (the list is prep, not inventory), every row says
 * where the manager and the board disagree, and the sheet's one bridge to the server is the
 * queue seed: the top five undrafted names become the autopick queue in one tap.
 */
export function DrawerSheetTab({ leagueId, sheet, playersById, boardRanks, available, onMove, onSeedQueue, onReset, canDraft, submitting, onDraft, onPeek, hasServerSheet, onStartServerSheet }: DrawerSheetTabProps) {
  const seed = useMemo(() => sheetQueueSeed(sheet, available, QUILT_CONFIG.sheetQueueSeedCount), [sheet, available]);
  let firstAvailableSeen = false;

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
        {sheet.order.map((playerId, index) => {
          const player = playersById.get(playerId);
          if (player === undefined) return null;
          const drafted = !available.has(playerId);
          const you = index + 1;
          const board = boardRanks.get(playerId) ?? null;
          const highlight = !drafted && !firstAvailableSeen;
          if (highlight) firstAvailableSeen = true;
          const note = sheet.notes[playerId];
          return (
            <DrawerRow
              key={playerId}
              leagueId={leagueId}
              player={player}
              rank={you}
              rankAccent={highlight}
              drafted={drafted}
              highlight={highlight}
              onPeek={onPeek}
              meta={note === undefined ? undefined : <span className="italic">&ldquo;{note}&rdquo;</span>}
              verdict={
                board === null ? null : (
                  <span
                    data-testid="sheet-vs-board"
                    className={`font-mono text-xs tabular-nums ${you < board ? "text-positive" : you > board ? "text-negative" : "text-text-faint"}`}
                  >
                    you {you} · board {board}
                  </span>
                )
              }
              actions={
                <>
                  {drafted ? null : (
                    <>
                      <Button size="sm" variant="ghost" disabled={index === 0} aria-label={`Move ${player.name} up your sheet`} onClick={() => onMove(playerId, -1)}>
                        <span aria-hidden="true">↑</span>
                      </Button>
                      <Button size="sm" variant="ghost" disabled={index === sheet.order.length - 1} aria-label={`Move ${player.name} down your sheet`} onClick={() => onMove(playerId, 1)}>
                        <span aria-hidden="true">↓</span>
                      </Button>
                      {canDraft ? (
                        <Button size="sm" variant={highlight ? "verb" : "secondary"} disabled={submitting} onClick={() => onDraft(playerId)}>
                          Draft
                        </Button>
                      ) : null}
                    </>
                  )}
                </>
              }
            />
          );
        })}
      </ol>
    </div>
  );
}
