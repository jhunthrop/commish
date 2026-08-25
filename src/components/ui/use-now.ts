"use client";

import { useEffect, useState } from "react";

/**
 * The ONE place `components/ui` reads the wall clock — mirrors `useNow` in
 * `src/league-room/hooks/use-now.ts` exactly (`TradeCard`'s own expiry line is that copy's
 * consumer). `src/draft-room/hooks/use-now.ts` was a THIRD such copy, ticking the draft room's
 * own `Countdown` before that component moved here — deleted as dead code when
 * `Countdown`/`useCountdown` moved out of `draft-room` and left it with no consumer.
 *
 * Kept as this directory's own copy rather than a cross-room import, for the same reason
 * `league-room`'s copy is separate from a shared one: `docs/conventions.md`'s client-boundary
 * section has each client-boundary surface own its own hooks, and a countdown tick is cheap
 * enough that sharing the module isn't worth a cross-boundary dependency. `components/ui` is a
 * shared PRIMITIVES surface, not a "room" itself, but `Countdown`/`useCountdown` (`./countdown`)
 * are consumed by more than one room's client boundary, so this is where the shared primitive's
 * own tick belongs.
 *
 * HYDRATION-SAFE, by construction (founder-reported live defect, 2026-08-24): returns `null` on
 * the server render AND the client's first (hydrating) render, snapping to the wall clock only
 * in an effect — effects never run during either render, so the two renders agree byte-for-byte
 * no matter how far apart their clocks are. The previous `useState(() => Date.now())` seed was
 * the whole bug: the server formatted countdown text from ITS clock, the client recomputed from
 * its own milliseconds later, and React threw the hydration-mismatch error on every SSR'd page
 * carrying a clock. Consumers render their non-ticking fallback (an absolute time they already
 * hold, or `Countdown`'s stable placeholder) until non-null.
 *
 * Why `null`-until-effect over `useSyncExternalStore` with a `getServerSnapshot` sentinel: the
 * sentinel would have to be a number to keep the return type honest, and any number masquerades
 * as a real timestamp — every consumer would still need to special-case it, so it collapses
 * into this shape with more machinery. `null` is already the value consumers model ("there is
 * no reading yet" is the same branch as `useCountdown`'s "there is no deadline"), and this is
 * the exact idiom `usePrefersReducedMotion` (`@/design/use-reduced-motion`) documents for the
 * same server/client-disagreement trap. Returns epoch milliseconds once ticking, re-rendering
 * every `intervalMs`.
 */
export function useNow(intervalMs: number): number | null {
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);

  return now;
}
