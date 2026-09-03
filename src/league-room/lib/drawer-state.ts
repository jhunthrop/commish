/**
 * THE DRAWER STATE MACHINE — law 2 of the league room (the route rule).
 *
 * One surface expanded at a time, three heights, and full height IS the route. This module is
 * the pure reducer; the shell (`room-shell.tsx`) owns the two side effects the machine cannot:
 * pushing the sub-route URL when a surface reaches `"full"` and returning to the room URL when
 * it leaves, both through the native `history.pushState` integration so the drawer animates in
 * place instead of remounting. `routeSync` is how the URL stays the authority: popstate, deep
 * links and back all funnel through it.
 *
 * Written as a reducer over a closed event union (the `apply-event.ts` idiom from the draft
 * room) so every keyboard rule in the mock — space toggles, esc walks DOWN one height, one
 * expanded surface at a time — is a unit-tested transition, not a scatter of handlers.
 */

export const DRAWER_SURFACES = ["players", "standings", "trades", "activity"] as const;
export type DrawerSurface = (typeof DRAWER_SURFACES)[number];

export type DrawerHeight = "chip" | "half" | "full";

export interface DrawerState {
  /** `null` exactly when the drawer is collapsed to the chip row. */
  readonly surface: DrawerSurface | null;
  readonly height: DrawerHeight;
  /** What `space` reopens. Players until the user has expanded something else. */
  readonly lastSurface: DrawerSurface;
}

export const CLOSED_DRAWER: DrawerState = { surface: null, height: "chip", lastSurface: "players" };

export type DrawerEvent =
  | { readonly kind: "chipTap"; readonly surface: DrawerSurface }
  | { readonly kind: "expand" }
  | { readonly kind: "space" }
  | { readonly kind: "slash" }
  | { readonly kind: "esc" }
  | { readonly kind: "routeSync"; readonly surface: DrawerSurface | null };

const open = (surface: DrawerSurface, height: Exclude<DrawerHeight, "chip">): DrawerState => ({
  surface,
  height,
  lastSurface: surface,
});

const closed = (lastSurface: DrawerSurface): DrawerState => ({ surface: null, height: "chip", lastSurface });

/** Pure transition. The shell compares `height === "full"` before and after to sync the URL. */
export function drawerReduce(state: DrawerState, event: DrawerEvent): DrawerState {
  switch (event.kind) {
    case "chipTap": {
      if (state.surface === null) return open(event.surface, "half");
      if (state.surface === event.surface) return closed(state.surface);
      return open(event.surface, state.height === "chip" ? "half" : state.height);
    }
    case "expand": {
      if (state.surface === null) return state;
      return open(state.surface, "full");
    }
    case "space": {
      if (state.surface === null) return open(state.lastSurface, "half");
      if (state.height === "full") return open(state.surface, "half");
      return closed(state.surface);
    }
    case "slash": {
      // "/" is the players-search key: open players, keep an already-expanded height.
      if (state.surface === "players") return state.height === "chip" ? open("players", "half") : state;
      return open("players", state.height === "full" ? "full" : "half");
    }
    case "esc": {
      if (state.surface === null) return state;
      if (state.height === "full") return open(state.surface, "half");
      return closed(state.surface);
    }
    case "routeSync": {
      if (event.surface !== null) return open(event.surface, "full");
      // Back on the room URL: a full drawer steps down to half (the esc/back walk),
      // anything else is already consistent with the room path.
      if (state.height === "full" && state.surface !== null) return open(state.surface, "half");
      return state;
    }
  }
}
