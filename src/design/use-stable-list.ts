"use client";

import { useMemo, useRef } from "react";
import { reuseListItems } from "./reuse-list-items";

/**
 * Keyed identity reuse for a derived list of row models (`reuseListItems`): hand it the list a
 * `useMemo` just built and get one back whose rows keep their previous object wherever nothing
 * in them changed, so a memoized row component skips. Recomputes exactly when `next` does.
 */
export function useStableList<T extends object>(next: readonly T[], keyOf: (item: T) => string): readonly T[] {
  const previous = useRef<readonly T[] | null>(null);
  return useMemo(() => {
    const rows = reuseListItems(previous.current, next, keyOf);
    previous.current = rows;
    return rows;
  }, [next, keyOf]);
}
