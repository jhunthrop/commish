import { getDb } from "@research-ts/db/client";
import type { DraftState } from "@/draft-engine";
import { runAfterResponse } from "@/lib/api/after-response";
import { isLLMEnabled, getLlmClient } from "@/lib/llm/client";
import { getPublisher } from "@/lib/realtime/publisher";
import { getResyncMarker } from "@/lib/realtime/resync";
import type { PublishFailureEvent, PublishFn } from "./store";
import { createMockBotDriver, type MockBotDriver } from "@/mock-draft-service/driver";
import { createDraftAdvancer, type DraftAdvancer } from "./advance";
import { publishRoomFacts } from "./assistant/service";
import { createNudgeScheduler, type NudgeScheduler } from "./nudge";
import { createNudgeCopy } from "./nudge-copy";
import { createDraftStore, type DraftStore } from "./store";

/** The outermost edge is the only place a wall clock is allowed. */
const systemClock = { now: () => new Date().toISOString() };

let store: DraftStore | undefined;
let mockDriver: MockBotDriver | undefined;
let advancer: DraftAdvancer | undefined;
let nudger: NudgeScheduler | undefined;

/**
 * The store's `onPublishError` wiring, extracted to its own name — same reasoning as
 * `publishViaSharedPublisher` in `src/stats-pipeline/index.ts`: a full store failure would
 * otherwise be the only way to reach it, since it only runs when a publish actually fails.
 */
export function logDraftPublishError(error: unknown, event: unknown): void {
  console.error("[draft] publish failed", event, error);
}

/**
 * THE LOST VOICE (review finding 3): a frame that failed to publish is logged AND the draft is
 * marked for resync (`@/lib/realtime/resync`), so every open stream on the league relays a
 * `draft.resync` on its next keepalive and the viewers catch up within one. The mark is
 * best-effort over the same Redis that just refused the publish; when it fails too, the
 * viewers' own planned reconnect is the fallback, as it always was.
 */
export function noteDraftPublishFailure(error: unknown, event: PublishFailureEvent): void {
  logDraftPublishError(error, { type: event.type, leagueId: event.leagueId, draftId: event.draftId });
  void getResyncMarker().mark(event.draftId);
}

/** The nudger's `onError` wiring, extracted for the same reason. */
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

/**
 * THE COMMIT'S FOLLOW-THROUGH (draft-room performance round, item 1; the batched bots round,
 * 2026-09-25): what every accepted commit owes once it has committed, run on the invocation that
 * made it, after its response has gone (`runAfterResponse`), never before the writer's own
 * answer. The room's facts for the new state — for a mock, the post-batch state the next human
 * faces — computed once and written to the draft's own row, so the viewers' `/assistant`
 * requests read instead of simulate and the dock has its answer when her turn is revealed. Owns
 * its own failure: a compute that fails costs the next viewer a single-flight compute on the
 * request path, exactly what a miss always cost.
 */
export async function followThroughAppliedAction(state: DraftState): Promise<void> {
  let ready = true;
  try {
    await publishRoomFacts(getDb(), state);
  } catch (error: unknown) {
    ready = false;
    console.error("[draft] room facts follow-through failed", { draftId: state.config.draftId, sequence: state.sequence }, error);
  }
  // THE FACTS FRAME (review M5): the viewers' advisors wait for this before asking, so the one
  // simulator is this invocation's. A running room only; a finished one has nothing to advise.
  if (state.phase !== "in_progress") return;
  await publishDraftEvent({ leagueId: state.config.leagueId, type: "draft.facts", payload: { draftId: state.config.draftId, sequence: state.sequence, ready } });
}

/** The follow-throughs in flight, chained so a test can settle the last one (`awaitDraftFollowThroughForTests`). */
let followThroughTail: Promise<void> = Promise.resolve();

function scheduleFollowThrough(state: DraftState): void {
  runAfterResponse(() => {
    followThroughTail = followThroughTail.then(() => followThroughAppliedAction(state));
    return followThroughTail;
  });
}

/** Test seam only: settles every follow-through the store's hook has scheduled so far. */
export function awaitDraftFollowThroughForTests(): Promise<void> {
  return followThroughTail;
}

/**
 * The process-wide store. Its bot policy is the process-wide driver's `botTurn` (resolved per
 * call, so the two singletons need no construction order): inside the commit that lands any
 * accepted action on a mock, the store runs every consecutive bot seat forward and appends their
 * picks to the same commit (`DraftStoreDeps.botTurn`).
 */
export function getDraftStore(): DraftStore {
  if (store === undefined) {
    store = createDraftStore({
      db: getDb(),
      publish: publishDraftEvent,
      clock: systemClock,
      onPublishError: noteDraftPublishFailure,
      afterApplied: scheduleFollowThrough,
      botTurn: (state) => getMockBotDriver().botTurn(state),
    });
  }
  return store;
}

/**
 * The process-wide bot driver — ONE instance, shared by the store's batch and the advance
 * funnel, so there is a single per-draft meta cache and the retention sweep's `invalidateDraft`
 * wiring (through the sweep job) empties it for both callers.
 */
export function getMockBotDriver(): MockBotDriver {
  if (mockDriver === undefined) {
    mockDriver = createMockBotDriver({ db: getDb() });
  }
  return mockDriver;
}

/**
 * The ONE moderator instance the advancer's drivers share — a single `isBot` cache and one
 * LLM-copy wiring, and the `draft_nudges` claim row already makes a nudge once-per-pick across
 * any number of instances regardless.
 */
function getNudgeScheduler(): NudgeScheduler {
  if (nudger === undefined) {
    nudger = createNudgeScheduler({
      db: getDb(),
      publish: publishDraftEvent,
      // `isLLMEnabled()` is read once, here, at the edge — the copy function itself never
      // touches process.env, so tests drive both states by construction.
      copy: createNudgeCopy({ enabled: isLLMEnabled(), llm: getLlmClient() }),
      onError: logDraftNudgeError,
    });
  }
  return nudger;
}

/**
 * The process-wide advance funnel (draft-driver design, 2026-09-03) — the routine every driver
 * calls: advance-on-read and the `draft-sweep` job. Wired over the SAME store, bot driver and
 * moderator, so every host advances drafts through one implementation.
 */
export function getDraftAdvancer(): DraftAdvancer {
  if (advancer === undefined) {
    advancer = createDraftAdvancer({
      db: getDb(),
      store: getDraftStore(),
      mockDriver: getMockBotDriver(),
      nudger: getNudgeScheduler(),
    });
  }
  return advancer;
}

/**
 * ADVANCE-ON-READ (driver 1): applied by every authenticated draft read before it loads state,
 * so a room someone reopens fast-forwards to the true present — deferred starts, due expiries
 * and any bot still on a committed clock included. Never throws (`DraftAdvancer.advance`'s own
 * contract): a broken advance must never fail the read that triggered it.
 */
export async function advanceDraftNow(draftId: string): Promise<void> {
  await getDraftAdvancer().advance(draftId, systemClock.now());
}

// Barrel surface: only names actually imported through `@/draft-service` elsewhere in the
// repo. Everything else a submodule exports (types, alternate constructors, etc.) is reached
// by importing that submodule directly. Unlike `src/draft-engine/index.ts` — whose breadth is
// a deliberate coverage device, see `src/draft-engine/index.test.ts` — this barrel is not a
// coverage gate, so it is trimmed to what is actually used.
export { resolveDraftActor, type DraftActor } from "./authz";
export { setTeamQueue, getTeamQueue } from "./queue";
export { setSlotPreference, setSlotPreferenceSchema, SLOT_PREFERENCE_REFUSALS } from "./slot-preference";
