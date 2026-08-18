/** Every tunable in the draft room. No component or hook may inline one of these. */
export const DRAFT_ROOM_CONFIG = {
  /** How often a countdown re-renders, ms. One second is the smallest unit we display. */
  countdownTickMs: 1_000,
  /** Rows the player pool lists before asking the user to narrow their search. */
  poolPageSize: 60,
  /** How long the pick-landing highlight stays up, ms. */
  celebrationMs: 2_400,
  /**
   * Below this, `formatCoarseRemaining`'s screen-reader announcement reads "Under a minute
   * left" rather than a minute count.
   */
  coarseRemainingMinuteMs: 60_000,
  /**
   * At or above this, `formatCoarseRemaining` rounds to the nearest hour instead of the
   * nearest minute — deliberately coarser than `Countdown`'s ticking digits, so the
   * `aria-live` region built on it changes on a boundary crossing, not every second.
   */
  coarseRemainingHourMs: 3_600_000,
} as const;
