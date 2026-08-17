/** Every tunable in the draft room. No component or hook may inline one of these. */
export const DRAFT_ROOM_CONFIG = {
  /** How often a countdown re-renders, ms. One second is the smallest unit we display. */
  countdownTickMs: 1_000,
  /** Rows the player pool lists before asking the user to narrow their search. */
  poolPageSize: 60,
  /** How long the pick-landing highlight stays up, ms. */
  celebrationMs: 2_400,
} as const;
