/**
 * THE SELF-WAKE (draft-room performance round, item 3; the knobs and the argument are on
 * `JOBS_CONFIG.selfWake*`). The queue has millisecond `run_at` precision and a claim that honours
 * it; what it lacked was a caller at the instant. This is that caller: the invocation that
 * enqueued a job due inside the window POSTs its id and due instant to `/api/jobs/run`, after
 * its own response has gone, and the receiving invocation does the waiting. Never throws and
 * never blocks the caller: a missing secret is logged once and the job is left to the cron; a
 * failed or slow wake is logged and the job is left to the cron.
 */
import { runAfterResponse } from "@/lib/api/after-response";
import { JOBS_CONFIG } from "./config";
import { selfOrigin } from "./self-url";
import type { EnvRecord } from "./tick-auth";

/** What the wake carries: which job, and the instant the receiver should claim it at. */
export interface JobRunRequest {
  readonly jobId: number;
  readonly dueAt: string;
}

export interface SelfWake {
  /** Arranges for `jobId` to be claimed at `dueAtMs` by a fresh invocation, when inside the window. */
  wake(jobId: number, dueAtMs: number): void;
}

export interface SelfWakeDeps {
  readonly env: EnvRecord;
  readonly fetch?: typeof fetch;
  readonly now?: () => number;
  /** Where the wake request runs: after the response by default (`runAfterResponse`). */
  readonly defer?: (work: () => Promise<void>) => void;
}

export const JOB_RUN_PATH = "/api/jobs/run";

export function createSelfWake({ env, fetch: fetchFn = fetch, now = Date.now, defer = runAfterResponse }: SelfWakeDeps): SelfWake {
  let warnedUnconfigured = false;
  return {
    wake(jobId, dueAtMs) {
      if (dueAtMs - now() > JOBS_CONFIG.selfWakeWindowMs) return;
      const secret = env.CRON_SECRET;
      if (secret === undefined || secret === "") {
        if (!warnedUnconfigured) console.warn("[jobs] self-wake skipped: CRON_SECRET is not set; queued jobs wait for the tick.");
        warnedUnconfigured = true;
        return;
      }
      const body: JobRunRequest = { jobId, dueAt: new Date(dueAtMs).toISOString() };
      defer(async () => {
        const response = await fetchFn(`${selfOrigin(env)}${JOB_RUN_PATH}`, {
          method: "POST",
          headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(JOBS_CONFIG.selfWakeTimeoutMs),
        });
        if (!response.ok) console.error("[jobs] self-wake refused", { jobId, status: response.status });
      });
    },
  };
}

/** A wake that never wakes: tests, and every process that paces nothing. */
export const NO_SELF_WAKE: SelfWake = { wake: () => undefined };

let shared: SelfWake | undefined;

/** The process-wide wake over the process env. */
export function getSelfWake(): SelfWake {
  shared ??= createSelfWake({ env: process.env });
  return shared;
}
