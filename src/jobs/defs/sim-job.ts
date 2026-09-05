// THE SIM JOB — one registered job per requested sim run above the sync-run threshold
// (`SIM_CONFIG.syncRunThreshold`, `@/draft-service/sim/config.ts`). One step, deliberately not
// checkpointed into smaller pieces: `simulateDrafts` is pure, in-memory arithmetic with no I/O to
// interrupt, so there is nothing a mid-run checkpoint would resume that a plain retry would not
// already redo correctly (the run is re-derivable byte-for-byte from `sim_runs.config` alone).
//
// TERMINAL VS RETRYABLE: a `sim_runs` row that has vanished (the caller's own client-side abandon)
// or a config the pure sim layer itself refuses (a pool thinner than the draft needs) are both
// refusals no retry fixes — terminal. A DB blip while reading the evidence board or writing the
// summary is ordinary weather — retryable.
import type { Db } from "@/db/client";
import type { JsonObject } from "@/domain/audit";
import { evidencePoolFor } from "@/draft-service/sim/evidence";
import { simulateAllSlots, simulateDrafts } from "@/draft-service/sim/simulate";
import { getSimRun, markSimRunFailed, markSimRunRunning, markSimRunSucceeded } from "@/draft-service/sim/store";
import type { StoredSimSummary } from "@/draft-service/sim/types";
import { defineJob, TerminalJobError, type AnyJobDefinition, type StepOutcome } from "../contract";

export const SIM_JOB_NAME = "sim-run";

export interface SimJobPayload {
  readonly simRunId: string;
}

export function parseSimJobPayload(raw: JsonObject): SimJobPayload {
  const simRunId = raw.simRunId;
  if (typeof simRunId !== "string" || simRunId === "") {
    throw new Error(`sim-run payload: simRunId must be a non-empty string, got ${JSON.stringify(simRunId)}.`);
  }
  return { simRunId };
}

export async function runSimJobStep(db: Db, payload: SimJobPayload): Promise<StepOutcome> {
  const row = await getSimRun(db, payload.simRunId);
  if (row === null) {
    throw new TerminalJobError(`sim-run: no sim_runs row for id ${payload.simRunId}.`);
  }
  if (row.status === "succeeded") {
    return { summary: `sim ${payload.simRunId} already succeeded (idempotent replay).`, detail: [] };
  }

  await markSimRunRunning(db, payload.simRunId);
  // An empty `boardGeneration` means the request-time read found no evidence board at all
  // (`evidencePoolFor`'s own empty-pool return) — there is no real generation stamp to pin to,
  // so this reads "now" instead of feeding `Date` an unparseable empty string. Either way the
  // pool comes back empty and `simulateDrafts` refuses it below, honestly, rather than crashing
  // on a malformed date.
  const asOf = row.boardGeneration === "" ? new Date() : new Date(row.boardGeneration);
  const { pool } = await evidencePoolFor(db, asOf);

  let summary: StoredSimSummary;
  try {
    summary = row.config.slot === "all" ? { bySlot: simulateAllSlots(row.config, pool) } : simulateDrafts({ ...row.config, slot: row.config.slot }, pool);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    await markSimRunFailed(db, payload.simRunId, message);
    throw new TerminalJobError(`sim-run ${payload.simRunId}: ${message}`, { cause: error });
  }

  await markSimRunSucceeded(db, payload.simRunId, summary);
  const flat = "bySlot" in summary ? summary.bySlot : [summary];
  return {
    summary: `sim ${payload.simRunId}: ${flat.map((s) => `slot ${s.slot} (${s.runs} runs, ${s.elapsedMs}ms)`).join("; ")}`,
    detail: flat.flatMap((s) => s.builds.map((build) => `slot ${s.slot} ${build.label}: ${build.runsWithLabel} runs, ${(build.top3FinishRate * 100).toFixed(1)}% top-3`)),
  };
}

export const simJob: AnyJobDefinition = defineJob<SimJobPayload>({
  name: SIM_JOB_NAME,
  maxAttempts: 2,
  // 10,000 runs measures in the tens of seconds on this hardware (Task 1's own benchmark scales
  // linearly with `runs`); this leaves generous headroom above that without letting a wedged run
  // hold a worker forever.
  timeoutMs: 180_000,
  backoff: { baseMs: 5_000, maxMs: 30_000 },
  parsePayload: parseSimJobPayload,
  steps: [{ name: "run", run: (ctx, payload) => runSimJobStep(ctx.db, payload) }],
});
