import type { DraftAction } from "@/domain/draft";
import { initialDraftState, type DraftConfig, type DraftState } from "./state";
import { reduceDraft } from "./reduce";

/** A persisted action that no longer applies — corruption, not a user error. Fail loudly. */
export class DraftReplayError extends Error {
  readonly sequence: number;
  constructor(sequence: number, reason: string) {
    super(`Draft action ${sequence} could not be replayed: ${reason}`);
    this.name = "DraftReplayError";
    this.sequence = sequence;
  }
}

/**
 * Rebuilds draft state from the persisted action log. This — not any cache — is what makes
 * the durable store recoverable: the log is the source of truth and this is the only way to
 * turn it back into state. The local accumulator is reassigned; no input is mutated.
 */
export function replayDraft(config: DraftConfig, actions: readonly DraftAction[]): DraftState {
  let state = initialDraftState(config);
  for (const action of actions) {
    const result = reduceDraft(state, action);
    if (!result.ok) throw new DraftReplayError(state.sequence + 1, result.reason);
    state = result.state;
  }
  return state;
}
