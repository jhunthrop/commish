# Job System Plan (2026-09-02)

Spec: `docs/superpowers/specs/2026-09-02-job-system-design.md`. Worktree: `worktree-job-system`
off main @ 10d1975. Conventional commits, green gates (`tsc --noEmit`, `eslint`, targeted
`vitest` including the wall test) after each task. Never merge, never touch the live crontab.

## Tasks

1. **Docs** — commit the spec and this plan. (`docs:`)
2. **Schema** — `job_status` enum + `jobs`, `job_runs`, `job_run_steps`, `schedule_cursors` in
   `src/db/schema.ts`; `npm run db:generate`; hand-append the append-only triggers (0019
   precedent) to the migration; `truncateJobTables` helper in `src/db/test-db.ts` (money-tables
   precedent: separate until merge); migrate the test lanes. Test: append-only triggers reject
   UPDATE-after-finish and DELETE. (`feat(jobs):`)
3. **Pure core** — `contract.ts` (types, `TerminalJobError`, step outcomes), `config.ts`,
   `backoff.ts` (exponential + full jitter, injected random), `cron.ts` (parser + Intl-based
   timezone match). TDD: cron parse/match incl. DST boundary, backoff bounds. (`feat(jobs):`)
4. **Store** — `store.ts`: enqueue (idempotency-key upsert), atomic SKIP LOCKED claim,
   heartbeat, finish/fail run, record step, completed-steps read, stale reclaim, admin queries.
   Tests: claim contention (concurrent claims all distinct), reclaim of a stale heartbeat.
   (`feat(jobs):`)
5. **Executor** — `execute.ts`: run a claimed job's steps with checkpoint skip, heartbeat
   interval, per-attempt timeout, terminal-vs-retryable classification, backoff re-queue,
   dead-letter transitions. Tests: checkpoint resume, terminal error goes failed with no
   retry, retryable error backs off then succeeds, timeout retries. (`feat(jobs):`)
6. **Schedules** — `schedules.ts` (three season-week fires, America/New_York), `schedule.ts`
   (cursor read, minute-walk catch-up, bounded window, bootstrap, idempotent enqueue).
   Tests: catch-up after a gap, double-tick dedupe, bootstrap enqueues nothing. (`feat(jobs):`)
7. **Runner seam** — `runner.ts` (`runTick`: schedules, reclaim, bounded drain, report),
   `scripts/jobs-runner.ts` + `npm run jobs:runner`. Test: tick respects budget and maxJobs.
   (`feat(jobs):`)
8. **Season-week job def** — `defs/season-week-job.ts` + `registry.ts`; props failure recorded
   not fatal; freeze refusal classification. Tests with canned deps; wall test green.
   (`feat(jobs):`)
9. **Vercel tick route** — `src/app/api/jobs/tick/route.ts` + constant-time bearer check.
   Tests: 401 wrong/missing token, 500-and-refuse when CRON_SECRET unset, happy path runs a
   tick. (`feat(jobs):`)
10. **Admin surface** — `/app/admin/jobs` page (failures first, schedules, recent runs) +
    `POST /api/admin/jobs/rerun`; admin-routes tripwire stays green. (`feat(admin):`)
11. **Installer** — `scripts/install-season-runner.sh` (launchd plist, crontab block removal
    with the old validation gate, `--print-only`); delete `install-season-cron.sh`.
    (`feat(ops):`)
12. **Close-out** — full targeted gate sweep; final report.
