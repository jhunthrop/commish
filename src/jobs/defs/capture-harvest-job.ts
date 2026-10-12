// THE CAPTURE HARVEST AS A LEAGUE-APP JOB. The harvest itself is the research core's
// (`@/projections/harvest`, which documents the feed selection and the budget); this binding owns
// the payload, the terminal classification of a missing provider key, and the peek-document
// rebuild for every player the harvest says moved (peek document design §3.4, row four).
import type { Db } from "@/db/client";
import type { JsonObject } from "@/domain/json";
import type { Clock } from "@/domain/timing";
import { harvestCaptures, MissingProviderKeyError, type CaptureHarvestDeps, type CaptureHarvestPayload, type HarvestReport } from "@/projections/harvest";
import { defineJob, TerminalJobError, type AnyJobDefinition, type StepOutcome } from "../contract";
import { enqueuePeekDocumentRebuildsQuietly } from "./peek-document-job";

export const CAPTURE_HARVEST_JOB_NAME = "capture-harvest";

export function parseCaptureHarvestPayload(raw: JsonObject): CaptureHarvestPayload {
  const firedAt = raw.firedAt;
  if (firedAt === undefined) return {};
  if (typeof firedAt !== "string" || Number.isNaN(Date.parse(firedAt))) {
    throw new Error(`capture-harvest payload: firedAt must be an ISO instant string, got ${JSON.stringify(firedAt)}.`);
  }
  return { firedAt };
}

async function harvestOrTerminal(db: Db, clock: Clock, payload: CaptureHarvestPayload, deps: CaptureHarvestDeps): Promise<HarvestReport> {
  try {
    return await harvestCaptures(db, clock, payload, deps);
  } catch (error) {
    // TERMINAL, not retryable: the same env var is read on every attempt.
    if (error instanceof MissingProviderKeyError) throw new TerminalJobError(error.message);
    throw error;
  }
}

export async function runCaptureHarvestStep(db: Db, clock: Clock, payload: CaptureHarvestPayload, deps: CaptureHarvestDeps = {}): Promise<StepOutcome> {
  const report = await harvestOrTerminal(db, clock, payload, deps);
  // The capture instant is the reason stamp, so a retried attempt that captured nothing new
  // coalesces onto the same job.
  const enqueued =
    report.moved.length === 0
      ? 0
      : await enqueuePeekDocumentRebuildsQuietly(db, clock, { playerIds: report.moved, reason: `harvest:${report.capturedAt}` });
  const moved = report.moved.length;
  return {
    summary: `${report.summary}. Peek documents: ${moved} player${moved === 1 ? "" : "s"} moved, ${enqueued} rebuild${enqueued === 1 ? "" : "s"} enqueued`,
    detail: report.detail,
  };
}

export const captureHarvestJob: AnyJobDefinition = defineJob<CaptureHarvestPayload>({
  name: CAPTURE_HARVEST_JOB_NAME,
  maxAttempts: 3,
  // Up to 5 sequential upstream requests plus a handful of DB reads/writes — generous headroom
  // against a slow upstream night, matching the ADP snapshot job's single-fetch-class budget.
  timeoutMs: 90_000,
  backoff: { baseMs: 60_000, maxMs: 10 * 60_000 },
  parsePayload: parseCaptureHarvestPayload,
  steps: [{ name: "harvest", run: (ctx, payload) => runCaptureHarvestStep(ctx.db, ctx.clock, payload) }],
});
