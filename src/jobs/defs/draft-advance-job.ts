// THE DRAFT ADVANCE JOB (draft-room performance round, item 3): one room's next due work, as one
// queued job due at that work's own instant. The pacer (`@/draft-service/pacing`) enqueues it
// the moment the previous action commits; the self-wake runs it in its own invocation at that
// instant; the job applies the due work through the ONE advance routine every driver uses
// (`advance.ts`: the pick stamped at its due instant, byte-identical whichever driver lands it),
// paces the next, then computes the room's facts for the advisor. Nothing sleeps inside a request
// anybody is waiting on, and nothing depends on a stream being open.
//
// IDEMPOTENT BY THE LOG: the payload names the sequence the room stood at when the job was
// paced. A room that has moved past it (a human's own pick, a catch-up read, a sweep) makes this
// job a quiet no-op — whoever moved the log paced the next job from there — never a second pick.
// A transient failure (the advance reports `error`) retries on a short backoff; a room that is
// gone is a quiet no-op too, since nothing here can bring it back.
import type { JsonObject } from "@/domain/audit";
import type { Clock } from "@/domain/timing";
import type { DraftState } from "@/draft-engine";
import { followThroughRoomFacts, getDraftAdvancer, getDraftPacer, getDraftStore } from "@/draft-service";
import { pickPath } from "@/lib/timing/pick-path";
import type { AdvanceOutcome, DraftAdvancer } from "@/draft-service/advance";
import type { DraftPacer } from "@/draft-service/pacing";
import type { DraftStore } from "@/draft-service/store";
import { defineJob, type AnyJobDefinition, type StepOutcome } from "../contract";

export const DRAFT_ADVANCE_JOB_NAME = "draft-advance";

export interface DraftAdvanceJobPayload {
  readonly draftId: string;
  /** The log sequence the room stood at when this job was paced; any other is superseded. */
  readonly sequence: number;
}

export function parseDraftAdvanceJobPayload(raw: JsonObject): DraftAdvanceJobPayload {
  const { draftId, sequence } = raw;
  if (typeof draftId !== "string" || draftId === "") throw new Error(`draft-advance payload: draftId must be a non-empty string, got ${JSON.stringify(draftId)}.`);
  if (typeof sequence !== "number" || !Number.isInteger(sequence) || sequence < 0) throw new Error(`draft-advance payload: sequence must be a non-negative integer, got ${JSON.stringify(sequence)}.`);
  return { draftId, sequence };
}

export const draftAdvanceIdempotencyKey = (draftId: string, sequence: number): string => `${DRAFT_ADVANCE_JOB_NAME}:${draftId}@${sequence}`;

export interface DraftAdvanceJobDeps {
  readonly store: DraftStore;
  readonly advance: DraftAdvancer["advance"];
  readonly pacer: DraftPacer;
  /** The room's facts for the state the advance produced; owns its own failures. */
  readonly publishFacts: (state: DraftState) => Promise<void>;
  readonly clock: Clock;
}

/** The transient outcome, thrown so the executor retries it on the definition's backoff. */
export class DraftAdvanceTransientError extends Error {
  constructor(draftId: string) {
    super(`draft-advance ${draftId}: the advance reported a transient error; retrying.`);
    this.name = "DraftAdvanceTransientError";
  }
}

function describe(outcome: AdvanceOutcome, paced: string): string {
  return `draft-advance ${outcome.draftId}: applied ${outcome.applied}, now at sequence ${outcome.sequence ?? "?"} (${outcome.phase ?? "gone"}), ${paced}${outcome.wedged ? ", WEDGED" : ""}${outcome.exhausted ? ", exhausted" : ""}`;
}

export async function runDraftAdvanceStep(payload: DraftAdvanceJobPayload, deps: DraftAdvanceJobDeps): Promise<StepOutcome> {
  const { draftId, sequence } = payload;
  const state = await deps.store.getDraftState(draftId);
  if (state === null) return { summary: `draft-advance ${draftId}: the draft is gone; nothing to do.`, detail: [] };
  if (state.sequence !== sequence) {
    // THE CRASH AFTER THE COMMIT (review fix round, finding 2): whoever moved the log normally
    // paced the next job from there, but an invocation that died between its pick's commit and
    // its pacing left nothing queued, and this requeued job is the first thing to notice. Pacing
    // from the room's current state is idempotent by key, so the ordinary case costs one refused
    // enqueue and the crashed case restarts the chain.
    const paced = await deps.pacer.pace(state);
    const line = paced.kind === "scheduled" ? `re-paced: next due ${paced.dueAt} (job ${paced.jobId})` : paced.kind === "already-scheduled" ? "the chain is queued" : "nothing due";
    return { summary: `draft-advance ${draftId}: superseded, the room stands at sequence ${state.sequence} (paced at ${sequence}); ${line}.`, detail: [] };
  }
  // The store's own follow-through is off for this call: the job paces and publishes itself,
  // in that order, so the next pick's wake is on its way before the facts compute begins.
  const outcome = await pickPath.time("job.advance", () => deps.advance(draftId, deps.clock.now(), { followThrough: false }), (result) => ({ draftId, applied: result.applied, sequence: result.sequence, pacedAt: sequence }));
  if (outcome.outcome === "error") throw new DraftAdvanceTransientError(draftId);
  const paced = await deps.pacer.paceFromOutcome(outcome);
  const pacedLine = paced.kind === "scheduled" ? `next due ${paced.dueAt} (job ${paced.jobId}${paced.retired > 0 ? `, ${paced.retired} retired` : ""})` : paced.kind === "already-scheduled" ? `next due ${paced.dueAt} (already queued)` : "nothing due";
  if (outcome.applied > 0 && outcome.phase === "in_progress") {
    const fresh = await deps.store.getDraftState(draftId);
    if (fresh !== null) await deps.publishFacts(fresh);
  }
  return { summary: describe(outcome, pacedLine), detail: [] };
}

/** The definition, over a lazily-resolved edge: the process-wide store, advancer and pacer live in
 *  `@/draft-service`, which this module must not import at load (it imports this one). */
export function defineDraftAdvanceJob(resolve: () => DraftAdvanceJobDeps): AnyJobDefinition {
  return defineJob<DraftAdvanceJobPayload>({
    name: DRAFT_ADVANCE_JOB_NAME,
    /** Three attempts cover a dropped connection; the room itself refuses nothing that a retry fixes. */
    maxAttempts: 3,
    /** One state load, the due work, one publish, one pace, one facts compute: seconds. */
    timeoutMs: 20_000,
    backoff: { baseMs: 1_000, maxMs: 5_000 },
    parsePayload: parseDraftAdvanceJobPayload,
    steps: [{ name: "advance", run: (_ctx, payload) => runDraftAdvanceStep(payload, resolve()) }],
  });
}

/** The registered definition over the process-wide edge, resolved per run (never at import: the
 *  edge module imports this one for the job's name and key, the same live-binding cycle the
 *  sweep job already rides through `@/draft-service`). */
export const draftAdvanceJob: AnyJobDefinition = defineDraftAdvanceJob(() => ({
  store: getDraftStore(),
  advance: (draftId, now, opts) => getDraftAdvancer().advance(draftId, now, opts),
  pacer: getDraftPacer(),
  publishFacts: followThroughRoomFacts,
  clock: { now: () => new Date().toISOString() },
}));
