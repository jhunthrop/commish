"use client";

import { useEffect, useState } from "react";

/**
 * True only after hydration — `false` on the server render AND the client's first (hydrating)
 * render, flipping in an effect, so the two renders agree byte-for-byte. The identical
 * null-until-effect contract `useNow` (`@/components/ui/use-now`) documents, reduced to the one
 * bit this component needs.
 */
function useHydrated(): boolean {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  return hydrated;
}

/** "Saturday, September 12, 7:00 PM CDT" — the viewer's own zone, NAMED, so the sentence stays
 *  checkable rather than silently local. Locale pinned to en-US (the product's own voice); the
 *  time zone is deliberately left to the browser — that is the entire point of this component. */
function formatInViewerZone(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZoneName: "short",
  }).format(new Date(iso));
}

export interface LocalDraftTimeProps {
  /** The chosen instant (`PublicLeagueSummary.draftAtIso`) — `undefined`/`null` renders the
   *  fallback forever (a summary with no instant has nothing to localize). */
  readonly iso?: string | null;
  /** The server's own UTC-labelled sentence (`draftAt`), which SSR and the hydrating render
   *  both show — the honest words while the viewer's zone is unknown. */
  readonly fallback: string;
  readonly className?: string;
}

/**
 * A draft time in the VIEWER'S timezone (front door blueprint, 2026-09-02) — as a post-hydration
 * upgrade, never a server claim. `formatDraftTime` (`@/league/terms`) is deliberately UTC-fixed
 * because no per-visitor timezone exists server-side (a recorded sibling ruling this component
 * does not relitigate); the server sentence stays the SSR truth, and once the browser's own
 * `Intl` zone is actually in hand the same instant re-renders in it, zone named. The identical
 * upgrade contract `useCountdown` already holds for the ticking clock.
 */
export function LocalDraftTime({ iso, fallback, className }: LocalDraftTimeProps) {
  const hydrated = useHydrated();
  const text = hydrated && iso != null ? formatInViewerZone(iso) : fallback;
  return <span className={className}>{text}</span>;
}
