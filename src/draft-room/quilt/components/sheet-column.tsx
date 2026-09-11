"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui";
import { QUILT_CONFIG } from "../state/config";
import { bandAt, layoutColumn, nextOpenTierOffset, windowFor, type SheetBand, type SheetColumnModel } from "../state/sheet-columns";
import type { RoomActs } from "./room-acts";
import { SheetRow } from "./sheet-row";

export interface SheetColumnProps extends Pick<RoomActs, "canDraft" | "submitting" | "onDraft" | "onQueueToggle" | "onPeek"> {
  readonly column: SheetColumnModel;
  /** The Overall column alone reorders: arrows on a row, drag between rows. */
  readonly onMove: ((playerId: string, delta: number) => void) | null;
  readonly onPlace: ((playerId: string, to: number) => void) | null;
}

/** The viewport assumed before the list measures itself (jsdom never does). */
const DEFAULT_VIEWPORT_PX = 640;

/** A tier band, in the column's own vocabulary: quiet, amber when one man is left, dim when none. */
function BandHeader({ band, top, pinned }: { readonly band: SheetBand; readonly top: number; readonly pinned: boolean }) {
  const tone = band.left === 0 ? "bg-surface text-text-faint opacity-60" : band.left === 1 ? "self-wash text-self-ink" : "bg-surface text-text-muted";
  return (
    <div
      data-testid={pinned ? "sheet-band-pinned" : "sheet-band"}
      style={{ height: QUILT_CONFIG.sheet.bandPx, top }}
      className={`${pinned ? "sticky z-10" : "absolute"} inset-x-1 flex items-center justify-between rounded-pill px-2.5 text-[11px] font-semibold ring-[3px] ring-surface-elevated ${tone}`}
    >
      <span>Tier {band.tier}</span>
      <span className="font-display tabular-nums">
        {band.left} of {band.size} left
      </span>
    </div>
  );
}

/**
 * ONE COLUMN OF YOUR SHEET, WINDOWED (ruling 4: seven columns of fifty with a pick landing every
 * 700 ms, virtualized, rows keyed by player id). The list is one relative box of the column's
 * whole height; only the rows inside the scroll window (plus an overscan) are in the DOM, each
 * absolutely placed at its offset. The band the scroll is inside stays pinned at the top, so
 * you always know which tier you are in; the jump at the foot scrolls to the next open one.
 */
export const SheetColumn = memo(function SheetColumn({ column, onMove, onPlace, canDraft, submitting, onDraft, onQueueToggle, onPeek }: SheetColumnProps) {
  const layout = useMemo(() => layoutColumn(column), [column]);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportPx, setViewportPx] = useState(DEFAULT_VIEWPORT_PX);
  const dragging = useRef<string | null>(null);

  useEffect(() => {
    const element = scrollRef.current;
    if (element === null || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const measured = entries[0]?.contentRect.height;
      if (measured !== undefined && measured > 0) setViewportPx(Math.round(measured));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const window = useMemo(() => windowFor(layout, scrollTop, viewportPx), [layout, scrollTop, viewportPx]);
  // The band the scroll is inside pins at the top only once its own header has scrolled away.
  const pinned = useMemo(() => {
    const band = bandAt(layout, scrollTop);
    if (band === null) return null;
    const index = layout.items.findIndex((item) => item.kind === "band" && item.band.key === band.key);
    return index !== -1 && layout.offsets[index]! < scrollTop ? band : null;
  }, [layout, scrollTop]);
  // The jump offers only a tier that is below what the column shows right now.
  const nextOpen = useMemo(() => nextOpenTierOffset(layout, scrollTop + viewportPx - QUILT_CONFIG.sheet.bandPx), [layout, scrollTop, viewportPx]);
  const rowCount = column.bands.reduce((sum, band) => sum + band.rows.length, 0);

  const onDragStart = useCallback((playerId: string) => {
    dragging.current = playerId;
  }, []);
  // The drop reads the layout through a ref, so the handler keeps its identity across picks and
  // the memoized rows it reaches do not re-render for a layout they are not part of.
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const onDropOn = useCallback(
    (targetId: string) => {
      const moved = dragging.current;
      dragging.current = null;
      if (moved === null || moved === targetId || onPlace === null) return;
      const target = layoutRef.current.items.find((item) => item.kind === "row" && item.row.player.id === targetId);
      if (target === undefined || target.kind !== "row") return;
      onPlace(moved, target.row.rank - 1);
    },
    [onPlace],
  );

  const jump = (): void => {
    if (nextOpen === null || scrollRef.current === null) return;
    scrollRef.current.scrollTo({ top: nextOpen, behavior: "smooth" });
  };

  return (
    <section data-testid="sheet-column" data-column={column.key} aria-label={column.label} className="flex min-h-0 w-full min-w-0 flex-1 flex-col rounded-xl bg-surface-elevated shadow-card">
      <h2 className="flex items-baseline justify-between gap-2 px-3 pb-2 pt-3 font-display text-lg font-extrabold text-text-primary">
        {column.label}
        <span className="font-sans text-xs font-medium text-text-faint tabular-nums">
          {column.left} left of {column.total}
        </span>
      </h2>
      <div ref={scrollRef} onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)} className="relative min-h-0 flex-1 overflow-y-auto">
        {pinned === null ? null : <BandHeader band={pinned} top={0} pinned />}
        <ol aria-label={`${column.label}, your order`} className="relative mb-10" style={{ height: layout.height }}>
          {rowCount === 0 ? <li className="px-3 py-4 text-sm text-text-faint">Nobody left here.</li> : null}
          {layout.items.slice(window.start, window.end).map((item, offset) => {
            const index = window.start + offset;
            const top = layout.offsets[index]!;
            if (item.kind === "band") return <BandHeader key={item.band.key} band={item.band} top={top} pinned={false} />;
            return (
              <SheetRow
                key={item.row.player.id}
                row={item.row}
                top={top}
                overall={column.key === "overall"}
                onMove={onMove}
                onDragStart={onPlace === null ? null : onDragStart}
                onDropOn={onPlace === null ? null : onDropOn}
                first={item.row.rank === 1}
                last={item.row.rank === column.total}
                canDraft={canDraft}
                submitting={submitting}
                onDraft={onDraft}
                onQueueToggle={onQueueToggle}
                onPeek={onPeek}
              />
            );
          })}
        </ol>
        {nextOpen === null ? null : (
          <div className="pointer-events-none sticky bottom-1.5 z-10 flex justify-center">
            <Button size="sm" variant="secondary" className="pointer-events-auto bg-surface-elevated shadow-card" onClick={jump}>
              Next open tier ↓
            </Button>
          </div>
        )}
      </div>
    </section>
  );
});
