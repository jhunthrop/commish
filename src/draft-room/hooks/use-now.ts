"use client";

import { useEffect, useState } from "react";

/**
 * The ONE place browser code reads the wall clock. Returns epoch milliseconds, re-rendering
 * every `intervalMs`. Display only: a countdown never decides anything — the server ticker
 * owns clock expiry, and `TIMER_EXPIRE` has no HTTP path a client could use.
 */
export function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);

  return now;
}
