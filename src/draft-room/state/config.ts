/**
 * Every tunable in the draft room. No component or hook may inline one of these.
 *
 * The countdown tick and its coarse-announcement boundaries moved to `UI_CONFIG.countdown`
 * (`@/components/ui/config`) when `Countdown`/`useCountdown` centralized there at their third
 * caller (Phase 3.5, Task 8) — this room shares that one config now rather than keeping its own
 * copy.
 */
export const DRAFT_ROOM_CONFIG = {
  /** Rows the player pool lists before asking the user to narrow their search. */
  poolPageSize: 60,
  /** How long the pick-landing highlight stays up, ms. */
  celebrationMs: 2_400,
  /**
   * `DraftBoard`'s empty-cell border classes, keyed by whether the round is "future" (more than
   * one round past the active one) or "near" (the active round, or the one right after it). A
   * future round recedes by SHAPE ONLY — a slimmer minimum height — never by diluting
   * `border-line`'s own color with an opacity modifier. `line` is already tuned to sit at the
   * decorative-hairline floor (`tokens.ts`, ~1.26:1 against `surface` in the dark theme —
   * `tokens.test.ts`'s "gives an interactive boundary its own role" — deliberately under WCAG
   * 1.4.11's 3:1 because it separates two surfaces, it does not bound a control). Stacking a
   * `border-line/35` opacity modifier on top of a color already that close to the ground pushed
   * it toward true invisibility once the room re-toned onto v3's `#0D0D0F` graphite: rounds 3-15
   * of a live draft board read as a void (founder-reported 2026-08-25). Both classes now carry
   * `border-line` at full strength — the line token's own contrast against `surface` is the
   * floor a future cell's border may never drop below.
   */
  emptyCellBorderClass: {
    future: "min-h-4 border-line",
    near: "min-h-12 border-line",
  },
  /**
   * `PickWire`'s own tunable (2026-08-26 design review, R1): how many of the draft's most
   * recent picks the band shows, newest first. One number, read by both the room's `text-xs`
   * band and the TV's `text-base` one, so a future retune never drifts between the two.
   */
  wire: {
    maxItems: 6,
  },
} as const;
