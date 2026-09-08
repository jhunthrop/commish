import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb, recordStatements, truncateAll, truncateJobTables } from "@/db/test-db";
import type { Clock } from "@/domain/timing";
import { defineJob, type AnyJobDefinition } from "./contract";
import { runTick, type RunnerDeps } from "./runner";
import { createScheduleMemory } from "./schedule";
import { SCHEDULES } from "./schedules";
import { JOB_DEFINITIONS } from "./registry";
import { enqueueJob } from "./store";
import { createMemoryWakeSet, WAKE_MEMBERS, wakeMember, type WakeSet } from "./wake";

const db = createTestDb();

const T0 = "2026-09-08T12:00:00.000Z";
const clock: Clock = { now: () => T0 };
const T0_MS = Date.parse(T0);
/** A wake set whose sweep sentinel sits far in the future: nothing is due unless a test adds it. */
async function quietWake(): Promise<WakeSet> {
  const wake = createMemoryWakeSet();
  await wake.add(WAKE_MEMBERS.sweepSafety, T0_MS + 60 * 60_000);
  return wake;
}

function countingDefinition(counter: { count: number }): AnyJobDefinition {
  return defineJob({
    name: "count-me",
    maxAttempts: 3,
    timeoutMs: 5_000,
    backoff: { baseMs: 60_000, maxMs: 600_000 },
    parsePayload: () => ({}),
    steps: [
      {
        name: "only",
        run: async () => {
          counter.count += 1;
          return { summary: `run ${counter.count}`, detail: [] };
        },
      },
    ],
  });
}

function deps(monotonicNow?: () => number): RunnerDeps {
  return { db, clock, random: () => 0.5, workerId: "tick-test", monotonicNow };
}

async function enqueueN(n: number): Promise<void> {
  for (const i of Array.from({ length: n }, (_, index) => index)) {
    await enqueueJob(db, clock, { name: "count-me", idempotencyKey: `job-${i}`, payload: {}, maxAttempts: 3, runAt: new Date(T0) });
  }
}

beforeEach(async () => {
  await truncateAll(db);
  await truncateJobTables(db);
});

describe("runTick", () => {
  it("drains the queue and reports everything it did", async () => {
    const counter = { count: 0 };
    const definitions = new Map([["count-me", countingDefinition(counter)]]);
    await enqueueN(3);

    const report = await runTick(deps(), definitions, { budgetMs: 60_000, maxJobs: 10, schedules: [] });

    expect(report.stoppedBecause).toBe("queue-drained");
    expect(report.executed).toHaveLength(3);
    expect(report.executed.every((execution) => execution.outcome === "succeeded")).toBe(true);
    expect(counter.count).toBe(3);
    expect(report.schedules).toEqual([]);
    expect(report.reclaimed).toEqual([]);
  });

  it("stops at maxJobs and leaves the rest queued for the next tick", async () => {
    const counter = { count: 0 };
    const definitions = new Map([["count-me", countingDefinition(counter)]]);
    await enqueueN(5);

    const report = await runTick(deps(), definitions, { budgetMs: 60_000, maxJobs: 2, schedules: [] });
    expect(report.stoppedBecause).toBe("max-jobs");
    expect(report.executed).toHaveLength(2);

    const second = await runTick(deps(), definitions, { budgetMs: 60_000, maxJobs: 10, schedules: [] });
    expect(second.executed).toHaveLength(3);
    expect(counter.count).toBe(5);
  });

  it("caps a job's timeout from the POST-claim clock read, not the pre-claim one", async () => {
    // Fix round 2, LOW-D. The claim's own round trip burns budget; the cap handed to the
    // executor must reflect what is left AFTER it. Scripted monotonic readings: the pre-claim
    // check sees 59s remaining (plenty), the post-claim read sees only 20ms — so a step that
    // sleeps 150ms times out against a 20ms cap. A regression back to the pre-claim remaining
    // (59s) would let the step finish and fail this test.
    const definition = defineJob({
      name: "count-me",
      maxAttempts: 3,
      timeoutMs: 600_000, // the definition's own budget is huge; only the tick cap can time this out
      backoff: { baseMs: 60_000, maxMs: 600_000 },
      parsePayload: () => ({}),
      steps: [
        {
          name: "only",
          run: async () => {
            await new Promise((resolve) => setTimeout(resolve, 150));
            return { summary: "finished despite the cap", detail: [] };
          },
        },
      ],
    });
    await enqueueN(1);

    const readings = [0, 1_000, 59_980];
    const monotonic = () => readings.shift() ?? 59_990;

    const report = await runTick(deps(monotonic), new Map([["count-me", definition]]), {
      budgetMs: 60_000,
      maxJobs: 10,
      schedules: [],
    });

    expect(report.executed).toHaveLength(1);
    expect(report.executed[0]!.outcome).toBe("retry-scheduled");
    expect(report.executed[0]!.errorKind).toBe("timeout");
    expect(report.executed[0]!.error).toContain("20ms budget");
  });

  it("stops claiming when the budget runs out, exiting clean", async () => {
    const counter = { count: 0 };
    const definitions = new Map([["count-me", countingDefinition(counter)]]);
    await enqueueN(3);

    // A monotonic clock that burns 30 seconds per reading: the first claim check sees plenty,
    // the second sees the 60s budget already spent.
    const ticking = { at: 0 };
    const monotonic = () => {
      ticking.at += 30_000;
      return ticking.at;
    };

    const report = await runTick(deps(monotonic), definitions, { budgetMs: 60_000, maxJobs: 10, schedules: [] });
    expect(report.stoppedBecause).toBe("budget");
    expect(report.executed.length).toBeLessThan(3);
  });
});

describe("the wake gate (Neon cost audit finding 1): an idle minute costs zero statements", () => {
  it("a warm instance with nothing due runs the REAL schedules and issues no Postgres statement at all", async () => {
    const wake = await quietWake();
    const scheduleMemory = createScheduleMemory();
    const gated = { ...deps(), wake, scheduleMemory };
    // The cold tick reads the cursors once (and bootstraps them); the warm tick is what the cron
    // runs 1,439 times a day.
    await runTick(gated, JOB_DEFINITIONS, { budgetMs: 60_000, maxJobs: 10, schedules: SCHEDULES });
    const statements = await recordStatements(db, (logged) =>
      runTick({ ...gated, db: logged }, JOB_DEFINITIONS, { budgetMs: 60_000, maxJobs: 10, schedules: SCHEDULES }),
    );
    expect(statements).toEqual([]);
  });

  it("reports the idle tick honestly: no claim loop, no reclaim, every schedule quiet or gated off", async () => {
    const wake = await quietWake();
    const scheduleMemory = createScheduleMemory();
    const gated = { ...deps(), wake, scheduleMemory };
    await runTick(gated, JOB_DEFINITIONS, { budgetMs: 60_000, maxJobs: 10, schedules: SCHEDULES });
    // The next cron minute: the sweep's minute fire is due, and the gate holds it.
    const nextMinute = { ...gated, clock: { now: () => new Date(T0_MS + 60_000).toISOString() } };
    const report = await runTick(nextMinute, JOB_DEFINITIONS, { budgetMs: 60_000, maxJobs: 10, schedules: SCHEDULES });
    expect(report.stoppedBecause).toBe("idle");
    expect(report.reclaimed).toEqual([]);
    expect(report.executed).toEqual([]);
    expect(report.schedules.find((s) => s.schedule === "draft-sweep-minutely")).toMatchObject({ gatedOff: true, enqueued: [] });
  });

  it("claims a job the wake set names, and forgets the member so the next tick is idle again", async () => {
    const wake = await quietWake();
    const counter = { count: 0 };
    const definitions = new Map([["count-me", countingDefinition(counter)]]);
    await enqueueJob(db, clock, { name: "count-me", idempotencyKey: "gated-1", payload: {}, maxAttempts: 3, runAt: new Date(T0) }, wake);

    const first = await runTick({ ...deps(), wake }, definitions, { budgetMs: 60_000, maxJobs: 10, schedules: [] });
    expect(first.executed).toHaveLength(1);
    expect(counter.count).toBe(1);

    const second = await runTick({ ...deps(), wake }, definitions, { budgetMs: 60_000, maxJobs: 10, schedules: [] });
    expect(second.stoppedBecause).toBe("idle");
  });

  it("a job queued for LATER is invisible until its instant, then claimed", async () => {
    const wake = await quietWake();
    const counter = { count: 0 };
    const definitions = new Map([["count-me", countingDefinition(counter)]]);
    const later = new Date(T0_MS + 5 * 60_000);
    await enqueueJob(db, clock, { name: "count-me", idempotencyKey: "gated-later", payload: {}, maxAttempts: 3, runAt: later }, wake);

    expect((await runTick({ ...deps(), wake }, definitions, { budgetMs: 60_000, maxJobs: 10, schedules: [] })).stoppedBecause).toBe("idle");
    const at = { ...deps(), wake, clock: { now: () => later.toISOString() } };
    expect((await runTick(at, definitions, { budgetMs: 60_000, maxJobs: 10, schedules: [] })).executed).toHaveLength(1);
  });

  it("scans for stale attempts only once the claim's reclaim wake has passed", async () => {
    const wake = await quietWake();
    const counter = { count: 0 };
    const definitions = new Map([["count-me", countingDefinition(counter)]]);
    await enqueueJob(db, clock, { name: "count-me", idempotencyKey: "gated-reclaim", payload: {}, maxAttempts: 3, runAt: new Date(T0) }, wake);
    await runTick({ ...deps(), wake }, definitions, { budgetMs: 60_000, maxJobs: 10, schedules: [] });

    // The claim registered `reclaim` for later; a tick before that instant must not scan.
    const reclaimAt = (await wake.due(T0_MS + 60 * 60_000)).members;
    expect(reclaimAt).toContain(WAKE_MEMBERS.reclaim);
    const statements = await recordStatements(db, (logged) => runTick({ ...deps(), wake, db: logged }, definitions, { budgetMs: 60_000, maxJobs: 10, schedules: [] }));
    expect(statements.filter((s) => /"running"/.test(s))).toEqual([]);
  });

  it("the sweep schedule fires when a draft registered a due instant, and the sweep job is claimed in the same tick", async () => {
    const wake = await quietWake();
    await wake.add(wakeMember.draft("draft_due"), T0_MS - 1);
    const noopSweep = defineJob({
      name: "draft-sweep",
      maxAttempts: 2,
      timeoutMs: 5_000,
      backoff: { baseMs: 30_000, maxMs: 60_000 },
      parsePayload: () => ({}),
      steps: [{ name: "sweep", run: async () => ({ summary: "noop", detail: [] }) }],
    });
    const sweepOnly = SCHEDULES.filter((s) => s.name === "draft-sweep-minutely");
    const definitions = new Map([["draft-sweep", noopSweep]]);
    const scheduleMemory = createScheduleMemory();
    // Cold tick bootstraps the cursor; the next minute is the one under test.
    await runTick({ ...deps(), wake, scheduleMemory }, definitions, { budgetMs: 60_000, maxJobs: 10, schedules: sweepOnly });
    const nextMinute = { ...deps(), wake, scheduleMemory, clock: { now: () => new Date(T0_MS + 60_000).toISOString() } };
    await wake.add(wakeMember.draft("draft_due"), T0_MS - 1);
    const report = await runTick(nextMinute, definitions, { budgetMs: 60_000, maxJobs: 10, schedules: sweepOnly });
    expect(report.schedules[0]!.enqueued).toHaveLength(1);
    expect(report.executed.map((e) => e.name)).toEqual(["draft-sweep"]);
  });
});
