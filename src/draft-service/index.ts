import { getDb } from "@/db/client";
import { isLLMEnabled, getLlmClient } from "@/lib/llm/client";
import { getPublisher } from "@/lib/realtime/publisher";
import { createNudgeScheduler } from "./nudge";
import { createNudgeCopy } from "./nudge-copy";
import { createDraftStore, type DraftStore } from "./store";
import { createDraftTicker, type DraftTicker } from "./ticker";

/** The outermost edge is the only place a wall clock is allowed. */
const systemClock = { now: () => new Date().toISOString() };

let store: DraftStore | undefined;
let ticker: DraftTicker | undefined;

export function getDraftStore(): DraftStore {
  if (store === undefined) {
    store = createDraftStore({
      db: getDb(),
      publish: (input) => getPublisher().publish(input),
      clock: systemClock,
      onPublishError: (error, event) => console.error("[draft] publish failed", event, error),
    });
  }
  return store;
}

export function getDraftTicker(): DraftTicker {
  if (ticker === undefined) {
    ticker = createDraftTicker({
      db: getDb(),
      store: getDraftStore(),
      clock: systemClock,
      nudger: createNudgeScheduler({
        db: getDb(),
        publish: (input) => getPublisher().publish(input),
        // `isLLMEnabled()` is read once, here, at the edge — the copy function itself never
        // touches process.env, so tests drive both states by construction.
        copy: createNudgeCopy({ enabled: isLLMEnabled(), llm: getLlmClient() }),
        onError: (error, context) => console.error("[draft] nudge failed", context, error),
      }),
    });
  }
  return ticker;
}

export { resolveDraftActor, type DraftActor, type ActorResult } from "./authz";
export type { ApplyResult, CommitResult, DraftStore } from "./store";
export type { DraftTicker, TickOutcome } from "./ticker";
export { setTeamQueue, getTeamQueue, type QueueDeps, type QueueResult, type SetQueueInput } from "./queue";
export { createNudgeScheduler, NO_OP_NUDGE_SCHEDULER, type NudgeScheduler, type NudgeOutcome } from "./nudge";
export { createNudgeCopy, staticNudge, type NudgeCopyFn, type NudgeCopyInput } from "./nudge-copy";
