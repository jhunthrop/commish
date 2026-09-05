// THE SCHEDULE TICK — the fire-and-forget cron replacement, with catch-up. Every tick walks each
// schedule's cron matches from its cursor to now and enqueues one idempotent job per fire, which
// is what closes the laptop-asleep hole: a Tuesday 08:00 the machine slept through is computed
// and enqueued the moment any tick next runs. Double ticks and concurrent runners are harmless —
// the fire's idempotency key (`<schedule>@<fireInstant>`) dedupes at the jobs table's unique
// index, and a twice-advanced cursor advances to the same place.
import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { scheduleCursors } from "@/db/schema";
import type { Clock } from "@/domain/timing";
import { JOBS_CONFIG } from "./config";
import type { AnyJobDefinition } from "./contract";
import { fireInstantsBetween } from "./cron";
import { enqueueJob } from "./store";
import { SCHEDULES, type ScheduleDefinition } from "./schedules";

export interface ScheduleTickReport {
  readonly schedule: string;
  /** True on the very first evaluation ever: the cursor is written at `now` and nothing is
   *  enqueued — catch-up starts mattering once the system has been alive. */
  readonly bootstrapped: boolean;
  /** Fire instants enqueued this tick (already-enqueued duplicates excluded). */
  readonly enqueued: readonly string[];
  /** Fires this tick computed but found already enqueued — the harmless double tick, counted so
   *  the report says it happened rather than hiding it. */
  readonly deduped: number;
  /** Fires older than the catch-up window, dropped rather than replayed — see JOBS_CONFIG. */
  readonly droppedBeforeWindow: number;
}

export async function tickSchedules(
  db: Db,
  clock: Clock,
  definitions: ReadonlyMap<string, AnyJobDefinition>,
  schedules: readonly ScheduleDefinition[] = SCHEDULES,
): Promise<readonly ScheduleTickReport[]> {
  const reports: ScheduleTickReport[] = [];
  for (const schedule of schedules) reports.push(await tickOne(db, clock, definitions, schedule));
  return reports;
}

async function tickOne(
  db: Db,
  clock: Clock,
  definitions: ReadonlyMap<string, AnyJobDefinition>,
  schedule: ScheduleDefinition,
): Promise<ScheduleTickReport> {
  const definition = definitions.get(schedule.job);
  if (definition === undefined) {
    // A schedule naming a job the registry does not carry is a config bug; failing the tick
    // loudly beats silently never firing (the registry test pins this can't ship).
    throw new Error(`schedule "${schedule.name}" names unregistered job "${schedule.job}".`);
  }

  const now = new Date(clock.now());
  const cursorRows = await db.select().from(scheduleCursors).where(eq(scheduleCursors.scheduleName, schedule.name));
  const cursor = cursorRows[0];

  if (cursor === undefined) {
    await db
      .insert(scheduleCursors)
      .values({ scheduleName: schedule.name, lastEvaluatedAt: now })
      .onConflictDoNothing({ target: scheduleCursors.scheduleName });
    return { schedule: schedule.name, bootstrapped: true, enqueued: [], deduped: 0, droppedBeforeWindow: 0 };
  }

  const windowFloor = new Date(now.getTime() - (schedule.catchUpMs ?? JOBS_CONFIG.maxCatchUpMs));
  const start = cursor.lastEvaluatedAt.getTime() > windowFloor.getTime() ? cursor.lastEvaluatedAt : windowFloor;
  const dropped =
    cursor.lastEvaluatedAt.getTime() < windowFloor.getTime()
      ? fireInstantsBetween(schedule.expression, schedule.timezone, cursor.lastEvaluatedAt, windowFloor).length
      : 0;

  const fires = fireInstantsBetween(schedule.expression, schedule.timezone, start, now);
  const enqueued: string[] = [];
  const results = [];
  for (const fire of fires) {
    results.push(
      await enqueueJob(db, clock, {
        name: schedule.job,
        idempotencyKey: `${schedule.name}@${fire.toISOString()}`,
        // Fix round 1, MEDIUM 2: every schedule-born job's payload carries its OWN fire instant
        // (`firedAt`) alongside whatever the schedule itself always sends — the same instant the
        // idempotency key already embeds, now reachable from INSIDE the job step too. A job whose
        // own work must be stamped with "when" (the ADP snapshot's `capturedAt`) reads this
        // instead of the wall clock, so a same-night retry of the identical fire always computes
        // the identical stamp rather than a fresh one. `schedule.payload`'s own keys always win on
        // collision (spread order), though no schedule today defines a `firedAt` of its own.
        payload: { ...schedule.payload, firedAt: fire.toISOString() },
        maxAttempts: definition.maxAttempts,
        runAt: fire,
        scheduleName: schedule.name,
        scheduledFor: fire,
      }),
    );
    if (results[results.length - 1]!.enqueued) enqueued.push(fire.toISOString());
  }

  await db.update(scheduleCursors).set({ lastEvaluatedAt: now }).where(eq(scheduleCursors.scheduleName, schedule.name));
  return {
    schedule: schedule.name,
    bootstrapped: false,
    enqueued,
    deduped: fires.length - enqueued.length,
    droppedBeforeWindow: dropped,
  };
}
