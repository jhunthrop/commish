/**
 * THE QUILT'S COLLAPSE MACHINE — the design law as a data structure.
 *
 * "The quilt owns the stage; every other surface borrows space and gives it back; ONE expanded
 * surface at a time." That last clause is not enforced by discipline at call sites: the state IS
 * the one open surface, a single discriminated union, so two surfaces open at once is a shape
 * this module cannot even spell. The drawer's collapsed handle row and the slim clock strip are
 * renderings of `{ kind: "none" }` — resting is a state the quilt owns, not the absence of one.
 * (The roster spine died 2026-09-03 — the roster is the drawer's own ROSTER tab now, so the
 * machine no longer spells a spine surface at all.)
 *
 * Pure reducer, no React: the keyboard map (`use-room-keys`), the drawer chrome and the quilt's
 * cells all dispatch the same events, and the transitions are testable without a DOM.
 */

export const DRAWER_TABS = ["pool", "assistant", "sheet", "roster", "byes", "picks"] as const;
export type DrawerTab = (typeof DRAWER_TABS)[number];

export type DrawerHeight = "half" | "full";

export type ExpandedSurface =
  | { readonly kind: "none" }
  | { readonly kind: "drawer"; readonly height: DrawerHeight; readonly tab: DrawerTab }
  | { readonly kind: "peek"; readonly playerId: string };

export type CollapseEvent =
  /** Space: none → drawer half; drawer full → half; drawer half → none. From the peek it
   *  borrows the stage for the drawer instead — one expanded surface, so the old one closes. */
  | { readonly type: "TOGGLE_DRAWER" }
  /** `/`: search wants the full pool list under it, wherever you were. */
  | { readonly type: "OPEN_SEARCH" }
  | { readonly type: "OPEN_PEEK"; readonly playerId: string }
  /** Tapping the peeked player's own cell/row again dismisses; anything else re-peeks. */
  | { readonly type: "CLOSE_PEEK" }
  | { readonly type: "SET_TAB"; readonly tab: DrawerTab }
  | { readonly type: "SET_HEIGHT"; readonly height: DrawerHeight }
  /** Esc: everything gives the stage back. */
  | { readonly type: "COLLAPSE_ALL" };

export const RESTING: ExpandedSurface = { kind: "none" };

/** The tab a drawer opened from rest shows: the pool, the thing a draft is made of. */
const DEFAULT_TAB: DrawerTab = "pool";

export function reduceCollapse(state: ExpandedSurface, event: CollapseEvent): ExpandedSurface {
  switch (event.type) {
    case "TOGGLE_DRAWER":
      if (state.kind !== "drawer") return { kind: "drawer", height: "half", tab: DEFAULT_TAB };
      return state.height === "full" ? { ...state, height: "half" } : RESTING;
    case "OPEN_SEARCH":
      return { kind: "drawer", height: "full", tab: "pool" };
    case "OPEN_PEEK":
      // Peeking the already-peeked player is a dismissal — the "click away or click again" rule.
      if (state.kind === "peek" && state.playerId === event.playerId) return RESTING;
      return { kind: "peek", playerId: event.playerId };
    case "CLOSE_PEEK":
      return state.kind === "peek" ? RESTING : state;
    case "SET_TAB":
      // A tab is a fact about the drawer; from any other surface it opens the drawer AT that tab
      // (the mobile tab bar and the drawer share this event), at half unless already sized.
      return state.kind === "drawer" ? { ...state, tab: event.tab } : { kind: "drawer", height: "half", tab: event.tab };
    case "SET_HEIGHT":
      return state.kind === "drawer" ? { ...state, height: event.height } : { kind: "drawer", height: event.height, tab: DEFAULT_TAB };
    case "COLLAPSE_ALL":
      return RESTING;
  }
}
