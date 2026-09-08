// THE SCHEDULES — config in code, not rows. Each entry is one cron expression in one IANA zone
// firing one registered job. Parsed at module load, so a typo fails the build's first import of
// this file rather than silently never firing.
//
// These three ARE the old crontab (scripts/install-season-cron.sh), hour for hour. The installer
// assumed America/New_York — the brief's own "check what it assumed" — and the schedules keep the
// installed reality rather than re-deciding the wall clock; see the spec's judgment calls.
import type { JsonObject } from "@/domain/audit";
import { HARVEST_CONFIG } from "@/projections/harvest-config";
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
  /**
   * The wake gate this schedule fires behind (Neon cost audit 2026-09-07, finding 1). A gated
   * schedule is LEVEL-TRIGGERED by definition: its fire is held back while the wake set
   * (`wake.ts`) says its reason is not due, and when the gate opens only the latest due instant
   * is enqueued, because one run does the work of every skipped minute. `"draft-attention"` opens
   * whenever a draft registered a wake instant that has passed, the earliest scheduled kickoff
   * has passed, the safety marker is due, or the wake set cannot be read. Omit for the cadence
   * jobs, which always fire.
   */
  readonly gate?: "draft-attention";
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
    // The minute cadence stays (Vercel's floor); the wake gate is what keeps an idle minute from
    // touching Postgres at all — see `ScheduleDefinition.gate`.
    gate: "draft-attention",
  }),
  schedule({
    // THE CADENCE LIVES IN `HARVEST_CONFIG` (peek document design §3.4), with the provider's own
    // daily request budget stated beside it. This feed is polled rather than event-driven because
    // the provider offers no push, and the rate is what decides how long an injury designation can
    // sit stale on a player card.
    name: "capture-harvest-hourly",
    cron: HARVEST_CONFIG.cron,
    timezone: HARVEST_CONFIG.timezone,
    job: "capture-harvest",
    payload: {},
    description:
      `Hourly through the waking hours, plus the 02:00 ET pre-dawn fire the 03:00/03:30/04:00 ET passes depend on: captures injuries, news, depth charts, inactives and betting odds into the append-only capture_snapshots archive that player cards and capsules read facts from, and enqueues a peek-document rebuild for every player whose designation or headlines moved. ${HARVEST_CONFIG.requestsPerDay} upstream requests a day at the worst case.`,
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
    name: "props-preseason-snapshot-daily",
    cron: "30 3 * * *",
    timezone: "America/New_York",
    job: "props-preseason-snapshot",
    payload: {},
    description:
      "Daily 03:30 ET capture of pre-kickoff player props into the archive the props anchor's leakage gate reads from. Self-disables (no network call, no credit spend) once the product season's own first kickoff has passed.",
  }),
  schedule({
    name: "win-totals-weekly",
    cron: "0 5 * * 3",
    timezone: "America/New_York",
    job: "win-totals",
    payload: {},
    description:
      "Wednesday 05:00 ET read of the win-totals publisher for the product season. Year-round on purpose: the job itself skips once that season has kicked off (no fetch, no write), so the season-open post is caught the week it lands without a schedule edited by hand every August.",
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
