"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { Button } from "@/components/ui";
import { MICRO_LABEL } from "@/components/ui/config";
import { DRAWER_SURFACES, type DrawerState, type DrawerSurface } from "../lib/drawer-state";

export const SURFACE_LABEL: Readonly<Record<DrawerSurface, string>> = {
  players: "Players",
  standings: "Standings",
  trades: "Trades",
  activity: "Activity",
};

/** The keys this room answers to, as glyphs and the noun each one reaches. */
const SHORTCUTS: readonly (readonly [string, string])[] = [
  ["space", "Drawer"],
  ["/", "Players"],
  ["esc", "Room"],
];

/**
 * THE KEYS, ON ASKING ONLY (P7: "UX explains itself, no tips"). This row used to be a sentence
 * printed under the chip row on every visit — "space opens the drawer · / searches players · esc
 * collapses everything" — which is an explainer under a control, exactly what this product does
 * not ship. The shortcuts themselves are untouched; `?` is what puts their glyphs on screen, and
 * `?` again or `esc` takes them off. A glyph beside a noun is a legend, not a sentence.
 */
function KeyboardGlyphs() {
  return (
    <span data-testid="keyboard-glyphs" className="ml-auto hidden items-center gap-3 lg:flex">
      {SHORTCUTS.map(([key, reaches]) => (
        <span key={key} className="flex items-center gap-1">
          <kbd className="rounded-sm border border-line px-1.5 py-0.5 font-mono text-xs text-text-muted">{key}</kbd>
          <span className={`${MICRO_LABEL} text-text-faint`}>{reaches}</span>
        </span>
      ))}
    </span>
  );
}

export interface RoomDrawerProps {
  readonly leagueId: string;
  readonly state: DrawerState;
  /** Whether `?` has been pressed. The shell owns the key; this row owns the glyphs. */
  readonly keysShown: boolean;
  readonly onChipTap: (surface: DrawerSurface) => void;
  readonly onExpand: () => void;
  readonly onEsc: () => void;
  /** The active surface's content — the SAME component at half and full (law 2). */
  readonly children: ReactNode;
}

/**
 * THE DRAWER — law 2's three heights in one component. The chip row is the collapsed state and
 * never leaves; the panel overlays the stage at half, covers it at full (where the shell has
 * already made the sub-route URL current). On phones the chip row projects to a bottom tab bar
 * over the same surfaces, with the room itself as the first tab.
 */
export function RoomDrawer({ leagueId, state, keysShown, onChipTap, onExpand, onEsc, children }: RoomDrawerProps) {
  const base = `/app/leagues/${leagueId}`;
  return (
    <>
      {state.surface === null ? null : (
        <div
          className={`absolute inset-x-0 bottom-0 z-10 flex flex-col border-t border-line bg-surface-elevated ${
            state.height === "full" ? "top-0" : "h-[55%] shadow-card"
          }`}
          aria-label={`${SURFACE_LABEL[state.surface]} drawer`}
        >
          <div className="flex items-center gap-2 border-b border-line px-4 py-1.5">
            <span className={`${MICRO_LABEL} text-text-faint`}>{SURFACE_LABEL[state.surface]}</span>
            <div className="ml-auto flex items-center gap-1">
              {state.height === "half" ? (
                <Button variant="ghost" size="sm" onClick={onExpand}>
                  Full height
                </Button>
              ) : null}
              <Button variant="ghost" size="sm" onClick={onEsc}>
                {state.height === "full" ? "Back to room" : "Collapse"}
              </Button>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
        </div>
      )}

      {/* The chip row: the drawer's collapsed state, always present on desktop. */}
      <div className="hidden items-center gap-2 border-t border-line bg-surface-elevated px-4 py-2 md:flex">
        {DRAWER_SURFACES.map((surface) => {
          const active = state.surface === surface;
          return (
            <button
              key={surface}
              type="button"
              onClick={() => onChipTap(surface)}
              aria-expanded={active}
              className={`rounded-md border px-3 py-1 font-display text-sm font-semibold ${
                active
                  ? "border-accent text-accent"
                  : "border-line text-text-muted hover:border-edge hover:text-text-primary"
              }`}
            >
              {SURFACE_LABEL[surface]}
            </button>
          );
        })}
        {keysShown ? <KeyboardGlyphs /> : null}
      </div>

      {/* Phone projection: the same surfaces as a bottom tab bar, the room first. LAW 2's ONE
          MOBILE EXCEPTION, deliberate: these are real Links (a remount), not the desktop's
          pushState — deep-linkable tabs are the right phone pattern, and each tab remount
          re-reads fresh data, which a phone that sat in a pocket wants. */}
      <nav className="fixed inset-x-0 bottom-0 z-30 flex border-t border-line bg-surface-elevated md:hidden" aria-label="League room">
        <Link
          href={base}
          aria-current={state.surface === null ? "page" : undefined}
          className={`flex-1 py-3 text-center font-display text-xs font-semibold ${
            state.surface === null ? "border-t-2 border-accent text-accent" : "text-text-faint"
          }`}
        >
          Room
        </Link>
        {DRAWER_SURFACES.map((surface) => (
          <Link
            key={surface}
            href={`${base}/${surface}`}
            aria-current={state.surface === surface ? "page" : undefined}
            className={`flex-1 py-3 text-center font-display text-xs font-semibold ${
              state.surface === surface ? "border-t-2 border-accent text-accent" : "text-text-faint"
            }`}
          >
            {SURFACE_LABEL[surface]}
          </Link>
        ))}
      </nav>
    </>
  );
}
