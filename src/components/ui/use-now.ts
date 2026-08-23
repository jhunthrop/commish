"use client";

import { useEffect, useState } from "react";

/**
 * The ONE place `components/ui` reads the wall clock — mirrors `useNow` in
 * `src/league-room/hooks/use-now.ts` exactly (`TradeCard`'s own expiry line is that copy's
 * consumer). `src/draft-room/hooks/use-now.ts` was a THIRD such copy, ticking the draft room's
 * own `Countdown` before that component moved here — this commit deletes it as dead code, since
 * moving `Countdown`/`useCountdown` out of `draft-room` left it with no consumer at all, rather
 * than leaving an orphaned copy behind for a later commit to notice.
 *
 * Kept as this directory's own copy rather than a cross-room import, for the same reason
 * `league-room`'s copy is separate from a shared one: `docs/conventions.md`'s client-boundary
 * section has each client-boundary surface own its own hooks, and a countdown tick is cheap
 * enough that sharing the module isn't worth a cross-boundary dependency. `components/ui` is a
 * shared PRIMITIVES surface, not a "room" itself, but `Countdown`/`useCountdown` (`./countdown`)
 * are consumed by more than one room's client boundary, so this is where the shared primitive's
 * own tick belongs. Returns epoch milliseconds, re-rendering every `intervalMs`.
 */
export function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);

  return now;
}
