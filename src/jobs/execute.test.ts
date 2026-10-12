import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { jobRuns, jobs } from "@/db/schema";
import { createTestDb } from "@research/db/test-db";
import { truncateAll, truncateJobTables } from "@/db/test-db";
import type { Clock } from "@research/domain/timing";
import { TerminalJobError, defineJob, type AnyJobDefinition, type StepOutcome } from "./contract";
import { executeClaimedJob, formatErrorForLog, scrubSecrets, type ExecutorDeps } from "./execute";
import { JOBS_CONFIG } from "./config";
import { claimNextJob, completedStepsFor, enqueueJob, reclaimStaleJobs } from "./store";

const db = createTestDb();

const T0 = "2026-09-08T12:00:00.000Z";
const clockAt = (iso: string): Clock => ({ now: () => iso });

const ok = (summary: string): StepOutcome => ({ summary, detail: [] });

function deps(clock: Clock): ExecutorDeps {
  return { db, clock, random: () => 0.999999, workerId: "test-worker" };
}

function registryOf(definition: AnyJobDefinition): ReadonlyMap<string, AnyJobDefinition> {
  return new Map([[definition.name, definition]]);
}

async function enqueueAndClaim(name: string, clock: Clock, maxAttempts = 3) {
  await enqueueJob(db, clock, { name, idempotencyKey: `${name}-key`, payload: {}, maxAttempts, runAt: new Date(clock.now()) });
  const claimed = await claimNextJob(db, clock, "test-worker");
  expect(claimed).not.toBeNull();
  return claimed!;
}

async function jobRow(jobId: number) {
  return (await db.select().from(jobs).where(eq(jobs.id, jobId)))[0]!;
}

beforeEach(async () => {
  await truncateAll(db);
  await truncateJobTables(db);
});

describe("executeClaimedJob", () => {
  it("runs every step, checkpoints each, and succeeds the job", async () => {
    const ran: string[] = [];
    const definition = defineJob({
      name: "three-steps",
      maxAttempts: 3,
      timeoutMs: 5_000,
      backoff: { baseMs: 60_000, maxMs: 600_000 },
      parsePayload: () => ({}),
      steps: ["a", "b", "c"].map((name) => ({
        name,
        run: async () => {
          ran.push(name);
          return ok(`step ${name} done`);
        },
      })),
    });

    const clock = clockAt(T0);
    const claimed = await enqueueAndClaim("three-steps", clock);
    const report = await executeClaimedJob(deps(clock), registryOf(definition), claimed);

    expect(report.outcome).toBe("succeeded");
    expect(ran).toEqual(["a", "b", "c"]);
    expect(await completedStepsFor(db, claimed.jobId)).toEqual(new Set(["a", "b", "c"]));
    expect((await jobRow(claimed.jobId)).status).toBe("succeeded");
  });

  it("resumes from the first unrecorded step on retry, never re-running completed ones", async () => {
    const runs: string[] = [];
    const failures = { b: 1 };
    const definition = defineJob({
      name: "resumable",
      maxAttempts: 3,
      timeoutMs: 5_000,
      backoff: { baseMs: 60_000, maxMs: 600_000 },
      parsePayload: () => ({}),
      steps: [
        { name: "a", run: async () => (runs.push("a"), ok("a")) },
        {
          name: "b",
          run: async () => {
            runs.push("b");
            if (failures.b > 0) {
              failures.b -= 1;
              throw new Error("transient: connection reset");
            }
            return ok("b");
          },
        },
        { name: "c", run: async () => (runs.push("c"), ok("c")) },
      ],
    });

    const clock = clockAt(T0);
    const claimed = await enqueueAndClaim("resumable", clock);
    const first = await executeClaimedJob(deps(clock), registryOf(definition), claimed);
    expect(first.outcome).toBe("retry-scheduled");
    expect(first.errorKind).toBe("retryable");
    expect(await completedStepsFor(db, claimed.jobId)).toEqual(new Set(["a"]));

    // Claim again once the backoff has elapsed (the report says exactly when).
    const laterClock = clockAt(first.nextRunAt!);
    const second = await claimNextJob(db, laterClock, "test-worker");
    expect(second?.attempt).toBe(2);
    const secondReport = await executeClaimedJob(deps(laterClock), registryOf(definition), second!);

    expect(secondReport.outcome).toBe("succeeded");
    expect(runs).toEqual(["a", "b", "b", "c"]); // a ran ONCE; b retried; c ran once
  });

  it("dead-letters a TerminalJobError immediately, attempts remaining or not", async () => {
    const definition = defineJob({
      name: "refused",
      maxAttempts: 5,
      timeoutMs: 5_000,
      backoff: { baseMs: 60_000, maxMs: 600_000 },
      parsePayload: () => ({}),
      steps: [
        {
          name: "freeze",
          run: async () => {
            throw new TerminalJobError("freeze refused: week 1 kickoff has already passed");
          },
        },
      ],
    });

    const clock = clockAt(T0);
    const claimed = await enqueueAndClaim("refused", clock);
    const report = await executeClaimedJob(deps(clock), registryOf(definition), claimed);

    expect(report.outcome).toBe("dead-lettered");
    expect(report.errorKind).toBe("terminal");
    expect((await jobRow(claimed.jobId)).status).toBe("failed");
    const runRow = (await db.select().from(jobRuns).where(eq(jobRuns.id, claimed.runId)))[0]!;
    expect(runRow.errorKind).toBe("terminal");
  });

  it("dead-letters a retryable error once attempts exhaust", async () => {
    const definition = defineJob({
      name: "flaky-forever",
      maxAttempts: 2,
      timeoutMs: 5_000,
      backoff: { baseMs: 60_000, maxMs: 600_000 },
      parsePayload: () => ({}),
      steps: [
        {
          name: "only",
          run: async () => {
            throw new Error("upstream 503");
          },
        },
      ],
    });

    const clock = clockAt(T0);
    const claimed = await enqueueAndClaim("flaky-forever", clock, 2);
    const first = await executeClaimedJob(deps(clock), registryOf(definition), claimed);
    expect(first.outcome).toBe("retry-scheduled");

    const laterClock = clockAt(first.nextRunAt!);
    const second = (await claimNextJob(db, laterClock, "test-worker"))!;
    const secondReport = await executeClaimedJob(deps(laterClock), registryOf(definition), second);
    expect(secondReport.outcome).toBe("dead-lettered");
    expect(secondReport.errorKind).toBe("retryable");
    expect((await jobRow(claimed.jobId)).status).toBe("failed");
  });

  it("times an attempt out as retryable", async () => {
    const definition = defineJob({
      name: "slow",
      maxAttempts: 3,
      timeoutMs: 50,
      backoff: { baseMs: 60_000, maxMs: 600_000 },
      parsePayload: () => ({}),
      steps: [
        {
          name: "sleepy",
          run: async () => {
            await new Promise((resolve) => setTimeout(resolve, 500));
            return ok("too late");
          },
        },
      ],
    });

    const clock = clockAt(T0);
    const claimed = await enqueueAndClaim("slow", clock);
    const report = await executeClaimedJob(deps(clock), registryOf(definition), claimed);

    expect(report.outcome).toBe("retry-scheduled");
    expect(report.errorKind).toBe("timeout");
    expect(report.error).toContain("50ms budget");
  });

  it("dead-letters a job whose name has no registered definition", async () => {
    const clock = clockAt(T0);
    const claimed = await enqueueAndClaim("nobody-home", clock);
    const report = await executeClaimedJob(deps(clock), new Map(), claimed);

    expect(report.outcome).toBe("dead-lettered");
    expect(report.error).toContain('no job definition registered under "nobody-home"');
    expect((await jobRow(claimed.jobId)).status).toBe("failed");
  });

  it("dead-letters a payload that does not parse, classified terminal", async () => {
    const definition = defineJob({
      name: "strict-payload",
      maxAttempts: 5,
      timeoutMs: 5_000,
      backoff: { baseMs: 60_000, maxMs: 600_000 },
      parsePayload: () => {
        throw new Error("season must be an integer");
      },
      steps: [{ name: "never", run: async () => ok("unreachable") }],
    });

    const clock = clockAt(T0);
    const claimed = await enqueueAndClaim("strict-payload", clock);
    const report = await executeClaimedJob(deps(clock), registryOf(definition), claimed);

    expect(report.outcome).toBe("dead-lettered");
    expect(report.errorKind).toBe("terminal");
    expect(report.error).toContain("season must be an integer");
  });
});

describe("the reclaim race (fix round, MEDIUM-2)", () => {
  /** A clock far enough past the claim that the claimed attempt's heartbeat reads stale. */
  const wellPastStale = clockAt(new Date(new Date(T0).getTime() + JOBS_CONFIG.staleAfterMs + 60_000).toISOString());

  /** A step that stages the race deterministically: mid-attempt, a reclaim pass (another tick,
   *  later wall clock) takes the job back — then the step finishes as the zombie. */
  function selfReclaimingDefinition(name: string, thenThrow: boolean) {
    return defineJob({
      name,
      maxAttempts: 3,
      timeoutMs: 5_000,
      backoff: { baseMs: 60_000, maxMs: 600_000 },
      parsePayload: () => ({}),
      steps: [
        {
          name: "raced",
          run: async (ctx) => {
            const reclaimed = await reclaimStaleJobs(ctx.db, wellPastStale);
            expect(reclaimed).toHaveLength(1);
            if (thenThrow) throw new Error("zombie's own failure, after losing the job");
            return ok("zombie finished late");
          },
        },
      ],
    });
  }

  it("reports a reclaimed attempt superseded on the success path, tick intact, history consistent", async () => {
    const definition = selfReclaimingDefinition("raced-success", false);
    const clock = clockAt(T0);
    const claimed = await enqueueAndClaim("raced-success", clock);

    const report = await executeClaimedJob(deps(clock), registryOf(definition), claimed);
    expect(report.outcome).toBe("superseded");

    // History: the zombie's run row stays exactly as the reclaim closed it, and the job belongs
    // to the reclaim's requeue — pending, claimable, and able to finish for real.
    const runRow = (await db.select().from(jobRuns).where(eq(jobRuns.id, claimed.runId)))[0]!;
    expect(runRow.status).toBe("abandoned");
    expect(runRow.errorKind).toBe("crash");
    expect((await jobRow(claimed.jobId)).status).toBe("pending");

    const second = await claimNextJob(db, wellPastStale, "test-worker-2");
    expect(second?.jobId).toBe(claimed.jobId);
    expect(second?.attempt).toBe(2);
  });

  it("reports superseded on the failure path too, instead of letting the trigger rejection escape", async () => {
    const definition = selfReclaimingDefinition("raced-failure", true);
    const clock = clockAt(T0);
    const claimed = await enqueueAndClaim("raced-failure", clock);

    const report = await executeClaimedJob(deps(clock), registryOf(definition), claimed);
    expect(report.outcome).toBe("superseded");
    expect((await jobRow(claimed.jobId)).status).toBe("pending");
    const runRow = (await db.select().from(jobRuns).where(eq(jobRuns.id, claimed.runId)))[0]!;
    expect(runRow.status).toBe("abandoned"); // the reclaim's record, not the zombie's rewrite
  });
});

describe("scrubSecrets", () => {
  it("replaces an explicit secret env value in stored text", () => {
    const env = { ODDS_API_KEY: "sk-live-e2e-scrub-test" };
    expect(scrubSecrets("GET /odds?apiKey=sk-live-e2e-scrub-test failed", env)).toBe("GET /odds?apiKey=[ODDS_API_KEY] failed");
  });

  it("scrubs a SHORT explicit secret, where the heuristic's length floor does not apply", () => {
    // The floor exists to keep trivial pattern-matched values ("on") from shredding logs; an
    // explicitly named secret is real at any length, and CRON_SECRET is exactly the kind an
    // operator might set short.
    const env = { CRON_SECRET: "abc12" };
    expect(scrubSecrets("Authorization: Bearer abc12 rejected", env)).toBe("Authorization: Bearer [CRON_SECRET] rejected");
  });

  it("catches secrets by NAME convention, not only the hand list (the ANTHROPIC_API_KEY lesson)", () => {
    const env = {
      ANTHROPIC_API_KEY: "sk-ant-planted-value",
      SOME_SERVICE_TOKEN: "tok-planted-value",
      DB_PASSWORD: "hunter2-planted",
      NODE_ENV: "production", // matching nothing secret-shaped: untouched
      FEATURE_KEY_ROTATION: "on", // secret-shaped NAME, trivial value: left alone by the length floor
    };
    const text = "auth sk-ant-planted-value then tok-planted-value then hunter2-planted while production stayed on";
    expect(scrubSecrets(text, env)).toBe("auth [ANTHROPIC_API_KEY] then [SOME_SERVICE_TOKEN] then [DB_PASSWORD] while production stayed on");
  });
});

describe("formatErrorForLog (fix round, MEDIUM-3)", () => {
  it("scrubs a planted secret out of the message, the stack, and a nested cause", () => {
    const env = { PLANTED_TEST_SECRET: "planted-secret-value-123" };

    const root = new Error("connect failed for token planted-secret-value-123");
    root.stack = `Error: connect failed for token planted-secret-value-123\n    at fetchOdds (planted-secret-value-123/http.ts:1:1)`;
    const middle = new Error("snapshot aborted", { cause: root });
    const top = new Error("props step failed", { cause: middle });

    const formatted = formatErrorForLog(top, env);
    expect(formatted).not.toContain("planted-secret-value-123");
    expect(formatted).toContain("[PLANTED_TEST_SECRET]");
    // The whole chain is present: top, middle, and the root's own stack line.
    expect(formatted).toContain("props step failed");
    expect(formatted).toContain("snapshot aborted");
    expect(formatted).toContain("at fetchOdds");
  });

  it("survives a cause cycle without recursing forever", () => {
    const a = new Error("a");
    const b = new Error("b", { cause: a });
    (a as { cause?: unknown }).cause = b;
    expect(formatErrorForLog(a, {})).toContain("Error: a");
  });
});
