import type { TimerExpireAction } from "@/domain/draft";
import { currentDeadline } from "./selectors";
import type { DraftState } from "./state";

/**
 * A TIMER_EXPIRE action timestamped exactly at the state's current deadline — the earliest
 * timestamp the reducer accepts. Test-only helper shared by every suite that drives a draft
 * to completion on simulated expiries, so they all advance the clock the same, correct way
 * instead of each hand-rolling (and potentially mis-timing) their own timestamps. Callers
 * only ever use this against a state with a turn in progress, so a missing deadline is a
 * test-authoring bug — asserted with `!` rather than a runtime branch this suite can't
 * otherwise exercise.
 */
export function expireAt(state: DraftState): TimerExpireAction {
  return { v: 1, type: "TIMER_EXPIRE", timestamp: currentDeadline(state)! };
}
