import { getDb } from "@/db/client";
import { isLLMEnabled, getLlmClient } from "@/lib/llm/client";
import { getPublisher } from "@/lib/realtime/publisher";
import type { PublishFn } from "./store";
import { createNudgeScheduler } from "./nudge";
import { createNudgeCopy } from "./nudge-copy";
import { createDraftStore, type DraftStore } from "./store";
import { createDraftTicker, type DraftTicker } from "./ticker";

/** The outermost edge is the only place a wall clock is allowed. */
const systemClock = { now: () => new Date().toISOString() };

let store: DraftStore | undefined;
let ticker: DraftTicker | undefined;

/**
 * The store's `onPublishError` wiring, extracted to its own name — same reasoning as
 * `publishViaSharedPublisher` in `src/stats-pipeline/index.ts`: a full store failure would
 * otherwise be the only way to reach it, since it only runs when a publish actually fails.
 */
export function logDraftPublishError(error: unknown, event: unknown): void {
  console.error("[draft] publish failed", event, error);
}

/** The ticker's nudger's `onError` wiring, extracted for the same reason. */
export function logDraftNudgeError(error: unknown, context: unknown): void {
  console.error("[draft] nudge failed", context, error);
}

/**
 * Both the store and the nudger publish through the same process-wide publisher; extracted to
 * one named function (rather than an inline arrow at each call site) so this wiring is directly
 * unit-testable — the store's own applied-action tests reach the store's call site, but nothing
 * short of a real nudge firing would ever reach a second, separately-defined inline arrow at
 * the nudger's call site.
 */
export const publishDraftEvent: PublishFn = (input) => getPublisher().publish(input);

export function getDraftStore(): DraftStore {
  if (store === undefined) {
    store = createDraftStore({
      db: getDb(),
      publish: publishDraftEvent,
      clock: systemClock,
      onPublishError: logDraftPublishError,
    });
  }
  return store;
}

/**
 * Task 7's auto-start rides this same ticker rather than a third `setInterval` — see
 * `ticker.ts`'s own `tick()` docblock. Its `autoStart` dependency is left at `createDraftTicker`'s
 * default (the real `autoStartDueDrafts`, `./auto-start`), which needs only `{ store, clock }`:
 * the `draft_auto_started` announcement is fused into `getDraftStore()`'s own `startDraft`
 * transaction (`store.ts`), so it inherits that store's `audit`/`deliverNotice` wiring — already
 * the process-wide logger and publisher, by `createDraftStore`'s own defaults above — with nothing
 * new to wire here.
 */
export function getDraftTicker(): DraftTicker {
  if (ticker === undefined) {
    ticker = createDraftTicker({
      db: getDb(),
      store: getDraftStore(),
      clock: systemClock,
      nudger: createNudgeScheduler({
        db: getDb(),
        publish: publishDraftEvent,
        // `isLLMEnabled()` is read once, here, at the edge — the copy function itself never
        // touches process.env, so tests drive both states by construction.
        copy: createNudgeCopy({ enabled: isLLMEnabled(), llm: getLlmClient() }),
        onError: logDraftNudgeError,
      }),
    });
  }
  return ticker;
}

// Barrel surface: only names actually imported through `@/draft-service` elsewhere in the
// repo. Everything else a submodule exports (types, alternate constructors, etc.) is reached
// by importing that submodule directly. Unlike `src/draft-engine/index.ts` — whose breadth is
// a deliberate coverage device, see `src/draft-engine/index.test.ts` — this barrel is not a
// coverage gate, so it is trimmed to what is actually used.
export { resolveDraftActor, type DraftActor } from "./authz";
export { setTeamQueue, getTeamQueue } from "./queue";
export { setSlotPreference, setSlotPreferenceSchema, SLOT_PREFERENCE_REFUSALS } from "./slot-preference";
