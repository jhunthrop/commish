// THE ADMIN PAGE'S READS — everything `/app/admin/jobs` renders, and nothing any runner calls.
// Failures first is the point of the page: `failed` and `abandoned` are the dead-letter states,
// and the contract says they must be impossible to miss.
import { desc, eq, inArray } from "drizzle-orm";
import type { Db } from "@research-ts/db/client";
import { jobRuns, jobs, scheduleCursors } from "@/db/schema";
import { JOBS_CONFIG } from "./config";
import { SCHEDULES, type ScheduleDefinition } from "./schedules";

export interface DeadLetterRow {
  readonly jobId: number;
  readonly name: string;
  readonly status: "failed" | "abandoned";
  readonly attempts: number;
  readonly maxAttempts: number;
  readonly lastError: string | null;
  readonly finishedAt: string | null;
  readonly scheduleName: string | null;
  readonly scheduledFor: string | null;
}

/** Every dead-lettered job, newest first — the page's first section. */
export async function deadLetterJobs(db: Db, limit: number = JOBS_CONFIG.adminRecentRuns): Promise<readonly DeadLetterRow[]> {
  const rows = await db
    .select()
    .from(jobs)
    .where(inArray(jobs.status, ["failed", "abandoned"]))
    .orderBy(desc(jobs.finishedAt), desc(jobs.id))
    .limit(limit);
  return rows.map((row) => ({
    jobId: row.id,
    name: row.name,
    status: row.status === "abandoned" ? "abandoned" : "failed",
    attempts: row.attempts,
    maxAttempts: row.maxAttempts,
    lastError: row.lastError,
    finishedAt: row.finishedAt?.toISOString() ?? null,
    scheduleName: row.scheduleName,
    scheduledFor: row.scheduledFor?.toISOString() ?? null,
  }));
}

export interface ScheduleStatusRow {
  readonly name: string;
  readonly cron: string;
  readonly timezone: string;
  readonly job: string;
  readonly description: string;
  /** Where the catch-up walk has evaluated to; null before the first tick ever. */
  readonly cursor: string | null;
  /** The most recent fire this schedule enqueued, with the job it became. */
  readonly lastFire: { readonly at: string; readonly jobId: number; readonly jobStatus: string } | null;
}

export async function scheduleStatuses(db: Db, schedules: readonly ScheduleDefinition[] = SCHEDULES): Promise<readonly ScheduleStatusRow[]> {
  const cursors = new Map(
    (await db.select().from(scheduleCursors)).map((row) => [row.scheduleName, row.lastEvaluatedAt.toISOString()]),
  );
  const statuses: ScheduleStatusRow[] = [];
  for (const schedule of schedules) {
    const fires = await db
      .select({ id: jobs.id, scheduledFor: jobs.scheduledFor, status: jobs.status })
      .from(jobs)
      .where(eq(jobs.scheduleName, schedule.name))
      .orderBy(desc(jobs.scheduledFor))
      .limit(1);
    const fire = fires[0];
    statuses.push({
      name: schedule.name,
      cron: schedule.cron,
      timezone: schedule.timezone,
      job: schedule.job,
      description: schedule.description,
      cursor: cursors.get(schedule.name) ?? null,
      lastFire:
        fire?.scheduledFor == null ? null : { at: fire.scheduledFor.toISOString(), jobId: fire.id, jobStatus: fire.status },
    });
  }
  return statuses;
}

export interface RecentRunRow {
  readonly runId: number;
  readonly jobId: number;
  readonly name: string;
  readonly attempt: number;
  readonly status: string;
  readonly startedAt: string;
  readonly finishedAt: string | null;
  readonly error: string | null;
  readonly errorKind: string | null;
}

export async function recentRuns(db: Db, limit: number = JOBS_CONFIG.adminRecentRuns): Promise<readonly RecentRunRow[]> {
  const rows = await db
    .select({
      runId: jobRuns.id,
      jobId: jobRuns.jobId,
      name: jobs.name,
      attempt: jobRuns.attempt,
      status: jobRuns.status,
      startedAt: jobRuns.startedAt,
      finishedAt: jobRuns.finishedAt,
      error: jobRuns.error,
      errorKind: jobRuns.errorKind,
    })
    .from(jobRuns)
    .innerJoin(jobs, eq(jobRuns.jobId, jobs.id))
    .orderBy(desc(jobRuns.startedAt), desc(jobRuns.id))
    .limit(limit);
  return rows.map((row) => ({
    ...row,
    startedAt: row.startedAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null,
  }));
}
