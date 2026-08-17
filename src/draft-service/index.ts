import { getDb } from "@/db/client";
import { getPublisher } from "@/lib/realtime/publisher";
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
    });
  }
  return store;
}

export function getDraftTicker(): DraftTicker {
  if (ticker === undefined) {
    ticker = createDraftTicker({ db: getDb(), store: getDraftStore(), clock: systemClock });
  }
  return ticker;
}

export { resolveDraftActor, type DraftActor, type ActorResult } from "./authz";
export type { ApplyResult, CommitResult, DraftStore } from "./store";
export type { DraftTicker, TickOutcome } from "./ticker";
