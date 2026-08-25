"use client";

import { useEffect, useState } from "react";

/**
 * The ONE place browser code in this room reads the wall clock — mirrors `useNow`
 * (`src/components/ui/use-now.ts`) exactly, kept as this room's own copy rather than a
 * cross-room import: each client-boundary room owns its own hooks (`docs/conventions.md`'s
 * client-boundary section), and a countdown tick is cheap enough that sharing the module isn't
 * worth a cross-room dependency. Display only, per `docs/conventions.md`'s "no ambient clock"
 * rule: `new Date()`/`Date.now()` stays out of every render body in this room, including
 * `TradeCard`'s own expiry line (fix round 2, F1 — the fix-round-1 re-review's own finding),
 * which reads this instead.
 *
 * HYDRATION-SAFE, by construction (founder-reported live defect, 2026-08-24 — see the
 * `components/ui` copy's docblock for the full argument): returns `null` on the server render
 * AND the client's first (hydrating) render, snapping to the wall clock only in an effect, so
 * server HTML and the hydrating client agree byte-for-byte. Consumers render their non-ticking
 * fallback until non-null. Returns epoch milliseconds once ticking, re-rendering every
 * `intervalMs`.
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
