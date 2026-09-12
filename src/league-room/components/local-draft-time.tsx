"use client";

import { useReaderClock } from "../hooks/use-reader-clock";
import { absoluteInstant } from "../lib/day-chapters";

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
 *
 * ROUTED THROUGH THE ONE SHARED CLOCK (2026-09-11 fix round): this used to resolve its own
 * hydration bit and its own `Intl.DateTimeFormat`, a second copy of the exact contract
 * `useReaderClock`/`absoluteInstant` (`../hooks/use-reader-clock`, `../lib/day-chapters`) already
 * hold for the front door's "Seat counts as of" line. Two formatters answering "what time is it
 * in the reader's zone" could drift — one already had (this one never named the weekday off the
 * SAME `formatToParts` call the time came from, so a reader whose local day differs from UTC's
 * could in principle see a day and a time that disagree). `useReaderClock`'s `null` before mount
 * is `absoluteInstant`'s `null` branch, which renders the identical FALLBACK_LOCALE/
 * FALLBACK_TIME_ZONE (en-US/UTC) shape `fallback` is baked in — so the SSR pass and the client's
 * first (hydrating) render still agree byte for byte, exactly as before.
 */
export function LocalDraftTime({ iso, fallback, className }: LocalDraftTimeProps) {
  const clock = useReaderClock();
  const text = clock !== null && iso != null ? absoluteInstant(iso, clock) : fallback;
  return <span className={className}>{text}</span>;
}
