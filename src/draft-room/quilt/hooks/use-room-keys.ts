"use client";

import { useEffect } from "react";
import type { CollapseEvent } from "../state/collapse";

/** The pool's search field, the one thing `/` reaches for wherever the focus was. */
export const POOL_SEARCH_ID = "pool-search";

/** True when the key landed somewhere that owns its own keyboard, typing or activating. */
function onInteractiveTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest("input, textarea, select, button, a, [contenteditable]") !== null;
}

/**
 * THE KEYBOARD MAP: Esc gives the stage back (closes the peek or the roster sheet), `/` jumps to
 * the pool's search. One window listener dispatching into the overlay reducer, so the keys and
 * the chrome buttons speak the identical event vocabulary. `/` defers to anything interactive
 * under focus (typing a note must never move the caret); Esc always works, because "get me back
 * to the board" is the one promise the room makes unconditionally.
 */
export function useRoomKeys(dispatch: (event: CollapseEvent) => void): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        dispatch({ type: "COLLAPSE_ALL" });
        return;
      }
      if (onInteractiveTarget(event.target)) return;
      if (event.key === "/") {
        event.preventDefault();
        document.getElementById(POOL_SEARCH_ID)?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [dispatch]);
}
