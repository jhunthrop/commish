"use client";

import type { ReactNode } from "react";

export type BoardView = "wall" | "sheet";

const VIEW_LABEL: Readonly<Record<BoardView, string>> = { wall: "Wall", sheet: "Your sheet" };

export interface BoardRegionProps {
  readonly view: BoardView;
  readonly onView: (view: BoardView) => void;
  /** The wall's own line beside the switch ("23 picks in · your turn"). */
  readonly caption: ReactNode;
  readonly children: ReactNode;
}

/**
 * THE BOARD REGION (ruling 1): a two-position switch, Wall and Your sheet, over whichever view
 * is on. The switch is a chalk track with a paper thumb rather than the mock's ink pill: round
 * one retired the black button, and a view switch is neither a verb (blue) nor yours (amber).
 */
export function BoardRegion({ view, onView, caption, children }: BoardRegionProps) {
  return (
    <section aria-label="The board" data-testid="board-region" data-view={view} className="flex min-h-0 min-w-0 flex-1 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3">
        <div role="tablist" aria-label="Board view" data-testid="board-switch" className="inline-flex gap-0.5 rounded-pill bg-surface-inset p-0.5">
          {(Object.keys(VIEW_LABEL) as BoardView[]).map((candidate) => (
            <button
              key={candidate}
              type="button"
              role="tab"
              aria-selected={view === candidate}
              onClick={() => onView(candidate)}
              className={`rounded-pill px-3.5 py-1.5 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${view === candidate ? "bg-surface-elevated text-text-primary shadow-card" : "text-text-muted hover:text-text-primary"}`}
            >
              {VIEW_LABEL[candidate]}
            </button>
          ))}
        </div>
        {caption}
      </div>
      {children}
    </section>
  );
}
