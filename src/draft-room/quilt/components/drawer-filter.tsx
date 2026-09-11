"use client";

import { useCallback, useMemo, useState, type ReactNode, type RefObject } from "react";
import type { Player, Position } from "@/domain/player";
import { Button, EmptyState, PositionBadge } from "@/components/ui";

export const ALL_POSITIONS = "ALL";
const POSITIONS: readonly Position[] = ["QB", "RB", "WR", "TE", "K", "DEF"];

export interface DrawerFilter {
  readonly query: string;
  readonly position: string;
  readonly setQuery: (query: string) => void;
  readonly setPosition: (position: string) => void;
  /** True when either control narrows the list. */
  readonly active: boolean;
  /** Whether a player passes both controls. Runs over the FULL list before any page is cut. */
  readonly matches: (player: Player) => boolean;
  readonly clear: () => void;
}

/**
 * THE DRAWER'S ONE FILTER (fix round, 2026-09-10): the pool tab's search and position stickers,
 * shared with the sheet and byes tabs so a player deep on a 1,779-row sheet is one search away
 * rather than eight "Show more" clicks. The filter runs over the whole list; the page is cut
 * afterwards, so a matching player is always on the first page.
 */
export function useDrawerFilter(): DrawerFilter {
  const [query, setQuery] = useState("");
  const [position, setPosition] = useState<string>(ALL_POSITIONS);
  const needle = query.trim().toLowerCase();
  const matches = useCallback(
    (player: Player): boolean => (position === ALL_POSITIONS || player.position === position) && (needle === "" || player.name.toLowerCase().includes(needle)),
    [position, needle],
  );
  const clear = useCallback(() => {
    setQuery("");
    setPosition(ALL_POSITIONS);
  }, []);
  return useMemo(
    () => ({ query, position, setQuery, setPosition, active: needle !== "" || position !== ALL_POSITIONS, matches, clear }),
    [query, position, needle, matches, clear],
  );
}

export interface DrawerFilterRowProps {
  readonly filter: DrawerFilter;
  /** The search field's ref, for a tab that focuses it on `/`. */
  readonly searchRef?: RefObject<HTMLInputElement | null>;
  /** Anything a tab adds after the stickers (the pool's need chips). */
  readonly children?: ReactNode;
}

/** The filter row: search, the six position stickers, and whatever the tab adds after them. */
export function DrawerFilterRow({ filter, searchRef, children }: DrawerFilterRowProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        ref={searchRef}
        type="search"
        aria-label="Search players"
        placeholder="Search · press / anywhere"
        value={filter.query}
        onChange={(event) => filter.setQuery(event.target.value)}
        className="min-w-0 flex-1 rounded-sm border border-edge bg-surface-inset px-3 py-1.5 text-sm text-text-primary placeholder:text-text-faint focus-visible:outline-2 focus-visible:outline-accent"
      />
      <div role="group" aria-label="Filter by position" className="flex items-center gap-1">
        {POSITIONS.map((candidate) => (
          <button
            key={candidate}
            type="button"
            aria-pressed={filter.position === candidate}
            aria-label={`Show ${candidate} only`}
            onClick={() => filter.setPosition(filter.position === candidate ? ALL_POSITIONS : candidate)}
            className={`rounded-sm p-0.5 focus-visible:outline-2 focus-visible:outline-accent ${filter.position === candidate ? "ring-2 ring-accent" : ""}`}
          >
            <PositionBadge position={candidate} size="sm" />
          </button>
        ))}
      </div>
      {children}
    </div>
  );
}

/** The empty state every filtered drawer list shares, with the one verb that undoes the filter. */
export function DrawerFilterEmpty({ filter }: { readonly filter: DrawerFilter }) {
  return (
    <EmptyState
      title="No players match"
      description="Try a different name or position."
      icon="search"
      action={
        <Button variant="secondary" onClick={filter.clear}>
          Clear filters
        </Button>
      }
    />
  );
}
