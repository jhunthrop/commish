"use client";

import { useEffect, useState } from "react";
import { FALLBACK_LOCALE, type ReaderClock } from "../lib/day-chapters";

/**
 * THE READER'S OWN CLOCK AND LOCALE, resolved after mount and never during a render.
 *
 * HYDRATION-SAFE BY CONSTRUCTION, the same idiom `useNow` (`@/components/ui/use-now.ts`) already
 * documents and for the same founder-reported defect: it returns `null` on the server render AND
 * on the client's first, hydrating render, and snaps to the device's real values in an effect.
 * Effects never run during either render, so the two agree byte for byte no matter how far apart
 * their clocks or how different their locales. Consumers render the absolute day name until it is
 * non-null, which loses no information — only the relative word.
 *
 * It does not tick. A day marker changes at most once a day, and a timer that fires every minute
 * to re-check whether it is still Tuesday is a re-render the screen never needed. A reader who
 * leaves a tab open across midnight sees yesterday's chapter still called "Today" until the page
 * is next touched, which is the same thing every chat client does.
 *
 * `resolvedOptions().locale` rather than `navigator.language`: it is the locale `toLocaleDateString`
 * will ACTUALLY use, so the string a consumer gets is the string the browser would have produced
 * anyway. It throws on nothing in practice, but a browser with `Intl` locked down would, so the
 * fallback is the same constant the null branch uses.
 */
export function useReaderClock(): ReaderClock | null {
  const [clock, setClock] = useState<ReaderClock | null>(null);

  useEffect(() => {
    let locale = FALLBACK_LOCALE;
    try {
      locale = new Intl.DateTimeFormat().resolvedOptions().locale;
    } catch {
      // A browser with Intl locked down keeps the constant, which is a real day name either way.
    }
    setClock({ nowMs: Date.now(), locale });
  }, []);

  return clock;
}
