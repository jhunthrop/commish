"use client";

import { useEffect, useRef } from "react";
import { reuseListItems } from "./reuse-list-items";

interface Held<T> {
  readonly input: T;
  readonly output: T;
}

/**
 * The previous-value hook shape for identity reuse: compare the new input against what the
 * last COMMITTED render held (a pure read during render), and move the cache forward in an
 * effect, never by writing a ref mid-render. The same input hands back the same output; a new
 * input is reconciled against the previous output by `reuse`, which returns the previous object
 * wherever nothing changed.
 */
export function useReusedValue<T>(next: T, reuse: (previous: T | null, next: T) => T): T {
  const held = useRef<Held<T> | null>(null);
  const previous = held.current;
  const output = previous !== null && previous.input === next ? previous.output : reuse(previous === null ? null : previous.output, next);
  useEffect(() => {
    held.current = { input: next, output };
  });
  return output;
}

/**
 * Keyed identity reuse for a derived list of row models (`reuseListItems`): hand it the list a
 * `useMemo` just built and get one back whose rows keep their previous object wherever nothing
 * in them changed, so a memoized row component skips.
 */
export function useStableList<T extends object>(next: readonly T[], keyOf: (item: T) => string): readonly T[] {
  return useReusedValue(next, (previous, rows) => reuseListItems(previous, rows, keyOf));
}
