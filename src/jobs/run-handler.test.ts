import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { jobs } from "@/db/schema";
import { createTestDb, truncateAll, truncateJobTables } from "@/db/test-db";
import { JOBS_CONFIG } from "./config";
import { defineJob, type AnyJobDefinition } from "./contract";
import { handleJobRun, sleepUntilMs, type RunHandlerDeps } from "./run-handler";
import { enqueueJob, retirePendingJobs } from "./store";

const db = createTestDb();
const SECRET = "run-test-secret";
const NOW = Date.parse("2026-09-19T00:00:00.000Z");

const counter = { runs: 0 };
const counting: AnyJobDefinition = defineJob({
  name: "count-me",
  maxAttempts: 2,
  timeoutMs: 5_000,
  backoff: { baseMs: 1_000, maxMs: 5_000 },
  parsePayload: () => ({}),
  steps: [{ name: "only", run: async () => { counter.runs += 1; return { summary: "ran", detail: [] }; } }],
});
const definitions = new Map([[counting.name, counting]]);

function harness(overrides: Partial<RunHandlerDeps> = {}) {
  const deferred: (() => Promise<void>)[] = [];
  const sleeps: number[] = [];
  let clock = NOW;
  const deps: RunHandlerDeps = {
    db,
    definitions,
    env: { CRON_SECRET: SECRET },
    workerId: "run-test",
    defer: (work) => deferred.push(work),
    sleep: async (ms) => { sleeps.push(ms); clock += ms; },
    now: () => clock,
    sleepSliceMs: 100,
    ...overrides,
  };
  const request = (body: unknown, auth: string | null = `Bearer ${SECRET}`): Request =>
    new Request("http://test/api/jobs/run", { method: "POST", headers: { "content-type": "application/json", ...(auth === null ? {} : { authorization: auth }) }, body: JSON.stringify(body) });
  return { deps, deferred, sleeps, request, settle: async () => { for (const work of deferred.splice(0)) await work(); } };
}

/** A queued count-me job due at `dueAtMs`, by the real enqueue. */
async function queued(dueAtMs: number): Promise<number> {
  const result = await enqueueJob(db, { now: () => new Date(NOW).toISOString() }, { name: "count-me", idempotencyKey: `count-me@${dueAtMs}`, payload: {}, maxAttempts: 2, runAt: new Date(dueAtMs) });
  return result.jobId!;
}

beforeEach(async () => {
  await truncateAll(db);
  await truncateJobTables(db);
  counter.runs = 0;
});

describe("sleepUntilMs", () => {
  it("is the time to the due instant, floored at zero and capped at the wake window", () => {
    expect(sleepUntilMs(NOW + 700, NOW)).toBe(700);
    expect(sleepUntilMs(NOW - 5, NOW)).toBe(0);
    expect(sleepUntilMs(NOW + 10 * 60_000, NOW)).toBe(JOBS_CONFIG.selfWakeWindowMs);
  });
});

describe("handleJobRun", () => {
  it("refuses without the secret configured, and without the bearer", async () => {
    const { deps, request } = harness();
    expect((await handleJobRun(request({ jobId: 1, dueAt: new Date(NOW).toISOString() }), { ...deps, env: {} })).status).toBe(500);
    expect((await handleJobRun(request({ jobId: 1, dueAt: new Date(NOW).toISOString() }, null), deps)).status).toBe(401);
    expect((await handleJobRun(request({ jobId: "x" }), deps)).status).toBe(400);
  });

  it("answers 202 at once, then sleeps until the due instant in slices and runs exactly that job", async () => {
    const jobId = await queued(NOW + 250);
    const { deps, request, sleeps, settle, deferred } = harness();
    const response = await handleJobRun(request({ jobId, dueAt: new Date(NOW + 250).toISOString() }), deps);
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ ok: true, data: { accepted: true, jobId, sleepMs: 250 } });
    expect(counter.runs).toBe(0);
    expect(deferred).toHaveLength(1);
    await settle();
    expect(sleeps).toEqual([100, 100, 50]);
    expect(counter.runs).toBe(1);
    const [row] = await db.select({ status: jobs.status }).from(jobs).where(eq(jobs.id, jobId));
    expect(row?.status).toBe("succeeded");
  });

  it("a job retired while the invocation slept ends the sleep within one slice and runs nothing", async () => {
    const jobId = await queued(NOW + 1_000);
    let clock = NOW;
    const sleeps: number[] = [];
    const { deps, request, settle } = harness({
      now: () => clock,
      sleep: async (ms) => {
        sleeps.push(ms);
        clock += ms;
        if (sleeps.length === 2) await retirePendingJobs(db, { now: () => new Date(NOW).toISOString() }, [jobId]);
      },
    });
    await handleJobRun(request({ jobId, dueAt: new Date(NOW + 1_000).toISOString() }), deps);
    await settle();
    expect(sleeps).toEqual([100, 100]);
    expect(counter.runs).toBe(0);
  });

  it("a job a cron tick already claimed is nothing to do: no run, no error", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const jobId = await queued(NOW);
    await db.update(jobs).set({ status: "running" }).where(eq(jobs.id, jobId));
    const { deps, request, settle } = harness();
    await handleJobRun(request({ jobId, dueAt: new Date(NOW).toISOString() }), deps);
    await settle();
    expect(counter.runs).toBe(0);
    expect(error).not.toHaveBeenCalled();
    error.mockRestore();
  });
});
