"use client";

import { useEffect, useState } from "react";

/**
 * The ONE place browser code in this room reads the wall clock — mirrors `useNow`
 * (`src/draft-room/hooks/use-now.ts`) exactly, kept as this room's own copy rather than a
 * cross-room import: each client-boundary room owns its own hooks (`docs/conventions.md`'s
 * client-boundary section), and a countdown tick is cheap enough that sharing the module isn't
 * worth a cross-room dependency. Returns epoch milliseconds, re-rendering every `intervalMs`.
 * Display only, per `docs/conventions.md`'s "no ambient clock" rule: `new Date()`/`Date.now()`
 * stays out of every render body in this room, including `TradeCard`'s own expiry line
 * (fix round 2, F1 — the fix-round-1 re-review's own finding), which reads this instead.
 */
export function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);

  return now;
}
