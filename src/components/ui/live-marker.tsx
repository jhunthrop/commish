"use client";

import type { ReactNode } from "react";
import { usePrefersReducedMotion } from "@/design/use-reduced-motion";

export interface LiveMarkerProps {
  /** What is live, in the fewest words that are true: "Live", "3 to play". */
  readonly children: ReactNode;
  /** Mono tabular figures, for a marker that states a NUMBER inside its words — the same reason
   *  `Pill` sets the mono face: a count ticking 3 → 2 → 1 must not jitter the row beside it. */
  readonly mono?: boolean;
  readonly className?: string;
}

/**
 * SUNDAY v5, LAW 4, CHANNEL THREE — live, and nothing else ever.
 *
 * v4 spent one red family on two jobs: a game happening right now, and a thing that failed. v5
 * splits them, and this is the marker every "right now" fact in the season surfaces wears. The
 * verdict/failure family (`negative`) is left to mean only what it now means: we rate him lower,
 * the write did not land.
 *
 * WHY IT IS NOT A `Badge`. A pill with a border is a LABEL — a state a row happens to be in,
 * sitting quietly in its column. Live is not a label, it is the one thing on the screen that is
 * still moving, and the tower's own answer to that is a breathing dot beside a word in the live
 * ink: no border, no fill, nothing boxing it in. `LiveChip` (`open-league-shared.tsx`) reached the
 * same shape independently for the storefront's rows, which is why this exists as a primitive
 * rather than a fourth per-surface opinion about what live looks like.
 *
 * THE DOT IS DECORATION AND THE WORD IS THE FACT. `aria-hidden` on the dot: a screen reader hears
 * "Live" or "3 to play", which is the whole claim. Colour never carries a meaning alone here — the
 * words do all of it, and the ink is the glance.
 *
 * The pulse is a REAL reduced-motion branch, not a suppressed one (law 6): under
 * `prefers-reduced-motion` the marker still renders and still reads, the dot simply stops
 * breathing. Nothing here moves on mount, on scroll or on hover.
 */
export function LiveMarker({ children, mono = false, className = "" }: LiveMarkerProps) {
  const reducedMotion = usePrefersReducedMotion();
  return (
    <span
      data-live="true"
      className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap text-xs font-semibold text-live ${
        mono ? "font-mono tabular-nums" : ""
      } ${className}`}
    >
      <span aria-hidden="true" className={`size-1.5 rounded-pill bg-live${reducedMotion ? "" : " animate-pulse-live"}`} />
      {children}
    </span>
  );
}
