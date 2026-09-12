"use client";

import { useMemo, useState } from "react";
import type { Player } from "@/domain/player";
import type { SurvivalOdds, TierStandingView } from "@/draft-service/assistant/view";
import { Button } from "@/components/ui";
import { useReusedValue } from "@/design/use-stable-list";
import type { CheatSheet } from "../state/sheet";
import { buildSheetColumns, movesOffBoard, reuseSheetColumns } from "../state/sheet-columns";
import { oddsBasis } from "../../advisor/format";
import type { RoomActs } from "./room-acts";
import { SheetColumn } from "./sheet-column";
import { SheetScroller } from "./sheet-scroller";

export interface YourSheetProps extends Pick<RoomActs, "canDraft" | "submitting" | "queuedPlayerIds" | "onDraft" | "onQueueToggle" | "onPeek"> {
  readonly sheet: CheatSheet;
  /** Our board's order, for "N of yours moved" and Match our board. */
  readonly boardIds: readonly string[];
  readonly playersById: ReadonlyMap<string, Player>;
  readonly available: ReadonlySet<string>;
  readonly myPlayerIds: ReadonlySet<string>;
  readonly tiers: Readonly<Record<string, TierStandingView>>;
  readonly odds: SurvivalOdds | null;
  /** "3.07": where your next pick sits, for the odds' basis; null when you have no next turn. */
  readonly nextPickLabel: string | null;
  /** True while a fresh odds table is on its way: the basis says "updating" and the figures dim. */
  readonly recomputing: boolean;
  readonly onMove: (playerId: string, delta: number) => void;
  readonly onPlace: (playerId: string, to: number) => void;
  readonly onReset: () => void;
  /** Draft HQ's sync contract: whether this room found a server sheet for the league. `false`
   *  offers to save the room's sheet to My Sheet; every edit behaves the same either way. */
  readonly hasServerSheet: boolean;
  readonly onStartServerSheet: () => void;
}

/**
 * The tier standings this room has ever seen. The advisor ships a standing only for players still
 * on the board, so a man taken during the session would lose his tier the moment he was drafted
 * and his struck row would slide into the band below. Remembering every standing keeps "Tier 1,
 * 0 of 2 left" honest after both are gone. `useReusedValue` holds the merge across renders
 * without a ref write mid-render: the same input hands back the same merged object.
 */
function useRememberedTiers(tiers: Readonly<Record<string, TierStandingView>>): Readonly<Record<string, TierStandingView>> {
  return useReusedValue(tiers, (previous, next) => (previous === null ? next : { ...previous, ...next }));
}

/**
 * YOUR SHEET (founder ruling 1, 2026-09-10): a view of the board region, not a drawer tab.
 * Seven columns of up to fifty in your own order, tiers as bands inside each position column,
 * taken players struck in place, your picks in amber, one odds number per row, Draft on the row
 * when you are on the clock and Queue when you are not, a Hide taken switch, a column strip
 * with the count left in each whose chips scroll their column into view. It starts as our board
 * and says so until you move something.
 */
export function YourSheet({ sheet, boardIds, playersById, available, myPlayerIds, tiers, odds, nextPickLabel, recomputing, onMove, onPlace, onReset, hasServerSheet, onStartServerSheet, canDraft, submitting, queuedPlayerIds, onDraft, onQueueToggle, onPeek }: YourSheetProps) {
  const [hideTaken, setHideTaken] = useState(false);
  const remembered = useRememberedTiers(tiers);
  const built = useMemo(
    () => buildSheetColumns({ order: sheet.order, playersById, available, myPlayerIds, queuedPlayerIds, tiers: remembered, odds, hideTaken }),
    [sheet.order, playersById, available, myPlayerIds, queuedPlayerIds, remembered, odds, hideTaken],
  );
  // A pick re-renders the rows it touched and nothing else: untouched rows, bands and columns
  // keep their objects, so the memoized column and row components skip.
  const columns = useReusedValue(built, reuseSheetColumns);
  const moved = useMemo(() => movesOffBoard(sheet.order, boardIds), [sheet.order, boardIds]);
  const runs = odds === null || odds.runs === 0 ? null : odds.runs;

  return (
    <div data-testid="your-sheet" data-recomputing={recomputing ? "true" : "false"} className="group/sheet flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-0.5">
        <p data-testid="sheet-basis" className="text-xs text-text-faint">
          {moved === 0 ? (
            <>
              <span className="font-semibold text-text-primary">Our board, untouched</span> · {oddsBasis(runs, nextPickLabel)}
            </>
          ) : (
            <>
              Started from our board · <span className="font-semibold text-text-primary">{moved} of yours moved</span> · {oddsBasis(runs, nextPickLabel)}
            </>
          )}
          <span data-testid="sheet-recomputing" data-active={recomputing ? "true" : "false"} aria-hidden={!recomputing} className={recomputing ? "" : "invisible"}>
            {" "}
            · updating
          </span>
        </p>
        <span className="flex-1" />
        {hasServerSheet ? null : (
          <Button size="sm" variant="ghost" onClick={onStartServerSheet}>
            Save to My Sheet
          </Button>
        )}
        {moved === 0 ? null : (
          <Button size="sm" variant="ghost" onClick={onReset}>
            Match our board
          </Button>
        )}
        <label className="flex items-center gap-2 text-sm font-medium text-text-muted">
          <input type="checkbox" data-testid="hide-taken" checked={hideTaken} onChange={(event) => setHideTaken(event.target.checked)} className="size-4 accent-accent" />
          Hide taken
        </label>
      </div>
      <SheetScroller
        columns={columns}
        countOf={(column) => column.left}
        renderColumn={(column) => (
          <SheetColumn
            column={column}
            nextPickLabel={nextPickLabel}
            onMove={column.key === "overall" ? onMove : null}
            onPlace={column.key === "overall" ? onPlace : null}
            canDraft={canDraft}
            submitting={submitting}
            onDraft={onDraft}
            onQueueToggle={onQueueToggle}
            onPeek={onPeek}
            onNote={null}
            onTag={null}
            onTierLabel={null}
            onRemove={null}
          />
        )}
      />
    </div>
  );
}
