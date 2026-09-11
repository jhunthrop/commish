"use client";

import { useCallback, useSyncExternalStore } from "react";

function subscribeTo(query: string, onChange: () => void): () => void {
  const list = window.matchMedia(query);
  list.addEventListener("change", onChange);
  return () => list.removeEventListener("change", onChange);
}

/**
 * Whether a CSS media query matches right now, as an external store: the server render (and the
 * hydrating client's first render) answer `false`, the client's own render reads `matchMedia`
 * directly, and a `change` re-renders exactly the caller. The same server/client agreement
 * `usePrefersReducedMotion` keeps, without the extra mount commit its effect costs — a component
 * that mounts after hydration (the draft room, which renders only once its snapshot has loaded)
 * gets the true answer on its first render and never paints the wrong tree.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback((onChange: () => void) => subscribeTo(query, onChange), [query]);
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
}
