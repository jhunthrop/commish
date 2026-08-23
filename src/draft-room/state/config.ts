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
} as const;
