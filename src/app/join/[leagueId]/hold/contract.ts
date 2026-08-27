/**
 * TYPES ONLY — the wire shape `POST /join/[leagueId]/hold/confirm` answers with, shared by the
 * route handler and `SeatConfirmPanel` so the two cannot drift (the same "one contract, two
 * consumers" discipline `src/league-room/contract.ts` holds for the rooms proper).
 *
 * A1 (2026-08-27 flow analysis, finding 1 — "a GET request permanently joins you to a league").
 * The hold page's signed-in "return" used to call `returnFromSignIn` — a WRITE — during render:
 * navigating to the URL silently seated a member, no confirm, no exit. The write now runs
 * exactly once, behind this route's own POST, triggered by the visitor's own tap on
 * `SeatConfirmPanel`. `returnFromSignIn` itself (`@/league-service/join`) is untouched — same
 * signature, same three outcomes, same hold/expiry semantics. Only WHEN it runs moved.
 */
export interface SeatConfirmBody {
  /**
   * `"seated"` — `returnFromSignIn` seated this caller, whether by redeeming a live hold, by an
   * ordinary walk-in seat, or because they already had one (redeeming twice is a no-op, never a
   * second row). `"tier_blocked"` — the ONE refusal kept distinct (Task 6 Step 4's own rule): a
   * visitor turned away for who they are, not for bad luck. `"seat_taken"` — every other refusal
   * (the league filled, the hold's own token named nothing real), collapsed into one vocabulary
   * word the same way `returnFromSignIn` already collapses it.
   */
  readonly outcome: "seated" | "tier_blocked" | "seat_taken";
  readonly leagueId: string;
  /** Only meaningful when `outcome === "seated"` — Task 9 Step 2b's own flag, carried straight
   *  through so the redirect after confirm still lands on the SAME just-seated hero a fresh join
   *  always has, hold or no hold. */
  readonly holdExpired: boolean;
  /** The refusal sentence, present only for `"tier_blocked"`/`"seat_taken"` — the exact text
   *  `returnFromSignIn` itself answered with, never re-worded at this boundary. */
  readonly reason: string | null;
}
