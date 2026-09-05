// THE NIGHTLY ADP SNAPSHOT JOB (Draft HQ phase 2 Task 6) — fires once a night
// (`schedules.ts`'s own cron entry) and captures the current market ADP feed into the
// append-only `adp_snapshots` archive (`@/projections/market/adp-snapshot.ts`).
//
// TERMINAL VS RETRYABLE: everything this job can throw is either the feed's own network/HTTP
// weather (`fetchAverageDraftPosition`'s fetch call) or the feed publishing no board at all for
// this season yet — both are worth retrying (the identical schedule-fire cadence recovers either
// one tomorrow night, and `maxAttempts` covers a same-night blip), so nothing here is classified
// terminal. A season with genuinely nothing published yet dead-letters after its attempts and
// tries again on the next night's fire, which is the correct behavior for "not yet, not never."
import type { Db } from "@/db/client";
import type { JsonObject } from "@/domain/audit";
import { ingestAdpSnapshot } from "@/projections/market/adp-snapshot";
import { defineJob, type AnyJobDefinition, type StepOutcome } from "../contract";

export const ADP_SNAPSHOT_JOB_NAME = "adp-snapshot";

export async function runAdpSnapshotStep(db: Db, clock: { readonly now: () => string }): Promise<StepOutcome> {
  const result = await ingestAdpSnapshot(db, { now: () => new Date(clock.now()) });
  const ratePct = result.resolutionRate === null ? "n/a" : `${(result.resolutionRate * 100).toFixed(1)}%`;
  return {
    summary: `adp-snapshot: ${result.candidatesRead} published, ${result.written} rows written (${ratePct} resolved)`,
    detail: result.written === 0 ? [`no rows written this capture (resolution ${ratePct})`] : [],
  };
}

export const adpSnapshotJob: AnyJobDefinition = defineJob<Record<string, never>>({
  name: ADP_SNAPSHOT_JOB_NAME,
  maxAttempts: 3,
  // A single HTTP fetch plus one batched insert — comfortably short, but generous against a slow
  // upstream night, matching the season-week job's own network-step budget.
  timeoutMs: 60_000,
  backoff: { baseMs: 60_000, maxMs: 10 * 60_000 },
  parsePayload: (): Record<string, never> => ({}),
  steps: [{ name: "capture", run: (ctx) => runAdpSnapshotStep(ctx.db, ctx.clock) }],
});

// Re-exported so `registry.ts` and `schedules.ts` can both name the payload type without a second
// import path, matching `season-week-job.ts`'s own shape (`SeasonWeekPayload`) even though this
// job's payload happens to be empty today.
export type AdpSnapshotPayload = JsonObject;
