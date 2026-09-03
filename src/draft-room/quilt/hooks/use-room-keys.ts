"use client";

import { useEffect } from "react";
import type { CollapseEvent } from "../state/collapse";

/** True when the key landed somewhere that owns its own keyboard — typing or activating. */
function onInteractiveTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest("input, textarea, select, button, a, [contenteditable]") !== null;
}

/**
 * THE KEYBOARD MAP (law 2): Space toggles the drawer, `/` opens search at full, Esc collapses
 * everything. One window listener, dispatched into the collapse machine — the keys and the
 * chrome buttons speak the identical event vocabulary, so they can never disagree.
 *
 * Space and `/` defer to anything interactive under the cursor's focus (typing a note must
 * never fling the drawer around); Esc always works, because "get me back to the quilt" is the
 * one promise the room makes unconditionally.
 */
export function useRoomKeys(dispatch: (event: CollapseEvent) => void): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        dispatch({ type: "COLLAPSE_ALL" });
        return;
      }
      if (onInteractiveTarget(event.target)) return;
      if (event.key === " ") {
        event.preventDefault();
        dispatch({ type: "TOGGLE_DRAWER" });
      } else if (event.key === "/") {
        event.preventDefault();
        dispatch({ type: "OPEN_SEARCH" });
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [dispatch]);
}
