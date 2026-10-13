import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { jobs, scheduleCursors } from "@/db/schema";
import { createTestDb, recordStatements } from "@research-ts/db/test-db";
import { truncateAll, truncateJobTables } from "@/db/test-db";
import type { Clock } from "@research-ts/domain/timing";
import { defineJob, type AnyJobDefinition } from "./contract";
import { createScheduleMemory, tickSchedules } from "./schedule";
import { SCHEDULES } from "./schedules";
import type { ScheduleDefinition } from "./schedules";
import { parseCronExpression } from "./cron";
import { classifyWakeDue, createMemoryWakeSet, WAKE_MEMBERS, wakeMember } from "./wake";

const db = createTestDb();

const clockAt = (iso: string): Clock => ({ now: () => iso });

const noopDefinition = defineJob({
  name: "season-week",
  maxAttempts: 3,
  timeoutMs: 5_000,
  backoff: { baseMs: 60_000, maxMs: 600_000 },
  parsePayload: () => ({}),
  steps: [{ name: "only", run: async () => ({ summary: "noop", detail: [] }) }],
});
const sweepNoop = defineJob({
  name: "draft-sweep",
  maxAttempts: 2,
  timeoutMs: 5_000,
  backoff: { baseMs: 30_000, maxMs: 60_000 },
  parsePayload: () => ({}),
  steps: [{ name: "sweep", run: async () => ({ summary: "noop", detail: [] }) }],
});
/** The real SCHEDULES now also fire "adp-snapshot" nightly (Draft HQ phase 2 Task 6). */
const adpSnapshotNoop = defineJob({
  name: "adp-snapshot",
  maxAttempts: 3,
  timeoutMs: 5_000,
  backoff: { baseMs: 60_000, maxMs: 600_000 },
  parsePayload: () => ({}),
  steps: [{ name: "capture", run: async () => ({ summary: "noop", detail: [] }) }],
});
/** The real SCHEDULES also fire "props-preseason-snapshot" daily (props-anchor activation, Task 3). */
const propsPreseasonSnapshotNoop = defineJob({
  name: "props-preseason-snapshot",
  maxAttempts: 3,
  timeoutMs: 5_000,
  backoff: { baseMs: 60_000, maxMs: 600_000 },
  parsePayload: () => ({}),
  steps: [{ name: "snapshot", run: async () => ({ summary: "noop", detail: [] }) }],
});
/** The real SCHEDULES now also fire "capsule-sweep" nightly (player capsules, Draft HQ phase 4's
 *  data, started early). */
const capsuleSweepNoop = defineJob({
  name: "capsule-sweep",
  maxAttempts: 2,
  timeoutMs: 5_000,
  backoff: { baseMs: 60_000, maxMs: 600_000 },
  parsePayload: () => ({}),
  steps: [{ name: "sweep", run: async () => ({ summary: "noop", detail: [] }) }],
});
/** The real SCHEDULES now also fire "capture-harvest" nightly (injuries, news, depth charts). */
const captureHarvestNoop = defineJob({
  name: "capture-harvest",
  maxAttempts: 3,
  timeoutMs: 5_000,
  backoff: { baseMs: 60_000, maxMs: 600_000 },
  parsePayload: () => ({}),
  steps: [{ name: "harvest", run: async () => ({ summary: "noop", detail: [] }) }],
});
/** The real SCHEDULES now also fire "win-totals" weekly (dossier-voice round, the publisher read). */
const winTotalsNoop = defineJob({
  name: "win-totals",
  maxAttempts: 3,
  timeoutMs: 5_000,
  backoff: { baseMs: 60_000, maxMs: 600_000 },
  parsePayload: () => ({}),
  steps: [{ name: "fetch", run: async () => ({ summary: "noop", detail: [] }) }],
});
const definitions: ReadonlyMap<string, AnyJobDefinition> = new Map([
  ["season-week", noopDefinition],
  ["draft-sweep", sweepNoop],
  ["adp-snapshot", adpSnapshotNoop],
  ["props-preseason-snapshot", propsPreseasonSnapshotNoop],
  ["capsule-sweep", capsuleSweepNoop],
  ["capture-harvest", captureHarvestNoop],
  ["win-totals", winTotalsNoop],
]);

/** Just the Tuesday schedule, so fire counts in tests are one schedule's worth. */
const tueOnly: readonly ScheduleDefinition[] = [SCHEDULES.find((s) => s.name === "season-week-tue-data")!];

async function setCursor(name: string, iso: string): Promise<void> {
  await db.insert(scheduleCursors).values({ scheduleName: name, lastEvaluatedAt: new Date(iso) });
}

/** A fresh, cold instance per test: the process-wide memory would otherwise carry one test's
 *  "evaluated through 16:00" into the next test's freshly seeded cursor. */
let memory = createScheduleMemory();

beforeEach(async () => {
  await truncateAll(db);
  await truncateJobTables(db);
  memory = createScheduleMemory();
});

describe("tickSchedules", () => {
  it("bootstraps a never-seen schedule: cursor written, nothing enqueued", async () => {
    const reports = await tickSchedules(db, clockAt("2026-09-08T16:00:00.000Z"), definitions, tueOnly, { memory });
    expect(reports).toEqual([
      { schedule: "season-week-tue-data", bootstrapped: true, gatedOff: false, enqueued: [], deduped: 0, droppedBeforeWindow: 0 },
    ]);
    expect(await db.select().from(jobs)).toHaveLength(0);
    const cursor = await db.select().from(scheduleCursors);
    expect(cursor[0]!.lastEvaluatedAt.toISOString()).toBe("2026-09-08T16:00:00.000Z");
  });

  it("enqueues the missed fire after a laptop-asleep gap, and advances the cursor", async () => {
    // Cursor last saw Monday evening; the machine slept through Tuesday 08:00 ET (12:00Z).
    await setCursor("season-week-tue-data", "2026-09-07T22:00:00.000Z");
    const reports = await tickSchedules(db, clockAt("2026-09-08T16:00:00.000Z"), definitions, tueOnly, { memory });

    expect(reports[0]!.enqueued).toEqual(["2026-09-08T12:00:00.000Z"]);
    const rows = await db.select().from(jobs);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.idempotencyKey).toBe("season-week-tue-data@2026-09-08T12:00:00.000Z");
    expect(rows[0]!.scheduleName).toBe("season-week-tue-data");
    expect(rows[0]!.scheduledFor?.toISOString()).toBe("2026-09-08T12:00:00.000Z");
    expect(rows[0]!.runAt.toISOString()).toBe("2026-09-08T12:00:00.000Z");
    expect(rows[0]!.maxAttempts).toBe(3);

    const cursor = await db.select().from(scheduleCursors).where(eq(scheduleCursors.scheduleName, "season-week-tue-data"));
    expect(cursor[0]!.lastEvaluatedAt.toISOString()).toBe("2026-09-08T16:00:00.000Z");
  });

  it("catches up multiple missed fires across a multi-day gap", async () => {
    await setCursor("season-week-tue-data", "2026-09-07T00:00:00.000Z");
    // Two Tuesdays would be > maxCatchUp; one week window: cursor 1 day back plus 6 days forward.
    const reports = await tickSchedules(db, clockAt("2026-09-08T16:00:00.000Z"), definitions, SCHEDULES, { memory });
    const bySchedule = new Map(reports.map((report) => [report.schedule, report]));
    expect(bySchedule.get("season-week-tue-data")!.enqueued).toEqual(["2026-09-08T12:00:00.000Z"]);
    // The Wednesday and Thursday schedules had no cursor yet: bootstrapped, nothing enqueued.
    expect(bySchedule.get("season-week-wed-data")!.bootstrapped).toBe(true);
    expect(bySchedule.get("season-week-thu-freeze")!.bootstrapped).toBe(true);
  });

  it("dedupes a double tick: same fire, second enqueue is a no-op", async () => {
    await setCursor("season-week-tue-data", "2026-09-08T00:00:00.000Z");
    await tickSchedules(db, clockAt("2026-09-08T16:00:00.000Z"), definitions, tueOnly, { memory });

    // Rewind the cursor as if a concurrent runner had read the old value — its enqueue must
    // dedupe against the fire the first tick already wrote. A FRESH memory plays that other
    // runner: a cold instance reads the cursor row rather than trusting anything remembered.
    await db
      .update(scheduleCursors)
      .set({ lastEvaluatedAt: new Date("2026-09-08T00:00:00.000Z") })
      .where(eq(scheduleCursors.scheduleName, "season-week-tue-data"));
    const reports = await tickSchedules(db, clockAt("2026-09-08T16:00:00.000Z"), definitions, tueOnly, { memory: createScheduleMemory() });

    expect(reports[0]!.enqueued).toEqual([]);
    expect(reports[0]!.deduped).toBe(1);
    expect(await db.select().from(jobs)).toHaveLength(1);
  });

  it("drops fires older than the catch-up window instead of replaying a month", async () => {
    // Cursor a month back: four Tuesday fires missed, only the one inside 7 days is enqueued.
    await setCursor("season-week-tue-data", "2026-08-08T00:00:00.000Z");
    const reports = await tickSchedules(db, clockAt("2026-09-08T16:00:00.000Z"), definitions, tueOnly, { memory });

    expect(reports[0]!.enqueued).toEqual(["2026-09-08T12:00:00.000Z"]);
    expect(reports[0]!.droppedBeforeWindow).toBe(4); // Aug 11, 18, 25, Sep 1
    expect(await db.select().from(jobs)).toHaveLength(1);
  });

  it("honors a schedule's own catchUpMs: a minute-cadence sweep drops the slept-through backlog instead of replaying it", async () => {
    const minuteSweep: ScheduleDefinition = {
      name: "minute-sweep",
      cron: "* * * * *",
      expression: parseCronExpression("* * * * *"),
      timezone: "UTC",
      job: "season-week",
      payload: {},
      description: "level-triggered minute schedule under test",
      catchUpMs: 5 * 60_000,
    };
    // Cursor an hour back: sixty missed fires. A level-triggered sweep's one caught-up run does
    // the work of every older one, so only the five inside ITS OWN window enqueue.
    await setCursor("minute-sweep", "2026-09-08T15:00:00.000Z");
    const reports = await tickSchedules(db, clockAt("2026-09-08T16:00:00.000Z"), definitions, [minuteSweep], { memory });

    expect(reports[0]!.enqueued).toEqual([
      "2026-09-08T15:56:00.000Z",
      "2026-09-08T15:57:00.000Z",
      "2026-09-08T15:58:00.000Z",
      "2026-09-08T15:59:00.000Z",
      "2026-09-08T16:00:00.000Z",
    ]);
    expect(reports[0]!.droppedBeforeWindow).toBe(55);
    expect(await db.select().from(jobs)).toHaveLength(5);
  });

  it("a warm instance evaluates from memory: a tick with no fire due issues ZERO statements", async () => {
    // Neon cost audit finding 1: the cursor read-and-write per schedule per minute was 18 of the
    // 20 idle statements. The first tick (cold) reads the cursor; the second one, a minute later
    // with no Tuesday fire in between, must not touch Postgres at all.
    await setCursor("season-week-tue-data", "2026-09-08T13:00:00.000Z");
    const memory = createScheduleMemory();
    await tickSchedules(db, clockAt("2026-09-08T16:00:00.000Z"), definitions, tueOnly, { memory });

    const statements = await recordStatements(db, (logged) =>
      tickSchedules(logged, clockAt("2026-09-08T16:01:00.000Z"), definitions, tueOnly, { memory }),
    );
    expect(statements).toEqual([]);
  });

  it("a cold instance reads every unknown cursor in ONE statement and writes nothing when nothing fired", async () => {
    await setCursor("season-week-tue-data", "2026-09-08T13:00:00.000Z");
    await setCursor("season-week-wed-data", "2026-09-08T13:00:00.000Z");
    const two = SCHEDULES.filter((s) => s.name === "season-week-tue-data" || s.name === "season-week-wed-data");
    const statements = await recordStatements(db, (logged) =>
      tickSchedules(logged, clockAt("2026-09-08T16:00:00.000Z"), definitions, two, { memory: createScheduleMemory() }),
    );
    expect(statements).toHaveLength(1);
    expect(statements[0]).toMatch(/select .* from "schedule_cursors"/);
  });

  it("a fire remembered in memory still writes the cursor row, so a cold instance later starts from it", async () => {
    await setCursor("season-week-tue-data", "2026-09-08T11:00:00.000Z");
    const memory = createScheduleMemory();
    await tickSchedules(db, clockAt("2026-09-08T11:30:00.000Z"), definitions, tueOnly, { memory });
    const reports = await tickSchedules(db, clockAt("2026-09-08T12:00:30.000Z"), definitions, tueOnly, { memory });
    expect(reports[0]!.enqueued).toEqual(["2026-09-08T12:00:00.000Z"]);
    const cursor = await db.select().from(scheduleCursors).where(eq(scheduleCursors.scheduleName, "season-week-tue-data"));
    expect(cursor[0]!.lastEvaluatedAt.toISOString()).toBe("2026-09-08T12:00:30.000Z");
  });

  it("an enqueued fire registers the job's wake instant, so the claim gate sees it", async () => {
    await setCursor("season-week-tue-data", "2026-09-08T11:00:00.000Z");
    const wake = createMemoryWakeSet();
    await tickSchedules(db, clockAt("2026-09-08T12:00:30.000Z"), definitions, tueOnly, { memory: createScheduleMemory(), wake });
    const [row] = await db.select({ id: jobs.id }).from(jobs);
    const due = await wake.due(Date.parse("2026-09-08T12:00:00.000Z"));
    expect(due.members).toEqual([wakeMember.job(row!.id)]);
  });

  describe("a gated schedule (the minute draft sweep)", () => {
    const gatedSweep: ScheduleDefinition = {
      name: "gated-sweep",
      cron: "* * * * *",
      expression: parseCronExpression("* * * * *"),
      timezone: "UTC",
      job: "draft-sweep",
      payload: {},
      description: "level-triggered minute schedule behind the wake gate",
      catchUpMs: 5 * 60_000,
      gate: "draft-attention",
    };
    const sentinelOnly = classifyWakeDue([], true);
    const sweepDue = classifyWakeDue([WAKE_MEMBERS.sweepSafety], true);

    it("does not fire — and touches nothing — while the wake set says no draft owes work", async () => {
      await setCursor("gated-sweep", "2026-09-08T15:00:00.000Z");
      const memory = createScheduleMemory();
      await tickSchedules(db, clockAt("2026-09-08T16:00:00.000Z"), definitions, [gatedSweep], { memory, wakeDue: sentinelOnly });
      const statements = await recordStatements(db, (logged) =>
        tickSchedules(logged, clockAt("2026-09-08T16:01:00.000Z"), definitions, [gatedSweep], { memory, wakeDue: sentinelOnly }),
      );
      expect(statements).toEqual([]);
      expect(await db.select().from(jobs)).toHaveLength(0);
    });

    it("reports the held-back fire as gatedOff rather than pretending nothing was due", async () => {
      await setCursor("gated-sweep", "2026-09-08T15:59:00.000Z");
      const [report] = await tickSchedules(db, clockAt("2026-09-08T16:00:00.000Z"), definitions, [gatedSweep], {
        memory: createScheduleMemory(),
        wakeDue: sentinelOnly,
      });
      expect(report).toMatchObject({ gatedOff: true, enqueued: [] });
    });

    it("fires exactly ONE sweep (the latest due minute) when the gate opens after a quiet hour", async () => {
      // Level-triggered: the caught-up run does the work of every skipped minute, so replaying
      // the five minutes inside the catch-up window would be four queued no-ops.
      await setCursor("gated-sweep", "2026-09-08T15:00:00.000Z");
      const [report] = await tickSchedules(db, clockAt("2026-09-08T16:00:00.000Z"), definitions, [gatedSweep], {
        memory: createScheduleMemory(),
        wakeDue: sweepDue,
      });
      expect(report!.enqueued).toEqual(["2026-09-08T16:00:00.000Z"]);
      expect(await db.select().from(jobs)).toHaveLength(1);
    });

    it("stays ungated when no wake reading was supplied (a direct caller, fail open)", async () => {
      await setCursor("gated-sweep", "2026-09-08T15:59:00.000Z");
      const [report] = await tickSchedules(db, clockAt("2026-09-08T16:00:00.000Z"), definitions, [gatedSweep], { memory: createScheduleMemory() });
      expect(report!.enqueued).toEqual(["2026-09-08T16:00:00.000Z"]);
    });
  });

  it("refuses a schedule naming an unregistered job", async () => {
    const rogue: ScheduleDefinition = {
      name: "rogue",
      cron: "0 8 * * 2",
      expression: parseCronExpression("0 8 * * 2"),
      timezone: "America/New_York",
      job: "not-a-job",
      payload: {},
      description: "should never ship",
    };
    await expect(tickSchedules(db, clockAt("2026-09-08T16:00:00.000Z"), definitions, [rogue])).rejects.toThrow(
      'names unregistered job "not-a-job"',
    );
  });
});
