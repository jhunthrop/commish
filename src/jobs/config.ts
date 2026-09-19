// THE JOB SYSTEM'S OWN KNOBS — one place, no magic numbers at call sites, the same shape
// `DRAFT_SERVICE_CONFIG` and `STATS_INGESTION_CONFIG` use.
export const JOBS_CONFIG = {
  /** How often a running attempt refreshes `jobs.heartbeat_at`. */
  heartbeatIntervalMs: 10_000,
  /**
   * How stale a running job's heartbeat must be before a reclaim pass takes it back. Sized at 12
   * missed heartbeats: long enough that one slow query or GC pause cannot get a live worker's job
   * stolen out from under it, short enough that a crashed Vercel function's job is back in the
   * queue within two cron minutes.
   */
  staleAfterMs: 120_000,
  /** The local runner's cadence between ticks. Well under the minute Vercel Cron gets, because a
   *  local always-on process has no reason to be coarser than its serverless understudy. */
  localTickIntervalMs: 30_000,
  /** The local runner's per-tick budget and drain bound — generous, since nothing kills the
   *  process at a deadline; the bound exists so one tick's report stays one tick's worth. */
  localTickBudgetMs: 20 * 60_000,
  localTickMaxJobs: 25,
  /** The Vercel tick's default budget (overridable via `JOBS_TICK_BUDGET_MS`): under the
   *  function-duration cap with margin to finish the in-flight job and answer the request. */
  vercelTickBudgetMsDefault: 50_000,
  vercelTickMaxJobs: 10,
  /**
   * The catch-up window: how far back a schedule cursor is allowed to lag before older missed
   * fires are dropped rather than enqueued. A week covers any realistic laptop-asleep gap; past
   * that, the cadence jobs are idempotent-or-skip, so ONE caught-up run does the work of every
   * older missed one and replaying a month of identical runs would be queue noise, not recovery.
   */
  maxCatchUpMs: 7 * 24 * 60 * 60_000,
  /** Default retry posture for job definitions that do not override it. */
  defaultMaxAttempts: 5,
  defaultBackoff: { baseMs: 60_000, maxMs: 60 * 60_000 },
  /** How many rows the admin surface reads per section. */
  adminRecentRuns: 50,
  /**
   * THE WAKE GATE (Neon cost audit 2026-09-07, finding 1 — see `wake.ts`). The Redis sorted set
   * that names every instant the minute tick must touch Postgres for; an idle minute reads it and
   * issues zero statements, which is what lets Neon's compute suspend between real fires.
   */
  wakeSetKey: "jobs:wake",
  /**
   * When a claim registers its reclaim wake: `staleAfterMs` past the claim, plus one heartbeat of
   * margin so the scan runs strictly AFTER a dead attempt's last heartbeat has aged past the
   * stale cutoff (a scan a hair early finds nothing and, having consumed its wake, never
   * rescans). Every heartbeat re-registers the same delay, so a live attempt keeps pushing the
   * scan out ahead of itself.
   */
  reclaimWakeDelayMs: 130_000,
  /**
   * The draft sweep's safety cadence: it runs at least this often even when no draft has
   * registered a wake, which bounds the latency of any kickoff writer this gate does not hook
   * (league creation, a commissioner reschedule, the fill trigger) for a room NOBODY is watching.
   * A watched room never waits on this — its own stream and reads advance it. Thirty minutes is
   * the trade against compute: each safety run wakes Neon for about six minutes.
   */
  sweepMaxQuietMs: 30 * 60_000,
  /**
   * THE SELF-WAKE (draft-room performance round, item 3): a job due inside the next minute is not
   * left to the cron's minute. The invocation that enqueued it POSTs `/api/jobs/run` for it at
   * once (`self-wake.ts`, after its own response has gone); that invocation answers 202 and, after
   * ITS response, sleeps until the due instant and claims exactly that job (`run-handler.ts`): one
   * invocation per bot pick, each at its own due instant, never a sleep inside a request somebody
   * is waiting on or a stream that may not be open.
   *
   * THE CHAIN (review fix round, finding 1): one invocation sleeps at most `selfWakeMaxSleepMs`
   * (under the route's `maxDuration`); a job due further out is carried by a chain — the sleeper
   * sleeps its ceiling, then re-arms a wake for the remainder, and so on until due, each hop
   * retiring the moment a human's pick retires the job. The chain covers due times up to
   * `selfWakeChainMaxMs`: every mock clock (30, 60, 90 s) and the real schedule's 90 s and ten
   * minute tiers, at one to ten hops a turn. Longer clocks (an hour, four, eight) stay on the
   * cron, where a minute's lateness is under two percent of the clock and a chain would cost 60
   * to 480 idle invocations per turn for nothing a manager could see.
   *
   * `selfWakeTimeoutMs` bounds the wake request, so an unreachable self never stalls the
   * caller's follow-through; `selfWakeSleepSliceMs` is how often a sleeping invocation checks
   * that its job is still pending, so a job retired while it slept costs one slice of idle. A
   * wake that fails or never happens costs latency only: the job is queued, and the tick claims it.
   */
  selfWakeMaxSleepMs: 60_000,
  selfWakeChainMaxMs: 10 * 60_000,
  selfWakeTimeoutMs: 5_000,
  selfWakeSleepSliceMs: 5_000,
  /**
   * How long past its `run_at` a pending pacing job is still trusted to be on its way (the wake
   * request in flight, a tick about to claim it). The draft sweep leaves a room alone while its
   * pacing job is inside this grace, and advances it directly once the job is older: the wake was
   * lost, and the sweep is the safety net (`draft-sweep-job.ts`).
   */
  pacingChainGraceMs: 30_000,
} as const;
