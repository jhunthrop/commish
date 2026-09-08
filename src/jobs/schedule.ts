// THE SCHEDULE TICK — the fire-and-forget cron replacement, with catch-up. Every tick walks each
// schedule's cron matches from its cursor to now and enqueues one idempotent job per fire, which
// is what closes the laptop-asleep hole: a Tuesday 08:00 the machine slept through is computed
// and enqueued the moment any tick next runs. Double ticks and concurrent runners are harmless —
// the fire's idempotency key (`<schedule>@<fireInstant>`) dedupes at the jobs table's unique
// index, and a twice-advanced cursor advances to the same place.
//
// EVALUATED IN MEMORY FIRST (Neon cost audit 2026-09-07, finding 1). The cursor row used to be
// read and rewritten for every schedule on every tick — eighteen of the twenty statements an idle
// minute cost, and the reason Neon's compute never suspended. A warm instance now remembers the
// instant it last evaluated each schedule through and walks the cron predicate from there with no
// query at all; the row is read only by a cold instance (one statement for every schedule it has
// not seen) and written only when a fire is enqueued. That is safe because the walk is a pure
// function of the cron expression: an instance that verified "no fire between then and now" can
// start its next walk from now, and a colder cursor only ever yields a superset of fires, every
// extra one deduped by its idempotency key. The row therefore never lags further than the
// schedule's own last fire, so a cold instance starts exactly where the last fire left it.
import { eq, inArray } from "drizzle-orm";
import type { Db } from "@/db/client";
import { scheduleCursors } from "@/db/schema";
import type { Clock } from "@/domain/timing";
import { JOBS_CONFIG } from "./config";
import type { AnyJobDefinition } from "./contract";
import { fireInstantsBetween } from "./cron";
import { enqueueJob } from "./store";
import { SCHEDULES, type ScheduleDefinition } from "./schedules";
import { wakeSet, type WakeDue, type WakeSet } from "./wake";

export interface ScheduleTickReport {
  readonly schedule: string;
  /** True on the very first evaluation ever: the cursor is written at `now` and nothing is
   *  enqueued — catch-up starts mattering once the system has been alive. */
  readonly bootstrapped: boolean;
  /** True when a fire was due but the schedule's wake gate held it back (see `ScheduleDefinition.gate`). */
  readonly gatedOff: boolean;
  /** Fire instants enqueued this tick (already-enqueued duplicates excluded). */
  readonly enqueued: readonly string[];
  /** Fires this tick computed but found already enqueued — the harmless double tick, counted so
   *  the report says it happened rather than hiding it. */
  readonly deduped: number;
  /** Fires older than the catch-up window, dropped rather than replayed — see JOBS_CONFIG. */
  readonly droppedBeforeWindow: number;
}

/** What one warm instance remembers per schedule: the instant it has evaluated through. */
export interface ScheduleMemory {
  evaluatedThrough(name: string): Date | undefined;
  remember(name: string, through: Date): void;
}

export function createScheduleMemory(): ScheduleMemory {
  const through = new Map<string, Date>();
  return {
    evaluatedThrough: (name) => through.get(name),
    remember: (name, at) => {
      through.set(name, at);
    },
  };
}

/** The process-wide memory — one per warm instance, which is exactly its lifetime. */
const processMemory = createScheduleMemory();

export interface ScheduleTickDeps {
  /** Defaults to the process-wide memory; tests hand in a fresh one to play a cold instance. */
  readonly memory?: ScheduleMemory;
  /** Where an enqueued fire registers its wake instant. Defaults to the installed set. */
  readonly wake?: WakeSet;
  /** This tick's wake reading, read once by the runner. Absent means every gate is open. */
  readonly wakeDue?: WakeDue;
}

export async function tickSchedules(
  db: Db,
  clock: Clock,
  definitions: ReadonlyMap<string, AnyJobDefinition>,
  schedules: readonly ScheduleDefinition[] = SCHEDULES,
  deps: ScheduleTickDeps = {},
): Promise<readonly ScheduleTickReport[]> {
  const memory = deps.memory ?? processMemory;
  const wake = deps.wake ?? wakeSet();
  const now = new Date(clock.now());
  for (const schedule of schedules) assertRegistered(definitions, schedule);

  const cold = schedules.filter((schedule) => memory.evaluatedThrough(schedule.name) === undefined);
  const cursors = await readCursors(db, cold);

  const reports: ScheduleTickReport[] = [];
  for (const schedule of schedules) {
    const remembered = memory.evaluatedThrough(schedule.name);
    const cursor = remembered ?? cursors.get(schedule.name);
    if (cursor === undefined) {
      reports.push(await bootstrap(db, schedule, now));
    } else {
      reports.push(await evaluate({ db, wake, clock, definitions, schedule, from: cursor, now, gateOpen: gateOpen(schedule, deps.wakeDue) }));
    }
    memory.remember(schedule.name, now);
  }
  return reports;
}

function assertRegistered(definitions: ReadonlyMap<string, AnyJobDefinition>, schedule: ScheduleDefinition): void {
  if (definitions.has(schedule.job)) return;
  // A schedule naming a job the registry does not carry is a config bug; failing the tick
  // loudly beats silently never firing (the registry test pins this can't ship).
  throw new Error(`schedule "${schedule.name}" names unregistered job "${schedule.job}".`);
}

/** One statement for every schedule this instance has not evaluated yet; none when it has seen all. */
async function readCursors(db: Db, cold: readonly ScheduleDefinition[]): Promise<ReadonlyMap<string, Date>> {
  if (cold.length === 0) return new Map();
  const rows = await db
    .select()
    .from(scheduleCursors)
    .where(inArray(scheduleCursors.scheduleName, cold.map((schedule) => schedule.name)));
  return new Map(rows.map((row) => [row.scheduleName, row.lastEvaluatedAt]));
}

async function bootstrap(db: Db, schedule: ScheduleDefinition, now: Date): Promise<ScheduleTickReport> {
  await db
    .insert(scheduleCursors)
    .values({ scheduleName: schedule.name, lastEvaluatedAt: now })
    .onConflictDoNothing({ target: scheduleCursors.scheduleName });
  return { schedule: schedule.name, bootstrapped: true, gatedOff: false, enqueued: [], deduped: 0, droppedBeforeWindow: 0 };
}

/** A schedule with no gate is always open; a gated one is open when the wake reading (or its
 *  absence — a direct caller, fail open) says its reason is due. */
function gateOpen(schedule: ScheduleDefinition, wakeDue: WakeDue | undefined): boolean {
  if (schedule.gate === undefined || wakeDue === undefined) return true;
  return wakeDue.sweep;
}

interface Evaluation {
  readonly db: Db;
  readonly wake: WakeSet;
  readonly clock: Clock;
  readonly definitions: ReadonlyMap<string, AnyJobDefinition>;
  readonly schedule: ScheduleDefinition;
  readonly from: Date;
  readonly now: Date;
  readonly gateOpen: boolean;
}

async function evaluate({ db, wake, clock, definitions, schedule, from, now, gateOpen }: Evaluation): Promise<ScheduleTickReport> {
  const windowFloor = new Date(now.getTime() - (schedule.catchUpMs ?? JOBS_CONFIG.maxCatchUpMs));
  const start = from.getTime() > windowFloor.getTime() ? from : windowFloor;
  const dropped = from.getTime() < windowFloor.getTime() ? fireInstantsBetween(schedule.expression, schedule.timezone, from, windowFloor).length : 0;
  const allFires = fireInstantsBetween(schedule.expression, schedule.timezone, start, now);
  const quiet = { schedule: schedule.name, bootstrapped: false, gatedOff: false, enqueued: [], deduped: 0, droppedBeforeWindow: dropped };
  if (allFires.length === 0) return quiet;
  if (!gateOpen) return { ...quiet, gatedOff: true };

  // A gated schedule is level-triggered by definition: one run does the work of every skipped
  // minute, so only the latest due instant is enqueued.
  const fires = schedule.gate === undefined ? allFires : allFires.slice(-1);
  const definition = definitions.get(schedule.job)!;
  const enqueued: string[] = [];
  for (const fire of fires) {
    const result = await enqueueJob(
      db,
      clock,
      {
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
      },
      wake,
    );
    if (result.enqueued) enqueued.push(fire.toISOString());
  }

  await db.update(scheduleCursors).set({ lastEvaluatedAt: now }).where(eq(scheduleCursors.scheduleName, schedule.name));
  return { ...quiet, enqueued, deduped: fires.length - enqueued.length };
}
