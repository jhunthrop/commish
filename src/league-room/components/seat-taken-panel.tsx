import type { ReactNode } from "react";
import { StatePanel } from "@/components/ui/state-panel";
import { SEAT_HOLD_REFUSALS } from "@/matchmaking/seat-hold";

export interface SeatTakenPanelProps {
  readonly leagueName: string;
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
 * gone. Never a dead end, and never a bare "error" — always the same description
 * `SEAT_HOLD_REFUSALS.taken` names as the join door's own refusal for this exact loss, so the
 * sentence a racer reads here and the reason a direct-link join attempt is refused with can only
 * ever agree.
 */
export function SeatTakenPanel({ leagueName, primaryAction, secondaryAction }: SeatTakenPanelProps) {
  return (
    <StatePanel
      tone="neutral"
      icon="clock"
      title={`${leagueName} filled up`}
      description={SEAT_HOLD_REFUSALS.taken}
      action={
        <div className="flex flex-wrap items-center justify-center gap-4">
          {primaryAction}
          {secondaryAction}
        </div>
      }
    />
  );
}
