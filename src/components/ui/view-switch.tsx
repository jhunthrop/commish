import Link from "next/link";

/**
 * THE VIEW SWITCH — a chalk track with a paper thumb, two or three stops wide, over one region
 * whose CONTENT changes while its identity does not.
 *
 * It is not `SegmentGroup`. That rail fills the chosen chip in Court blue because it is a
 * FILTER: the reader is narrowing what a list contains, and blue is the chosen-thing pigment. A
 * view switch changes which of a few whole views is on screen under one unchanged heading, which
 * is neither a verdict nor a verb nor a narrowing, so it wears neither the accent nor the self
 * channel — the thumb is simply the paper the chosen view sits on, lifted off the inset track.
 *
 * The draft room drew it first (Wall / Your sheet, founder ruling 1, 2026-09-10) and the Draft
 * area's three stops are the same gesture one stop wider, so a manager learns it once. Both call
 * sites live here rather than in two files: the room's switch is CLIENT STATE (the room never
 * navigates, a pick can land mid-switch) and the Draft area's is the URL (each stop is a page you
 * can link a friend to), which is a difference in what a stop MEANS, not in what it looks like.
 *
 * No `"use client"`: the link form has to render from a server page, and a client module's
 * export cannot be called during a server render (`chip.tsx`'s own scar). `ViewSwitch` carries
 * its own directive at its call site, the way every other handler-taking primitive does.
 */

export interface ViewSwitchStop {
  readonly value: string;
  readonly label: string;
}

/** A stop that is its own address. */
export interface ViewSwitchDestination extends ViewSwitchStop {
  readonly href: string;
}

const TRACK = "inline-flex gap-0.5 rounded-pill bg-surface-inset p-0.5";

function stopClassName(active: boolean): string {
  return `rounded-pill px-3.5 py-1.5 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
    active ? "bg-surface-elevated text-text-primary shadow-card" : "text-text-muted hover:text-text-primary"
  }`;
}

export interface ViewSwitchProps {
  /** The switch's accessible name — what the stops are stops OF ("Board view"). */
  readonly label: string;
  readonly stops: readonly ViewSwitchStop[];
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly className?: string;
}

/** The switch as CLIENT STATE: the region under it swaps with no navigation. */
export function ViewSwitch({ label, stops, value, onChange, className = "" }: ViewSwitchProps) {
  return (
    <div role="tablist" aria-label={label} data-testid="view-switch" className={`${TRACK} ${className}`}>
      {stops.map((stop) => (
        <button key={stop.value} type="button" role="tab" aria-selected={value === stop.value} onClick={() => onChange(stop.value)} className={stopClassName(value === stop.value)}>
          {stop.label}
        </button>
      ))}
    </div>
  );
}

export interface ViewSwitchNavProps {
  readonly label: string;
  readonly stops: readonly ViewSwitchDestination[];
  readonly value: string;
  readonly className?: string;
}

/** The same switch where each stop is an ADDRESS: the URL says which view you are on, so a stop
 *  survives a refresh and can be sent to somebody. */
export function ViewSwitchNav({ label, stops, value, className = "" }: ViewSwitchNavProps) {
  return (
    <nav aria-label={label} data-testid="view-switch" className={`${TRACK} ${className}`}>
      {stops.map((stop) => (
        <Link key={stop.value} href={stop.href} aria-current={value === stop.value ? "page" : undefined} className={stopClassName(value === stop.value)}>
          {stop.label}
        </Link>
      ))}
    </nav>
  );
}
