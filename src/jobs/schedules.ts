// THE SCHEDULES — config in code, not rows. Each entry is one cron expression in one IANA zone
// firing one registered job. Parsed at module load, so a typo fails the build's first import of
// this file rather than silently never firing.
//
// These three ARE the old crontab (scripts/install-season-cron.sh), hour for hour. The installer
// assumed America/New_York — the brief's own "check what it assumed" — and the schedules keep the
// installed reality rather than re-deciding the wall clock; see the spec's judgment calls.
import type { JsonObject } from "@/domain/audit";
import { parseCronExpression, type CronExpression } from "./cron";

export interface ScheduleDefinition {
  /** Unique name — half of every fire's idempotency key (`<name>@<fireInstant>`). */
  readonly name: string;
  readonly cron: string;
  readonly expression: CronExpression;
  readonly timezone: string;
  /** The registry key of the job one fire enqueues. */
  readonly job: string;
  readonly payload: JsonObject;
  /** One line for the admin page — what an operator scanning the schedule list needs. */
  readonly description: string;
  /**
   * This schedule's own catch-up window, overriding `JOBS_CONFIG.maxCatchUpMs`. A minute-cadence,
   * LEVEL-TRIGGERED schedule (the draft sweep) sets this small: one caught-up run does the work
   * of every older missed one, and replaying a slept-through hour as sixty queued no-ops would be
   * queue noise, not recovery — the identical reasoning `maxCatchUpMs`'s own docblock records at
   * the week scale. Omit for the cadence jobs, which keep the global window.
   */
  readonly catchUpMs?: number;
}

function schedule(definition: Omit<ScheduleDefinition, "expression">): ScheduleDefinition {
  return { ...definition, expression: parseCronExpression(definition.cron) };
}

export const SCHEDULES: readonly ScheduleDefinition[] = [
  schedule({
    name: "season-week-tue-data",
    cron: "0 8 * * 2",
    timezone: "America/New_York",
    job: "season-week",
    payload: {},
    description: "Tuesday 08:00 ET data pass. Monday night stats are settled, so this grades the week just played.",
  }),
  schedule({
    name: "season-week-wed-data",
    cron: "0 18 * * 3",
    timezone: "America/New_York",
    job: "season-week",
    payload: {},
    description: "Wednesday 18:00 ET data pass. Mid-week props refresh, lines firmer than at week open.",
  }),
  schedule({
    name: "season-week-thu-freeze",
    cron: "0 14 * * 4",
    timezone: "America/New_York",
    job: "season-week",
    payload: {},
    description: "Thursday 14:00 ET freeze pass. Hours of margin before the week's first kickoff.",
  }),
  schedule({
    name: "draft-sweep-minutely",
    cron: "* * * * *",
    timezone: "UTC",
    job: "draft-sweep",
    payload: {},
    description: "Every minute: start due drafts and advance abandoned rooms — the serverless drivers' backstop.",
    // Level-triggered, so one caught-up sweep does the work of every missed one; replaying a
    // slept-through hour would be sixty queued no-ops (see `ScheduleDefinition.catchUpMs`).
    catchUpMs: 5 * 60_000,
  }),
  schedule({
    name: "adp-snapshot-nightly",
    cron: "0 3 * * *",
    timezone: "America/New_York",
    job: "adp-snapshot",
    payload: {},
    description: "Nightly 03:00 ET capture of the market ADP feed into the append-only trend archive (Draft HQ phase 4's data, started early).",
  }),
  schedule({
    name: "capsule-sweep-nightly",
    cron: "0 4 * * *",
    timezone: "America/New_York",
    job: "capsule-sweep",
    payload: {},
    description: "Nightly 04:00 ET pass over every board-relevant player: recompute facts, regenerate a capsule wherever the hash moved or the row is missing or still template-sourced.",
  }),
];
