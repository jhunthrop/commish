import { DRAFT_ACTION_VERSION, type DraftAction, type TimerExpireAction } from "@/domain/draft";
import { admitCommand } from "./admit";
import { reduceDraft } from "./reduce";
import { currentDeadline } from "./selectors";
import type { DraftReduceResult, DraftState } from "./state";

/**
 * The whole command path, exactly as `store.applyAction` composes it: admit first, then
 * reduce. Test-only. A suite asserting "the engine rejects X" should exercise the same
 * composition production does, rather than half of it — the split between `admit.ts` and
 * `reduce.ts` is an implementation detail of *where* a guard lives, not of what a submitted
 * command does.
 */
export function submitCommand(state: DraftState, action: DraftAction): DraftReduceResult {
  const admitted = admitCommand(state, action);
  if (!admitted.ok) return admitted;
  return reduceDraft(state, action);
}

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
  return { v: DRAFT_ACTION_VERSION, type: "TIMER_EXPIRE", timestamp: currentDeadline(state)! };
}
