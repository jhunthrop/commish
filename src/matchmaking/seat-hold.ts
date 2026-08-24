export { SEAT_HOLD } from "./config";

/**
 * The hold cookie's own name — the ONE constant `POST /api/public/leagues/[leagueId]/hold`
 * (which sets it) and `/join/[leagueId]/hold`'s page (which reads it back on "the return", Task 6
 * Step 4) both import, so the writer and the reader can never drift onto two different names.
 */
export const SEAT_HOLD_COOKIE = "seat_hold";

/**
 * Every sentence a seat hold's own mechanism can produce, in one place, so `claimSeatHold`,
 * `consumeSeatHoldInTx` and `returnFromSignIn` (`@/league-service/join.ts` and
 * `@/league-service/seat-hold.ts`) never hand-type a copy of the other's refusal — the identical
 * discipline `ENFORCEMENT_REFUSALS` (`@/league-service/enforcement`) already holds for tier
 * segregation. `taken` doubles as `SeatTakenPanel`'s own description
 * (`@/league-room/components/seat-taken-panel.tsx`), so the sentence a racer reads on the panel
 * and the reason a refused join carries are the SAME string, never two phrasings of one loss.
 *
 * PURE, browser-safe: this module carries no I/O, matching `src/matchmaking/filter.ts`'s own
 * "browser-safe" rule, so `src/league-room/**` may value-import it despite the client-boundary
 * rule that otherwise bans reaching into a service module.
 */
export const SEAT_HOLD_REFUSALS = {
  /** `claimSeatHold`'s own refusal: no seat is free to hold, counting live holds as taken. */
  noSeat: "That league is already full.",
  /** A racer who arrives (with no hold, or someone else's) to find the last seat spoken for —
   *  by a real member or by a live hold, `SeatTakenPanel`'s own moment. */
  taken: "That seat went to someone else while you were signing in. Your spot in this league is gone, and nothing was charged.",
  /** A token that already seated somebody. One token cannot seat two people. */
  spent: "That hold has already been used to join this league.",
  /** A token whose ten minutes ran out. Never shown verbatim to a visitor by itself — the return
   *  flow (`returnFromSignIn`) catches this internally and, if a seat is still open, seats the
   *  visitor anyway and says so in its own words (Task 6 Step 4, outcome b). */
  expired: "That hold has run out.",
} as const;
