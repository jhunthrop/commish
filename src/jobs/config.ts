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
} as const;
