import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { jobs, scheduleCursors } from "@/db/schema";
import { createTestDb, truncateAll, truncateJobTables } from "@/db/test-db";
import type { Clock } from "@/domain/timing";
import { defineJob, type AnyJobDefinition } from "./contract";
import { tickSchedules } from "./schedule";
import { SCHEDULES } from "./schedules";
import type { ScheduleDefinition } from "./schedules";
import { parseCronExpression } from "./cron";

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
const definitions: ReadonlyMap<string, AnyJobDefinition> = new Map([["season-week", noopDefinition]]);

/** Just the Tuesday schedule, so fire counts in tests are one schedule's worth. */
const tueOnly: readonly ScheduleDefinition[] = [SCHEDULES.find((s) => s.name === "season-week-tue-data")!];

async function setCursor(name: string, iso: string): Promise<void> {
  await db.insert(scheduleCursors).values({ scheduleName: name, lastEvaluatedAt: new Date(iso) });
}

beforeEach(async () => {
  await truncateAll(db);
  await truncateJobTables(db);
});

describe("tickSchedules", () => {
  it("bootstraps a never-seen schedule: cursor written, nothing enqueued", async () => {
    const reports = await tickSchedules(db, clockAt("2026-09-08T16:00:00.000Z"), definitions, tueOnly);
    expect(reports).toEqual([
      { schedule: "season-week-tue-data", bootstrapped: true, enqueued: [], deduped: 0, droppedBeforeWindow: 0 },
    ]);
    expect(await db.select().from(jobs)).toHaveLength(0);
    const cursor = await db.select().from(scheduleCursors);
    expect(cursor[0]!.lastEvaluatedAt.toISOString()).toBe("2026-09-08T16:00:00.000Z");
  });

  it("enqueues the missed fire after a laptop-asleep gap, and advances the cursor", async () => {
    // Cursor last saw Monday evening; the machine slept through Tuesday 08:00 ET (12:00Z).
    await setCursor("season-week-tue-data", "2026-09-07T22:00:00.000Z");
    const reports = await tickSchedules(db, clockAt("2026-09-08T16:00:00.000Z"), definitions, tueOnly);

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
    const reports = await tickSchedules(db, clockAt("2026-09-08T16:00:00.000Z"), definitions, SCHEDULES);
    const bySchedule = new Map(reports.map((report) => [report.schedule, report]));
    expect(bySchedule.get("season-week-tue-data")!.enqueued).toEqual(["2026-09-08T12:00:00.000Z"]);
    // The Wednesday and Thursday schedules had no cursor yet: bootstrapped, nothing enqueued.
    expect(bySchedule.get("season-week-wed-data")!.bootstrapped).toBe(true);
    expect(bySchedule.get("season-week-thu-freeze")!.bootstrapped).toBe(true);
  });

  it("dedupes a double tick: same fire, second enqueue is a no-op", async () => {
    await setCursor("season-week-tue-data", "2026-09-08T00:00:00.000Z");
    await tickSchedules(db, clockAt("2026-09-08T16:00:00.000Z"), definitions, tueOnly);

    // Rewind the cursor as if a concurrent runner had read the old value — its enqueue must
    // dedupe against the fire the first tick already wrote.
    await db
      .update(scheduleCursors)
      .set({ lastEvaluatedAt: new Date("2026-09-08T00:00:00.000Z") })
      .where(eq(scheduleCursors.scheduleName, "season-week-tue-data"));
    const reports = await tickSchedules(db, clockAt("2026-09-08T16:00:00.000Z"), definitions, tueOnly);

    expect(reports[0]!.enqueued).toEqual([]);
    expect(reports[0]!.deduped).toBe(1);
    expect(await db.select().from(jobs)).toHaveLength(1);
  });

  it("drops fires older than the catch-up window instead of replaying a month", async () => {
    // Cursor a month back: four Tuesday fires missed, only the one inside 7 days is enqueued.
    await setCursor("season-week-tue-data", "2026-08-08T00:00:00.000Z");
    const reports = await tickSchedules(db, clockAt("2026-09-08T16:00:00.000Z"), definitions, tueOnly);

    expect(reports[0]!.enqueued).toEqual(["2026-09-08T12:00:00.000Z"]);
    expect(reports[0]!.droppedBeforeWindow).toBe(4); // Aug 11, 18, 25, Sep 1
    expect(await db.select().from(jobs)).toHaveLength(1);
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
