"use client";

import { useEffect, useState } from "react";

/**
 * The room rail's own breakpoint — Tailwind's `xl`, the width at which `RoomShell`'s aside
 * (`hidden ... xl:flex`) actually renders. One constant, so the JS mount decision and the CSS
 * visibility rule can never disagree about where the commissioner's invite panel lives.
 */
export const RAIL_QUERY = "(min-width: 1280px)";

/**
 * Whether the room's rail is on screen (link audit, 2026-09-04: the founder's "the invite link
 * doesn't work from a created league page"). `WaitingRoom`'s "Invite someone" links target
 * `#invite-managers`, and that block lived only inside the rail — an aside that is `hidden`
 * below `xl`. Below 1280px the click changed the hash and nothing else: the anchor existed but
 * was display:none, so the browser had nothing to scroll to and the commissioner had no way to
 * mint an invite at all. `RoomShell` reads this to mount the ONE `#invite-managers` block where
 * it is actually visible: in the rail at `xl`, inline under the waiting stage below it.
 *
 * Starts `true` (the rail is the server-rendered default) and reads `matchMedia` after mount —
 * the same SSR-safe idiom `usePrefersReducedMotion` documents: reading during render would make
 * the server markup and the hydrating client's first render disagree.
 */
export function useRailVisible(): boolean {
  const [railVisible, setRailVisible] = useState(true);

  useEffect(() => {
    const query = window.matchMedia(RAIL_QUERY);
    setRailVisible(query.matches);
    const onChange = (event: MediaQueryListEvent) => setRailVisible(event.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  return railVisible;
}
