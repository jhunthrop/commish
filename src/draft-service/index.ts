import { getDb } from "@/db/client";
import type { DraftState } from "@/draft-engine";
import { runAfterResponse } from "@/lib/api/after-response";
import { isLLMEnabled, getLlmClient } from "@/lib/llm/client";
import { getPublisher } from "@/lib/realtime/publisher";
import type { PublishFn } from "./store";
import { createMockBotDriver, type MockBotDriver } from "@/mock-draft-service/driver";
import { createDraftAdvancer, draftLoopTarget, runDraftAdvanceLoop, type AdvanceLoopHandle, type DraftAdvancer } from "./advance";
import { publishRoomFacts } from "./assistant/service";
import { createNudgeScheduler, type NudgeScheduler } from "./nudge";
import { createNudgeCopy } from "./nudge-copy";
import { createDraftStore, type DraftStore } from "./store";
import { createDraftTicker, type DraftTicker } from "./ticker";

/** The outermost edge is the only place a wall clock is allowed. */
const systemClock = { now: () => new Date().toISOString() };

let store: DraftStore | undefined;
let ticker: DraftTicker | undefined;
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

/**
 * THE PICK'S FOLLOW-THROUGH (draft-room performance round, item 1): what every accepted action
 * owes once it has committed — the room's facts for the new state, so the viewers' `/assistant`
 * requests read instead of simulate — run on the invocation that made it, after its response has
 * gone (`runAfterResponse`), never before the writer's own answer and never on the stream's
 * process (whose advance loop opts out per call). Owns its failure: a compute that fails costs
 * the next viewer a single-flight compute on the request path, exactly what a miss always cost.
 */
export async function followThroughAppliedAction(state: DraftState): Promise<void> {
  try {
    await publishRoomFacts(getDb(), state);
  } catch (error: unknown) {
    console.error("[draft] room facts follow-through failed", { draftId: state.config.draftId, sequence: state.sequence }, error);
  }
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

export function getDraftStore(): DraftStore {
  if (store === undefined) {
    store = createDraftStore({
      db: getDb(),
      publish: publishDraftEvent,
      clock: systemClock,
      onPublishError: logDraftPublishError,
      afterApplied: scheduleFollowThrough,
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
/**
 * The process-wide bot driver — ONE instance, shared by the ticker's own drive lane and the
 * advance funnel below, so there is a single per-draft meta cache and the retention sweep's
 * `invalidateDraft` wiring (through the ticker) empties it for both callers.
 */
function getMockBotDriver(): MockBotDriver {
  if (mockDriver === undefined) {
    mockDriver = createMockBotDriver({ db: getDb(), store: getDraftStore() });
  }
  return mockDriver;
}

/**
 * The ONE moderator instance the ticker (dev) and the advancer (the serverless drivers) share —
 * a single `isBot` cache and one LLM-copy wiring, and the `draft_nudges` claim row already makes
 * a nudge once-per-pick across any number of instances regardless.
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

export function getDraftTicker(): DraftTicker {
  if (ticker === undefined) {
    ticker = createDraftTicker({
      db: getDb(),
      store: getDraftStore(),
      clock: systemClock,
      mockDriver: getMockBotDriver(),
      nudger: getNudgeScheduler(),
    });
  }
  return ticker;
}

/**
 * The process-wide advance funnel (draft-driver design, 2026-09-03) — the routine every
 * serverless driver calls: advance-on-read, the SSE watcher loop, and the `draft-sweep` job.
 * Wired over the SAME store, bot driver and moderator the ticker uses, so dev (where the ticker
 * also runs) and Vercel (where it does not) advance drafts through one implementation.
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
 * and due bot picks included. Never throws (`DraftAdvancer.advance`'s own contract): a broken
 * advance must never fail the read that triggered it.
 */
export async function advanceDraftNow(draftId: string): Promise<void> {
  await getDraftAdvancer().advance(draftId, systemClock.now());
}

/**
 * THE SSE STREAM'S TICK (driver 2): called by the league events route as it accepts a
 * connection. Resolves the league's draft and — while it still has work to ever do — runs the
 * advance loop until the client disconnects or the draft completes, handing back the handle the
 * route wakes with each draft frame it relays. Never-throwing for the same reason
 * `advanceDraftNow` is: the stream must open regardless; `null` means no loop runs.
 *
 * THE STREAM RELAYS ONLY (draft-room performance round, item 1). The 2026-09-08 advisor warm used
 * to ride this loop's `onSequence`: 600 to 1100 ms of synchronous simulation on the very event
 * loop that paces the bots and relays their frames, which is what the founder saw as a hang and
 * then two picks at once (the round's ledger). Nothing hangs off the loop now, and the actions it
 * applies opt out of the store's follow-through: the facts are the pick's own invocation's
 * business elsewhere, and a bot pick this loop lands leaves its facts to the viewer's request.
 */
export async function startDraftAdvanceLoopForLeague(leagueId: string, signal: AbortSignal): Promise<AdvanceLoopHandle | null> {
  try {
    // `draftLoopTarget` owns the terminal-status and distant-kickoff gates, so this wrapper
    // stays pure wiring.
    const draftId = await draftLoopTarget(getDb(), leagueId, systemClock.now());
    if (draftId === null) return null;
    return runDraftAdvanceLoop(draftId, signal, { advance: (id, now) => getDraftAdvancer().advance(id, now, { followThrough: false }), clock: systemClock });
  } catch (error: unknown) {
    console.error("[draft] could not start the stream's advance loop", { leagueId }, error);
    return null;
  }
}

// Barrel surface: only names actually imported through `@/draft-service` elsewhere in the
// repo. Everything else a submodule exports (types, alternate constructors, etc.) is reached
// by importing that submodule directly. Unlike `src/draft-engine/index.ts` — whose breadth is
// a deliberate coverage device, see `src/draft-engine/index.test.ts` — this barrel is not a
// coverage gate, so it is trimmed to what is actually used.
export { resolveDraftActor, type DraftActor } from "./authz";
export { setTeamQueue, getTeamQueue } from "./queue";
export { setSlotPreference, setSlotPreferenceSchema, SLOT_PREFERENCE_REFUSALS } from "./slot-preference";
