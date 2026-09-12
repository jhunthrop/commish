"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui";
import { tierBandLabel } from "@/draft-hq/board/copy";
import { QUILT_CONFIG } from "../state/config";
import { bandAt, layoutColumn, nextOpenTierOffset, windowFor, type SheetBand, type SheetColumnModel } from "../state/sheet-columns";
import type { RoomActs } from "./room-acts";
import { SheetRow, type SheetRowProps } from "./sheet-row";

export interface SheetColumnProps extends Pick<RoomActs, "canDraft" | "submitting" | "onDraft"> {
  /** Null where no player card exists to open (outside a room). */
  readonly onPeek: RoomActs["onPeek"] | null;
  readonly column: SheetColumnModel;
  /** The Overall column alone reorders: arrows on a row, drag between rows. */
  readonly onMove: ((playerId: string, delta: number) => void) | null;
  readonly onPlace: ((playerId: string, to: number) => void) | null;
  /** Null outside a room: no queue exists, so no row offers to hold a man in one. */
  readonly onQueueToggle: RoomActs["onQueueToggle"] | null;
  /** The manager's own marks, forwarded to every row. All null in a room (`SheetRowProps`). */
  readonly onNote: SheetRowProps["onNote"];
  readonly onTag: SheetRowProps["onTag"];
  readonly onTierLabel: SheetRowProps["onTierLabel"];
  readonly onRemove: SheetRowProps["onRemove"];
  /**
   * THE TWO HEADS THIS COLUMN CAN WEAR (the Draft area round, 2026-09-12). In a room the count
   * that matters is how many of these men are still on the board ("8 left of 50"). Outside one
   * nothing is taken and that number would be the depth cap repeated, so the head states the
   * depth instead ("top 50 of 203") — which is the honest thing a capped list owes its reader.
   */
  readonly head?: "left" | "depth";
  /**
   * The word a band counts in, outside a room — "QB", or "player" for the column that spans
   * positions. Null keeps the room's own live count ("3 of 5 left").
   */
  readonly bandNoun?: string | null;
  /**
   * The jump to the next open tier at the column's foot. Room-only by prop, not by accident: with
   * nothing taken every tier below is open, so the button would offer to scroll to the very next
   * band forever.
   */
  readonly jumpToOpenTier?: boolean;
}

/** The viewport assumed before the list measures itself (jsdom never does). */
const DEFAULT_VIEWPORT_PX = 640;

/**
 * A tier band, in the column's own vocabulary: quiet, amber when one man is left, dim when none.
 *
 * TWO COUNTS, ONE LADDER (the Draft area round, 2026-09-12). In a room the fact is how many of
 * this tier are still on the board, and it changes every time somebody picks. Outside one nothing
 * is taken, so "50 of 50 left" would be the tier's own size said twice; the band carries the
 * board's own sentence there instead — the same words, off the same ladder, as the tier divider
 * two taps away on the Board.
 */
function BandHeader({ band, top, pinned, noun, heightPx }: { readonly band: SheetBand; readonly top: number; readonly pinned: boolean; readonly noun: string | null; readonly heightPx: number }) {
  const tone = band.left === 0 ? "bg-surface text-text-faint opacity-60" : band.left === 1 ? "self-wash text-self-ink" : "bg-surface text-text-muted";
  return (
    <div
      data-testid={pinned ? "sheet-band-pinned" : "sheet-band"}
      style={{ height: heightPx, top }}
      className={`${pinned ? "sticky z-10" : "absolute"} inset-x-1 flex items-center gap-2 rounded-xl px-2.5 text-[11px] font-semibold ring-[3px] ring-surface-elevated ${tone}`}
    >
      <span className="shrink-0">Tier {band.tier}</span>
      {/* The room's count is one short figure and stays on its line; the board's sentence wraps
          to the band's second line rather than losing the unit off the end of its own number. */}
      <span className={`ml-auto min-w-0 text-right leading-tight ${noun === null ? "truncate font-display tabular-nums" : ""}`}>
        {noun === null ? `${band.left} of ${band.size} left` : tierBandLabel(noun, band.left, band.drop ?? 0)}
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
export const SheetColumn = memo(function SheetColumn({ column, onMove, onPlace, canDraft, submitting, onDraft, onQueueToggle, onPeek, onNote, onTag, onTierLabel, onRemove, head = "left", jumpToOpenTier = true, bandNoun = null }: SheetColumnProps) {
  const bandPx = bandNoun === null ? QUILT_CONFIG.sheet.bandPx : QUILT_CONFIG.sheet.bandTallPx;
  const layout = useMemo(() => layoutColumn(column, bandPx), [column, bandPx]);
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
  const nextOpen = useMemo(
    () => (jumpToOpenTier ? nextOpenTierOffset(layout, scrollTop + viewportPx - bandPx) : null),
    [jumpToOpenTier, layout, scrollTop, viewportPx, bandPx],
  );
  const rowCount = column.bands.reduce((sum, band) => sum + band.rows.length, 0);

  const onDragStart = useCallback((playerId: string) => {
    dragging.current = playerId;
  }, []);
  // The drop reads the layout through a ref, so the handler keeps its identity across picks and
  // the memoized rows it reaches do not re-render for a layout they are not part of.
  const layoutRef = useRef(layout);
  useEffect(() => {
    layoutRef.current = layout;
  }, [layout]);
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
          {head === "left" ? `${column.left} left of ${column.total}` : `top ${column.total} of ${column.pool}`}
        </span>
      </h2>
      <div ref={scrollRef} onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)} className="relative min-h-0 flex-1 overflow-y-auto">
        {pinned === null ? null : <BandHeader band={pinned} top={0} pinned noun={bandNoun} heightPx={bandPx} />}
        <ol aria-label={`${column.label}, your order`} className="relative mb-10" style={{ height: layout.height }}>
          {rowCount === 0 ? <li className="px-3 py-4 text-sm text-text-faint">Nobody left here.</li> : null}
          {layout.items.slice(window.start, window.end).map((item, offset) => {
            const index = window.start + offset;
            const top = layout.offsets[index]!;
            if (item.kind === "band") return <BandHeader key={item.band.key} band={item.band} top={top} pinned={false} noun={bandNoun} heightPx={bandPx} />;
            return (
              <SheetRow
                key={item.row.player.id}
                row={item.row}
                top={top}
                column={column.key}
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
                onNote={onNote}
                onTag={onTag}
                onTierLabel={onTierLabel}
                onRemove={onRemove}
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
