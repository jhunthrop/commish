# Job System Design (2026-09-02)

Founder directive: "build all of our jobs into a proper job management system that can work on
Vercel. We shouldn't plan on this laptop supporting any part of our work long term." No-MVP rule
applies: this is the end-state system, not a stopgap.

Architecture decision (made upstream, refined here, not relitigated): a Postgres-backed durable
job system we own, with a thin runner seam so the SAME jobs run under (a) a long-lived local
runner during the data year and (b) Vercel Cron tick endpoints when deployed live. No external
orchestration SaaS. Our steps are already idempotent, `FOR UPDATE SKIP LOCKED` queues are
battle-tested, and owning the core keeps us deployment-agnostic.

## 1. Inventory of scheduled and background work

### Cron-run today (the three crontab entries, `scripts/install-season-cron.sh`)

All three run `npm run season:week` (`scripts/season-week.ts` -> `scripts/season-week-steps.ts`,
five steps: stats-ingest, props-snapshot, grade, freeze, scoreboard). The installer's own header
says the times assume the crontab runs in **America/New_York** (not Chicago; the brief said to
check, and this is what the installed file assumed):

| Fire | Cron | Purpose |
|---|---|---|
| Tuesday 08:00 ET | `0 8 * * 2` | data pass: stats just settled, grade the played week |
| Wednesday 18:00 ET | `0 18 * * 3` | data pass: mid-week props refresh |
| Thursday 14:00 ET | `0 14 * * 4` | freeze pass: hours before Thursday kickoff |

**Migration: fully migrated.** Three code-defined schedules enqueue the one `season-week` job.
The crontab block is removed by the new installer (run by the controller after merge, never from
this worktree).

### Scripts that are recurring-shaped but operator-triggered (stay CLI scripts, by design)

- `scripts/odds-props-snapshot.ts` — its weekly recurrence is ALREADY inside season-week (step 2
  calls `runOddsSnapshot` directly). No second schedule: the crontab never had one either, and a
  separate props schedule would double-spend metered credits. The standalone npm script stays for
  operator-initiated snapshots.
- `scripts/preseason-persist.ts` — annual, run once per season on kickoff eve, and its output is
  operator-reviewed before the season leans on it. Not a schedule; putting an annual
  human-reviewed act on an unattended runner adds risk, not durability.
- `scripts/projection-backfill.ts`, `odds-props-backfill.ts`, the fit/report/diagnose family,
  `preseason-ingest.ts`, `ingest-adp.ts`, `ingest-schedule.ts`, `vegas-win-totals-ingest.ts`,
  `schedule-results-ingest.ts` — annual or one-off operator tools, each with its own review step
  and (for backfills) real credit spend. Same reasoning; they stay scripts.

### In-process background work (stays in-process; recorded here per the brief)

- **Draft ticker** (`src/draft-service/ticker.ts`, started by `src/instrumentation.ts`): expires
  draft pick clocks, auto-starts due drafts, drives mock rooms, sweeps expired mocks, keeps the
  house catalog stocked. Stays: it needs second-level latency (a pick clock expiring 59 seconds
  late is a broken draft), and Vercel Cron's floor is one minute. It is a live-serving component
  of the app process, already interval-driven with an injected clock and its own tests. On a
  future Vercel deployment this is a known open question for the DRAFT feature (likely a
  dedicated always-on compute or realtime service), not a job-system gap: a durable queue's
  contract (at-least-once, minute-level) is the wrong shape for a countdown clock.
- **Stats ingestion worker** (`src/stats-pipeline/worker.ts`, same instrumentation start): live
  Sunday scoring ticks. Same reasoning: sub-minute cadence during live games, tied to Redis
  publish and the serving process's score cache. Stays in-process.
- **Nudge scheduler / auto-lineup** — invoked from the ticker, covered by the same call.

Nothing else in `src/` holds a `setInterval` background loop (the remaining hits are UI timers,
draft mutexes, and test helpers).

## 2. Schema (Drizzle migration, `src/db/schema.ts`)

Four tables plus one enum. Naming and doc-comment conventions follow the register tables.

- `job_status` enum: `pending | running | succeeded | failed | abandoned`.
  - `failed` and `abandoned` are TERMINAL, dead-letter states — loud by construction: the admin
    page lists them first, and the runner prints a `DEAD-LETTER` banner line when one is reached.
- `jobs` — the queue row (the ONE mutable row per job; every transition is a claim about "now",
  not history):
  - `id` bigserial PK, `name` text (registry key), `idempotency_key` text UNIQUE,
    `payload` jsonb, `status` job_status, `attempts` int (started attempts),
    `max_attempts` int, `run_at` timestamptz (when next eligible), `claimed_by` text null,
    `heartbeat_at` timestamptz null, `schedule_name` text null, `scheduled_for` timestamptz null
    (the fire instant, for schedule-born jobs), `last_error` text null, `created_at`,
    `finished_at` timestamptz null.
  - Index on `(status, run_at)` for the claim scan; `idempotency_key` unique makes double
    enqueues (double ticks, concurrent runners) harmless.
- `job_runs` — append-only attempt history. One row per attempt: `id`, `job_id` FK, `attempt`,
  `status` (running/succeeded/failed/abandoned), `started_at`, `finished_at` null,
  `error` text null, `error_kind` text null (`retryable | terminal | timeout | crash`),
  `claimed_by` text. A DB trigger (audit-spine precedent, migration 0019) forbids DELETE always
  and UPDATE once `status <> 'running'`: the current attempt may finish itself exactly once;
  finished history is immutable.
- `job_run_steps` — append-only checkpoint log: `id`, `job_id`, `run_id`, `step` text,
  `completed_at`, `detail` jsonb null. Unique `(job_id, step)` — a completed step is completed
  for the JOB, across attempts; resume queries this set and skips. Same trigger discipline
  (no UPDATE, no DELETE).
- `schedule_cursors` — one row per schedule name: `schedule_name` text PK,
  `last_evaluated_at` timestamptz. A cursor is a bookmark, not history; it moves forward.

## 3. Job contract (`src/jobs/contract.ts`)

```ts
interface JobDefinition<P> {
  name: string;
  steps: readonly JobStep<P>[];      // named, idempotent, run in order
  maxAttempts: number;
  timeoutMs: number;                  // per-attempt budget
  backoff: BackoffPolicy;             // { baseMs, maxMs } exponential + full jitter
}
interface JobStep<P> { name: string; run(ctx: JobStepContext, payload: P): Promise<StepOutcome>; }
```

- **A job is a sequence of named idempotent steps.** Completed steps append a `job_run_steps` row;
  a retry or a resume across Vercel ticks skips every recorded step and continues from the first
  unrecorded one. This is what makes a long job survivable inside a bounded serverless function.
- **Terminal vs retryable is part of the contract.** A step that throws `TerminalJobError` fails
  the JOB immediately: no retry, status `failed`, dead-letter, loud. Anything else thrown is
  retryable: the attempt's run row is failed, and if `attempts < max_attempts` the job returns to
  `pending` with `run_at = now + backoff(attempt)` (exponential, capped, full jitter); when
  attempts exhaust, the job goes `failed`.
- **The register's gates stay authoritative.** The season-week job maps `takeFreeze`'s
  past-kickoff refusal and the empty-served-board refusal to `TerminalJobError`: retrying a
  freeze until it lands late would be the job system papering over the register's own law.
  A transient DB or network error stays retryable.
- **Timeout**: the executor races the attempt against `timeoutMs`; a timeout fails the attempt as
  retryable (`error_kind: "timeout"`). A crashed process (laptop slept, Vercel function died) is
  caught by heartbeats: `heartbeat_at` refreshes every `JOBS_CONFIG.heartbeatIntervalMs` while
  running; a reclaim pass moves any running job whose heartbeat is older than
  `staleAfterMs(def)` back to `pending` (attempts remaining) or to `abandoned` (exhausted),
  closing the orphaned run row as `abandoned`.

## 4. Claiming (`src/jobs/store.ts`)

One atomic statement:

```sql
UPDATE jobs SET status='running', claimed_by=$worker, heartbeat_at=$now, attempts=attempts+1
WHERE id = (SELECT id FROM jobs WHERE status='pending' AND run_at <= $now
            ORDER BY run_at, id LIMIT 1 FOR UPDATE SKIP LOCKED)
RETURNING ...
```

Two workers can never claim the same job; a worker finding nothing returns null and the tick
moves on. Proven by a contention test (many concurrent claims, all distinct).

## 5. Schedules (`src/jobs/schedules.ts` — config in code, not DB)

```ts
{ name: "season-week-tue-data",   cron: "0 8 * * 2",  timezone: "America/New_York", job: "season-week" }
{ name: "season-week-wed-data",   cron: "0 18 * * 3", timezone: "America/New_York", job: "season-week" }
{ name: "season-week-thu-freeze", cron: "0 14 * * 4", timezone: "America/New_York", job: "season-week" }
```

- **Cron evaluation** (`src/jobs/cron.ts`): a five-field parser (`*`, numbers, comma lists,
  ranges, `*/step`; day-of-month and month supported for completeness) with a minute-resolution
  `matches(expr, instant, timezone)` predicate built on `Intl.DateTimeFormat` — DST-correct
  because each UTC minute is asked what it looks like IN the schedule's zone, rather than the
  zone's offset being hand-computed. No new dependency.
- **Catch-up semantics** (the laptop-asleep fix): a tick loads each schedule's cursor, walks the
  minutes from `max(cursor, now - maxCatchUpMs)` to `now`, and enqueues one job per matching
  minute with `idempotency_key = "<schedule>@<fireInstantISO>"` (`onConflictDoNothing`), then
  advances the cursor. One fire = one idempotent enqueue; double ticks and concurrent runners
  are harmless by the unique key. `maxCatchUpMs` defaults to 7 days: a gap longer than that
  enqueues the fires of the last window rather than replaying a month of identical idempotent
  cadence runs (season-week is idempotent-or-skip, so one catch-up run does the work of all the
  missed ones; the bound exists to keep the walk and the queue sane).
- **Bootstrap**: a schedule with no cursor writes `last_evaluated_at = now` and enqueues nothing;
  catch-up starts mattering once the system has been alive.

## 6. Runners — one seam (`src/jobs/runner.ts`)

`runTick(deps, { budgetMs, maxJobs })` is the whole seam. It: (1) ticks schedules (catch-up
enqueue), (2) reclaims stale running jobs, (3) claims-and-executes jobs until the queue is empty,
`maxJobs` is hit, or the remaining budget is under the next job's `timeoutMs`. Returns a
structured report of everything it did. `deps` carries `db`, `clock` (`src/domain/timing.ts`),
worker id, and a `random` for jitter — all injected.

- **Local runner** (`npm run jobs:runner`, `scripts/jobs-runner.ts`): a long-lived process that
  calls `runTick` every `JOBS_CONFIG.localTickIntervalMs` (30s) with a generous budget. Replaces
  the crontab; kept alive by launchd (below). Logs each tick's report; SIGINT/SIGTERM finish the
  in-flight tick then exit.
- **Vercel tick** (`src/app/api/jobs/tick/route.ts`): `GET`/`POST` guarded by
  `Authorization: Bearer <CRON_SECRET>` with a constant-time compare
  (`crypto.timingSafeEqual` over hashes, so length is not an oracle). Missing/empty `CRON_SECRET`
  in env fails the request loudly (500, logged) — the route never runs unauthenticated. One
  bounded `runTick` per request with `budgetMs` from `JOBS_TICK_BUDGET_MS` (default 50s, sized
  under a Vercel function's duration cap), returning the tick report as JSON. Vercel Cron fires
  it every minute; long jobs make progress via step checkpoints and finish across ticks.

## 7. The season-week job (`src/jobs/defs/season-week-job.ts`)

Five job steps mapping one-to-one onto the cadence's exported step functions (the shape
preserved deliberately). The cadence module moved: `scripts/season-week-steps.ts` is now
`src/jobs/season-week/steps.ts` (its test beside it), because the tick route lives in `src/` and
the repo's eslint boundary forbids `src/**` importing `scripts/**`. It remains the ONE wall-exempt
home of the register orchestration — the exemption moved with the file (`WALL_EXEMPT_FILES`, the
wall test's pinned list, and the eslint quarantine ignores updated in lockstep). The odds
snapshot core moved to `src/projections/odds/snapshot.ts` for the same reason; both CLI scripts
stay as thin wires. The job def imports the STEP functions, a call-through, never the register:

1. `stats-ingest` — `statsIngestStep` with the real nflverse deps. Throws = retryable.
2. `props-snapshot` — `propsSnapshotStep`; its OWN failure is caught and recorded in the step
   detail (`ok: false`), never failing the job — the crontab-era law that a dead ODDS_API_KEY
   must not block the freeze survives the migration. `ODDS_API_KEY` never appears in the
   recorded error.
3. `grade` — `gradeStep`. Throws = retryable (per-week refusals are already detail lines).
4. `freeze` — `freezeStep`, with `takeFreeze` refusals classified: past-kickoff and
   empty-served-board are `TerminalJobError`; anything else retryable.
5. `scoreboard` — `scoreboardStep`, read-only.

Payload: `{ season?: number }`, defaulting via `defaultSeason(clock.now())` at execution time.
Checkpointing means a Vercel tick that dies after `grade` resumes at `freeze`, not at another
paid props snapshot.

Wall compliance: nothing under `src/jobs/**` imports `src/projections/register` except the
relocated `season-week/steps.ts` (exempt by exact path, as it was under `scripts/`). The wall
test (`wall.source.test.ts`) sweeps `src/jobs` like everything else and is run as a gate.

## 8. Installer (`scripts/install-season-runner.sh`, replaces `install-season-cron.sh`)

- Writes `~/Library/LaunchAgents/com.commish.jobs-runner.plist` (`KeepAlive`, `RunAtLoad`,
  `WorkingDirectory` = main checkout, logs under `~/.commish/job-logs/`), then
  `launchctl bootstrap` (with bootout-first for idempotent reinstall).
- Refuses to overwrite a plist at that path that it did not write (marker comment in the file),
  the same never-eat-someone-else's-config discipline the cron installer proved out.
- Removes the old crontab marker block using the SAME validation gate the old installer had
  (balanced-pair check, refuse loudly on any other shape, belt-and-suspenders line count) — and
  removal only; it never adds cron lines.
- `--print-only` prints the plist and the would-be crontab and writes nothing.
- NOT run from this worktree; ships as code, run by the controller after merge (the live season
  still depends on the existing crontab until then).

## 9. Admin surface (`/app/admin/jobs`)

`src/app/app/(shell)/admin/jobs/page.tsx`, through `withAdmin`'s Server Component overload like
every admin page (the `admin-routes.test.ts` tripwire enforces it). Three sections, Sunday v5
tokens, no em-dashes in copy:

- **Needs attention** — `failed` and `abandoned` jobs first, impossible to miss, with last error
  and a re-run action.
- **Schedules** — each code-defined schedule with its cron, timezone, cursor, and last enqueued
  fire.
- **Recent runs** — latest job runs with status, attempt, timing, error kind.

Re-run: `POST /api/admin/jobs/rerun` (`withAdmin` request overload) enqueues a FRESH job (new
idempotency key suffixed with the operator action instant) copying name and payload; history is
never rewritten. Secrets never rendered: errors are stored already-scrubbed (the props step
records outcome text, not raw exception dumps with env in them) and the page renders stored text
only.

## 10. Hard constraints honored

- Register gates authoritative: terminal classification in §7; no retry-until-late-anyway.
- 2026 quarantine / wall: §7; wall test in the gate list.
- Append-only history: DB triggers on `job_runs` and `job_run_steps` (§2), plus tests.
- Secrets: `ODDS_API_KEY` read only inside the existing `requireEnv` seam and never interpolated
  into recorded errors; `CRON_SECRET` env-only, constant-time compared, request refused when
  unset.
- Strict tsc + eslint; core behaviors tested on the four-lane test DB (claim contention, retry
  and backoff, catch-up after a gap, checkpoint resume, terminal-vs-retryable, reclaim).
- Immutable patterns, small files, DI everywhere (`Clock`, `random`, db, worker id injected).

## 11. Judgment calls

- **America/New_York, not America/Chicago**: the brief said Chicago semantics but told us to
  check the installer; the installer assumed New_York (08:00/18:00/14:00 ET). The schedules
  keep the installed reality. Changing the wall-clock hours is a one-line config edit later.
- **Cursor table over a fire-history table**: the fire history already lives on the jobs rows
  (`schedule_name`, `scheduled_for`); a second history table would be a second source of truth.
- **Minute-walk cron catch-up over a next-fire solver**: bounded (7-day cap = ~10k cheap
  predicate calls, only after a gap), DST-correct via Intl, dependency-free, and trivially
  testable. A solver is an optimization the walk does not need.
- **Props snapshot failure recorded-not-fatal**: preserves the crontab cadence's explicit law
  (a props failure never blocks the freeze). The failure is still visible: the step detail says
  `ok: false` and the admin page shows it.
- **Draft ticker and stats worker stay in-process** (§1): a minute-granularity durable queue is
  the wrong contract for second-level countdowns and live scoring; both already have injected
  clocks and tests, and their Vercel story belongs to their features' own deployment plan.
- **The cadence relocated into `src/` mid-implementation** (§7): the original plan kept
  `scripts/season-week-steps.ts` in place, but the eslint boundary (`src/**` must not import
  `scripts/**` — "source may not depend on build tooling") is the codebase's own law, and the
  Vercel route is source. The wall's guarantees are unchanged: same single exempt module plus
  test, new path, all three guard layers updated together and asserted green.
