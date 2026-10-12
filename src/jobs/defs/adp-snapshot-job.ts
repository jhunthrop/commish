// THE NIGHTLY ADP SNAPSHOT JOB (Draft HQ phase 2 Task 6) — fires once a night
// (`schedules.ts`'s own cron entry) and captures the current ADP feed, in all three scoring
// formats (`ADP_SNAPSHOT_REQUESTS_PER_FIRE` upstream requests a night, three, since the
// scoring-formats round), into the append-only `adp_snapshots` archive
// (`@research/projections/market/adp-snapshot`).
//
// TERMINAL VS RETRYABLE: everything this job can throw is either the feed's own network/HTTP
// weather (`fetchAverageDraftPosition`'s fetch call) or the feed publishing no board at all for
// this season yet — both are worth retrying (the identical schedule-fire cadence recovers either
// one tomorrow night, and `maxAttempts` covers a same-night blip), so nothing here is classified
// terminal. A season with genuinely nothing published yet dead-letters after its attempts and
// tries again on the next night's fire, which is the correct behavior for "not yet, not never."
// Only the PPR capture's failure throws (`ingestAdpSnapshot`'s own docblock); a secondary format
// that fails is named in the detail lines and the fire still lands its PPR rows.
import type { Db } from "@research/db/client";
import type { JsonObject } from "@research/domain/json";
import { ingestAdpSnapshot } from "@research/projections/market/adp-snapshot";
import { defineJob, type AnyJobDefinition, type StepOutcome } from "../contract";

export const ADP_SNAPSHOT_JOB_NAME = "adp-snapshot";

export interface AdpSnapshotPayload {
  /**
   * Fix round 1, MEDIUM 2 — the schedule's own fire instant (`schedule.ts`'s `tickOne`, which
   * merges `firedAt` onto every schedule-born job's payload), reached here so `capturedAt` is
   * DERIVED from it rather than from wall-clock `Date.now()` at attempt time. Optional because a
   * hand-enqueued run (an operator re-run, or a future test) carries no schedule fire; those fall
   * back to the injected clock.
   */
  readonly firedAt?: string;
}

export function parseAdpSnapshotPayload(raw: JsonObject): AdpSnapshotPayload {
  const firedAt = raw.firedAt;
  if (firedAt === undefined) return {};
  if (typeof firedAt !== "string" || Number.isNaN(Date.parse(firedAt))) {
    throw new Error(`adp-snapshot payload: firedAt must be an ISO instant string, got ${JSON.stringify(firedAt)}.`);
  }
  return { firedAt };
}

function ratePercent(rate: number | null): string {
  return rate === null ? "n/a" : `${(rate * 100).toFixed(1)}%`;
}

export async function runAdpSnapshotStep(db: Db, clock: { readonly now: () => string }, payload: AdpSnapshotPayload): Promise<StepOutcome> {
  const now = payload.firedAt !== undefined ? () => new Date(payload.firedAt!) : () => new Date(clock.now());
  const result = await ingestAdpSnapshot(db, { now });
  const ratePct = ratePercent(result.resolutionRate);
  // One line per format (the scoring-formats round): a night where the half-PPR feed came back
  // empty and the PPR feed did not is visible here, not folded into one pooled count.
  const perFormat = result.byFormat.map((entry) =>
    entry.error === null
      ? `${entry.format}: ${entry.candidatesRead} published, ${entry.written} written (${ratePercent(entry.resolutionRate)})`
      : `${entry.format}: FAILED (${entry.error})`,
  );
  const landed = result.byFormat.filter((entry) => entry.error === null).map((entry) => entry.format);
  const failed = result.byFormat.filter((entry) => entry.error !== null).map((entry) => entry.format);
  return {
    summary:
      `adp-snapshot: ${result.candidatesRead} published, ${result.written} rows written (${ratePct} resolved); ` +
      `landed ${landed.join(", ") || "none"}${failed.length > 0 ? `, failed ${failed.join(", ")}` : ""}`,
    detail: [...perFormat, ...(result.written === 0 ? [`no rows written this capture (resolution ${ratePct})`] : [])],
  };
}

export const adpSnapshotJob: AnyJobDefinition = defineJob<AdpSnapshotPayload>({
  name: ADP_SNAPSHOT_JOB_NAME,
  maxAttempts: 3,
  // Three HTTP fetches (one per format) plus one batched insert each — comfortably short, but
  // generous against a slow upstream night, matching the season-week job's own network-step budget.
  timeoutMs: 60_000,
  backoff: { baseMs: 60_000, maxMs: 10 * 60_000 },
  parsePayload: parseAdpSnapshotPayload,
  steps: [{ name: "capture", run: (ctx, payload) => runAdpSnapshotStep(ctx.db, ctx.clock, payload) }],
});
