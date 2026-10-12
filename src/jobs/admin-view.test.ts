import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb } from "@research/db/test-db";
import { truncateAll, truncateJobTables } from "@/db/test-db";
import type { Clock } from "@research/domain/timing";
import { deadLetterJobs, recentRuns, scheduleStatuses } from "./admin-view";
import { defineJob } from "./contract";
import { tickSchedules } from "./schedule";
import { SCHEDULES } from "./schedules";
import { claimNextJob, enqueueJob, recordAttemptFailure, succeedJob } from "./store";

const db = createTestDb();

const T0 = "2026-09-08T12:00:00.000Z";
const clock: Clock = { now: () => T0 };

beforeEach(async () => {
  await truncateAll(db);
  await truncateJobTables(db);
});

describe("deadLetterJobs and recentRuns", () => {
  it("surfaces the dead letter with its error, and both runs in the history", async () => {
    await enqueueJob(db, clock, { name: "season-week", idempotencyKey: "dead", payload: {}, maxAttempts: 1, runAt: new Date(T0) });
    await enqueueJob(db, clock, { name: "season-week", idempotencyKey: "fine", payload: {}, maxAttempts: 1, runAt: new Date(T0) });

    const first = (await claimNextJob(db, clock, "w"))!;
    await recordAttemptFailure(db, clock, first, {
      error: "freeze refused by the register: week has already begun",
      errorKind: "terminal",
      disposition: { kind: "dead-letter" },
    });
    const second = (await claimNextJob(db, clock, "w"))!;
    await succeedJob(db, clock, second);

    const dead = await deadLetterJobs(db);
    expect(dead).toHaveLength(1);
    expect(dead[0]!.jobId).toBe(first.jobId);
    expect(dead[0]!.status).toBe("failed");
    expect(dead[0]!.lastError).toContain("week has already begun");

    const runs = await recentRuns(db);
    expect(runs).toHaveLength(2);
    expect(new Set(runs.map((run) => run.status))).toEqual(new Set(["failed", "succeeded"]));
  });
});

describe("scheduleStatuses", () => {
  it("reports cursor and last fire for each code-defined schedule", async () => {
    const canned = defineJob({
      name: "season-week",
      maxAttempts: 3,
      timeoutMs: 5_000,
      backoff: { baseMs: 60_000, maxMs: 600_000 },
      parsePayload: () => ({}),
      steps: [{ name: "only", run: async () => ({ summary: "noop", detail: [] }) }],
    });
    const cannedSweep = defineJob({
      name: "draft-sweep",
      maxAttempts: 2,
      timeoutMs: 5_000,
      backoff: { baseMs: 30_000, maxMs: 60_000 },
      parsePayload: () => ({}),
      steps: [{ name: "sweep", run: async () => ({ summary: "noop", detail: [] }) }],
    });
    // The real SCHEDULES now also fire "adp-snapshot" nightly (Draft HQ phase 2 Task 6).
    const cannedAdpSnapshot = defineJob({
      name: "adp-snapshot",
      maxAttempts: 3,
      timeoutMs: 5_000,
      backoff: { baseMs: 60_000, maxMs: 600_000 },
      parsePayload: () => ({}),
      steps: [{ name: "capture", run: async () => ({ summary: "noop", detail: [] }) }],
    });
    // The real SCHEDULES now also fire "props-preseason-snapshot" daily (props-anchor activation, Task 3).
    const cannedPropsPreseasonSnapshot = defineJob({
      name: "props-preseason-snapshot",
      maxAttempts: 3,
      timeoutMs: 5_000,
      backoff: { baseMs: 60_000, maxMs: 600_000 },
      parsePayload: () => ({}),
      steps: [{ name: "snapshot", run: async () => ({ summary: "noop", detail: [] }) }],
    });
    // The real SCHEDULES now also fire "capsule-sweep" nightly (player capsules).
    const cannedCapsuleSweep = defineJob({
      name: "capsule-sweep",
      maxAttempts: 2,
      timeoutMs: 5_000,
      backoff: { baseMs: 60_000, maxMs: 600_000 },
      parsePayload: () => ({}),
      steps: [{ name: "sweep", run: async () => ({ summary: "noop", detail: [] }) }],
    });
    // The real SCHEDULES now also fire "capture-harvest" nightly (injuries, news, depth charts).
    const cannedCaptureHarvest = defineJob({
      name: "capture-harvest",
      maxAttempts: 3,
      timeoutMs: 5_000,
      backoff: { baseMs: 60_000, maxMs: 600_000 },
      parsePayload: () => ({}),
      steps: [{ name: "harvest", run: async () => ({ summary: "noop", detail: [] }) }],
    });
    // The real SCHEDULES now also fire "win-totals" weekly (the publisher read).
    const cannedWinTotals = defineJob({
      name: "win-totals",
      maxAttempts: 3,
      timeoutMs: 5_000,
      backoff: { baseMs: 60_000, maxMs: 600_000 },
      parsePayload: () => ({}),
      steps: [{ name: "fetch", run: async () => ({ summary: "noop", detail: [] }) }],
    });
    const definitions = new Map([
      ["season-week", canned],
      ["draft-sweep", cannedSweep],
      ["adp-snapshot", cannedAdpSnapshot],
      ["props-preseason-snapshot", cannedPropsPreseasonSnapshot],
      ["capsule-sweep", cannedCapsuleSweep],
      ["capture-harvest", cannedCaptureHarvest],
      ["win-totals", cannedWinTotals],
    ]);

    // Bootstrap, then rewind the Tuesday cursor so the second tick enqueues the 12:00Z fire.
    await tickSchedules(db, { now: () => "2026-09-08T00:00:00.000Z" }, definitions, SCHEDULES);
    const reports = await tickSchedules(db, clock, definitions, SCHEDULES);
    expect(reports.find((r) => r.schedule === "season-week-tue-data")!.enqueued).toEqual(["2026-09-08T12:00:00.000Z"]);

    const statuses = await scheduleStatuses(db);
    expect(statuses.map((s) => s.name)).toEqual(SCHEDULES.map((s) => s.name));
    const tue = statuses.find((s) => s.name === "season-week-tue-data")!;
    expect(tue.cursor).toBe(T0);
    expect(tue.lastFire).toMatchObject({ at: "2026-09-08T12:00:00.000Z", jobStatus: "pending" });
    const wed = statuses.find((s) => s.name === "season-week-wed-data")!;
    expect(wed.lastFire).toBeNull();
  });
});
