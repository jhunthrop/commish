"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { SheetColumnKey, SheetColumnModel } from "../state/sheet-columns";

/**
 * THE SEVEN COLUMNS AND THE STRIP THAT REACHES THEM — the carriage `YourSheet` rides in a draft
 * room and the Draft area's own sheet rides outside one (the Draft area round, 2026-09-12).
 *
 * Extracted at its second caller, which is this repo's rule: the chip strip, the sideways scroll,
 * the right-edge cue and the scroll-into-view are the same mechanism on both surfaces, and a
 * second copy would be a second set of breakpoints to keep in step. What differs between the two
 * is only what a COLUMN contains, which is why the column itself comes in as a render callback
 * rather than as a bundle of forwarded props.
 *
 * The chip's number is whatever the caller's own count means — men left on the board in a room,
 * the column's depth outside one — so the strip never states a basis of its own.
 */
export interface SheetScrollerProps {
  readonly columns: readonly SheetColumnModel[];
  /** The chip's figure beside each column's name. */
  readonly countOf: (column: SheetColumnModel) => number;
  readonly renderColumn: (column: SheetColumnModel) => ReactNode;
}

/** The right-edge fade that says more columns lie to the right (review L10). */
const SCROLL_CUE = "[mask-image:linear-gradient(to_right,black_calc(100%-3rem),transparent)]";

export function SheetScroller({ columns, countOf, renderColumn }: SheetScrollerProps) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const columnRefs = useRef(new Map<SheetColumnKey, HTMLDivElement>());
  const [moreToRight, setMoreToRight] = useState(false);
  const measureCue = (): void => {
    const element = scrollerRef.current;
    if (element === null) return;
    setMoreToRight(element.scrollLeft + element.clientWidth < element.scrollWidth - 1);
  };
  useEffect(() => {
    measureCue();
    const element = scrollerRef.current;
    if (element === null || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measureCue);
    observer.observe(element);
    return () => observer.disconnect();
  }, [columns.length]);
  const showColumn = (key: SheetColumnKey): void => {
    columnRefs.current.get(key)?.scrollIntoView({ behavior: "smooth", inline: "start", block: "nearest" });
  };

  return (
    <>
      <div role="group" aria-label="Columns" data-testid="column-strip" className="flex gap-1.5 overflow-x-auto px-0.5 pb-1">
        {columns.map((column) => (
          <button
            key={column.key}
            type="button"
            onClick={() => showColumn(column.key)}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-pill bg-surface-elevated px-3 py-1 text-xs font-semibold text-text-primary shadow-card hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            {column.label}
            <span className="font-display tabular-nums">{countOf(column)}</span>
          </button>
        ))}
      </div>
      {/* One explicit first track (Overall, wider at desktop) and fixed implicit tracks after it:
          a fixed width, never a minmax, or seven tracks shrink to share a phone's 336px. */}
      <div
        ref={scrollerRef}
        data-testid="sheet-scroller"
        data-more-right={moreToRight ? "true" : "false"}
        onScroll={measureCue}
        className={`grid min-h-0 flex-1 grid-flow-col grid-cols-[100%] auto-cols-[100%] gap-3 overflow-x-auto pb-1 [scroll-snap-type:x_mandatory] lg:grid-cols-[15rem] lg:auto-cols-[12.5rem] lg:[scroll-snap-type:x_proximity] ${moreToRight ? SCROLL_CUE : ""}`}
      >
        {columns.map((column) => (
          <div
            key={column.key}
            ref={(node) => {
              if (node === null) columnRefs.current.delete(column.key);
              else columnRefs.current.set(column.key, node);
            }}
            className="flex min-h-0 min-w-0 [scroll-snap-align:start]"
          >
            {renderColumn(column)}
          </div>
        ))}
      </div>
    </>
  );
}
