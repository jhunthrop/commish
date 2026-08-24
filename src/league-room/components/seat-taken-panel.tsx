import type { ReactNode } from "react";
import { StatePanel } from "@/components/ui/state-panel";
import { SEAT_HOLD_REFUSALS } from "@/matchmaking/seat-hold";

/**
 * Fix round 1 (Task 20 review, MEDIUM — controller ruling). F15's one-component mandate stays:
 * this stays the ONE panel a lost seat renders through, never a second hand-written screen. But
 * "that seat went to someone else while you were signing in" and "nothing was charged" are
 * SPECIFIC claims about the shelf's own seat-hold race — false for an invite whose league's
 * draft started, since the invite path takes no hold at all (`InviteLanding`'s own docblock) and
 * a started draft is a SCHEDULE outcome, not a capacity race. `reason` selects which true thing
 * this panel says; the shape (icon, actions-as-props, `data-testid`) stays identical either way.
 */
export type SeatTakenReason = "seat-taken" | "draft-started";

/**
 * One copy per reason, colocated rather than inlined in JSX so a future third reason has exactly
 * one place to add itself. `"seat-taken"` is the shelf's own race-loss wording, unchanged byte
 * for byte (`SEAT_HOLD_REFUSALS.taken`, already the join door's own refusal for the same loss).
 * `"draft-started"` states what is actually true for an invite whose league moved on without a
 * hold ever existing: the room filled, the draft is already running, and the way forward is the
 * same shelf the actions below already point at.
 */
const SEAT_TAKEN_COPY: Readonly<Record<SeatTakenReason, { readonly title: (leagueName: string) => string; readonly description: string }>> = {
  "seat-taken": {
    title: (leagueName) => `${leagueName} filled up`,
    description: SEAT_HOLD_REFUSALS.taken,
  },
  "draft-started": {
    title: (leagueName) => `${leagueName} already started its draft`,
    description: "This league's roster filled and its draft is already underway. Browse open leagues to find one still taking players.",
  },
};

export interface SeatTakenPanelProps {
  readonly leagueName: string;
  /**
   * Which true thing this panel says. Defaults to `"seat-taken"` so every existing caller (the
   * shelf's own hold interstitial, and `InviteLanding`'s `league-full` state, which IS a capacity
   * outcome) renders exactly as before, untouched.
   */
  readonly reason?: SeatTakenReason;
  /**
   * The two real actions, AS PROPS rather than a link this panel builds itself (Task 6 Step 4,
   * F15). This panel does not know — and must not decide — where "somewhere else" is: Task 6's own
   * caller (the hold interstitial's return flow) sends a race loser to this league's next open
   * edition and to the shelf filtered to leagues closest to filling; the addendum's Task 20 renders
   * this SAME panel for an invited friend whose league filled first, and that person is owed
   * different destinations, not a second panel that says the same thing worse.
   */
  readonly primaryAction: ReactNode;
  readonly secondaryAction: ReactNode;
}

/**
 * The race loser (Task 6 Step 4): a visitor who signed in to find their held or hoped-for seat
 * gone. Never a dead end, and never a bare "error" — always a description this component KNOWS
 * to be true (`SEAT_TAKEN_COPY`, above), so the sentence a visitor reads here and the reason a
 * direct-link join attempt would be refused with can only ever agree — for `"seat-taken"`, the
 * same `SEAT_HOLD_REFUSALS.taken` the join door itself refuses with.
 */
export function SeatTakenPanel({ leagueName, reason = "seat-taken", primaryAction, secondaryAction }: SeatTakenPanelProps) {
  const copy = SEAT_TAKEN_COPY[reason];
  return (
    // `data-testid`, not a role or a class: Task 20's invite landing renders this SAME component
    // for a private league's invitee and needs to prove it is THIS panel, not a hand-written
    // lookalike (F15) — a test id is the one hook that asserts identity without asserting layout.
    <div data-testid="seat-taken-panel">
      <StatePanel
        tone="neutral"
        icon="clock"
        title={copy.title(leagueName)}
        description={copy.description}
        action={
          <div className="flex flex-wrap items-center justify-center gap-4">
            {primaryAction}
            {secondaryAction}
          </div>
        }
      />
    </div>
  );
}
