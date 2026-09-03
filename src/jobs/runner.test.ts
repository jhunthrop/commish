import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb, truncateAll, truncateJobTables } from "@/db/test-db";
import type { Clock } from "@/domain/timing";
import { defineJob, type AnyJobDefinition } from "./contract";
import { runTick, type RunnerDeps } from "./runner";
import { enqueueJob } from "./store";

const db = createTestDb();

const T0 = "2026-09-08T12:00:00.000Z";
const clock: Clock = { now: () => T0 };

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
