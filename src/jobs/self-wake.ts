/**
 * THE SELF-WAKE (draft-room performance round, item 3; the knobs and the argument are on
 * `JOBS_CONFIG.selfWake*`). The queue has millisecond `run_at` precision and a claim that honours
 * it; what it lacked was a caller at the instant. This is that caller: the invocation that
 * enqueued a job POSTs its id and due instant to `/api/jobs/run`, after its own response has
 * gone, and the receiving invocation does the waiting — re-arming itself for the remainder when
 * the due instant is further out than one invocation may sleep (`run-handler.ts`). Never throws
 * and never blocks the caller: a missing secret is logged once and the job is left to the cron;
 * a failed or slow wake is logged once per room and the job is left to the cron.
 *
 * DEPLOYMENT PROTECTION (review fix round, finding 4): a preview deployment refuses an
 * unauthenticated request to itself. When the project's `VERCEL_AUTOMATION_BYPASS_SECRET` is in
 * the environment it rides the wake as the platform's own bypass header; when it is not, the
 * refusal is logged once per room rather than once per pick.
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
  /** Arranges for `jobId` to be claimed at `dueAtMs` by a fresh invocation, after the caller's
   *  response has gone. `room` names what the wake is for, so a refusal is logged once per room. */
  wake(jobId: number, dueAtMs: number, room?: string): void;
  /** The same request, sent now and awaited: what a sleeper uses to re-arm itself. */
  wakeNow(jobId: number, dueAtMs: number, room?: string): Promise<void>;
}

export interface SelfWakeDeps {
  readonly env: EnvRecord;
  readonly fetch?: typeof fetch;
  readonly now?: () => number;
  /** Where the deferred wake request runs: after the response by default (`runAfterResponse`). */
  readonly defer?: (work: () => Promise<void>) => void;
}

export const JOB_RUN_PATH = "/api/jobs/run";
export const PROTECTION_BYPASS_HEADER = "x-vercel-protection-bypass";

const present = (value: string | undefined): value is string => value !== undefined && value !== "";

export function createSelfWake({ env, fetch: fetchFn = fetch, now = Date.now, defer = runAfterResponse }: SelfWakeDeps): SelfWake {
  let warnedUnconfigured = false;
  const refusedRooms = new Set<string>();

  const headers = (secret: string): Record<string, string> => ({
    authorization: `Bearer ${secret}`,
    "content-type": "application/json",
    ...(present(env.VERCEL_AUTOMATION_BYPASS_SECRET) ? { [PROTECTION_BYPASS_HEADER]: env.VERCEL_AUTOMATION_BYPASS_SECRET } : {}),
  });

  /** The secret, or null after one warning: an unconfigured deployment leaves every job to the tick. */
  function secretOrWarn(): string | null {
    const secret = env.CRON_SECRET;
    if (present(secret)) return secret;
    if (!warnedUnconfigured) console.warn("[jobs] self-wake skipped: CRON_SECRET is not set; queued jobs wait for the tick.");
    warnedUnconfigured = true;
    return null;
  }

  async function send(jobId: number, dueAtMs: number, room: string | undefined): Promise<void> {
    const secret = secretOrWarn();
    if (secret === null) return;
    const body: JobRunRequest = { jobId, dueAt: new Date(dueAtMs).toISOString() };
    const response = await fetchFn(`${selfOrigin(env)}${JOB_RUN_PATH}`, {
      method: "POST",
      headers: headers(secret),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(JOBS_CONFIG.selfWakeTimeoutMs),
    });
    if (response.ok) return;
    const key = room ?? `job:${jobId}`;
    if (refusedRooms.has(key)) return;
    refusedRooms.add(key);
    console.error("[jobs] self-wake refused; this room's jobs wait for the tick until a wake is accepted", { room: key, jobId, status: response.status });
  }

  return {
    wake(jobId, dueAtMs, room) {
      if (dueAtMs - now() > JOBS_CONFIG.selfWakeChainMaxMs || secretOrWarn() === null) return;
      defer(() => send(jobId, dueAtMs, room));
    },
    wakeNow(jobId, dueAtMs, room) {
      return send(jobId, dueAtMs, room);
    },
  };
}

/** A wake that never wakes: tests, and every process that paces nothing. */
export const NO_SELF_WAKE: SelfWake = { wake: () => undefined, wakeNow: async () => undefined };

let shared: SelfWake | undefined;

/** The process-wide wake over the process env. */
export function getSelfWake(): SelfWake {
  shared ??= createSelfWake({ env: process.env });
  return shared;
}
