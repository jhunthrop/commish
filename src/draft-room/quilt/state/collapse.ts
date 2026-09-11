/**
 * THE ROOM'S ONE OVERLAY — the design law as a data structure.
 *
 * Sideline's draft room (founder rulings 2026-09-10, first principles §7) has no drawer: the
 * board region, the stream and the dock are always on stage. What still borrows the stage, one
 * at a time, is an overlay: the player peek (a landed cell, a sheet row's chevron) or a roster
 * sheet (a manager head on the wall). The state IS the one open overlay, a single discriminated
 * union, so two overlays open at once is a shape this module cannot spell.
 *
 * Pure reducer, no React: the keyboard map (`use-room-keys`), the wall's heads and the rows all
 * dispatch the same events, and the transitions are testable without a DOM.
 */

export type ExpandedSurface =
  | { readonly kind: "none" }
  | { readonly kind: "peek"; readonly playerId: string }
  | { readonly kind: "roster"; readonly teamId: string };

export type CollapseEvent =
  | { readonly type: "OPEN_PEEK"; readonly playerId: string }
  /** Tapping the peeked player's own cell/row again dismisses; anything else re-peeks. */
  | { readonly type: "CLOSE_PEEK" }
  /** A manager head on the wall: that team's roster as a sheet. The same head again closes it. */
  | { readonly type: "OPEN_ROSTER"; readonly teamId: string }
  /** Esc: everything gives the stage back. */
  | { readonly type: "COLLAPSE_ALL" };

export const RESTING: ExpandedSurface = { kind: "none" };

export function reduceCollapse(state: ExpandedSurface, event: CollapseEvent): ExpandedSurface {
  switch (event.type) {
    case "OPEN_PEEK":
      // Peeking the already-peeked player is a dismissal — the "click away or click again" rule.
      if (state.kind === "peek" && state.playerId === event.playerId) return RESTING;
      return { kind: "peek", playerId: event.playerId };
    case "CLOSE_PEEK":
      return state.kind === "peek" ? RESTING : state;
    case "OPEN_ROSTER":
      if (state.kind === "roster" && state.teamId === event.teamId) return RESTING;
      return { kind: "roster", teamId: event.teamId };
    case "COLLAPSE_ALL":
      return RESTING;
  }
}
