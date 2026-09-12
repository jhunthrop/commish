"use client";

import type { ReactNode } from "react";
import { ViewSwitch } from "@/components/ui";

export type BoardView = "wall" | "sheet";

const STOPS = [
  { value: "wall", label: "Wall" },
  { value: "sheet", label: "Your sheet" },
] as const;

export interface BoardRegionProps {
  readonly view: BoardView;
  readonly onView: (view: BoardView) => void;
  /** The wall's own line beside the switch ("23 picks in · your turn"). */
  readonly caption: ReactNode;
  readonly children: ReactNode;
}

/**
 * THE BOARD REGION (ruling 1): a two-position switch, Wall and Your sheet, over whichever view
 * is on. The switch is `ViewSwitch` (`@/components/ui`), the one spelling of this gesture in the
 * product — round one retired the black button, and a view switch is neither a verb (blue) nor
 * yours (amber). The Draft area's three stops wear the same track one stop wider.
 */
export function BoardRegion({ view, onView, caption, children }: BoardRegionProps) {
  return (
    <section aria-label="The board" data-testid="board-region" data-view={view} className="flex min-h-0 min-w-0 flex-1 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3">
        <ViewSwitch label="Board view" stops={STOPS} value={view} onChange={(next) => onView(next as BoardView)} />
        {caption}
      </div>
      {children}
    </section>
  );
}
