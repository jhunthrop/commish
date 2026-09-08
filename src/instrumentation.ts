/**
 * Next.js calls this once per server process. On a LONG-LIVED server (local dev, a self-hosted
 * node) the draft clock has to keep running whether or not anyone has a browser tab open, so the
 * in-process ticker starts here — it is why drafts feel instant locally. Plan B's stats-ingestion
 * worker (`@/stats-pipeline`) is the same shape for the same reason.
 *
 * ON VERCEL NEITHER WORKER STARTS (the draft-driver design, 2026-09-03 — the mock-drafts-stall
 * incident): each function invocation is short-lived, so a ticker started here would live only
 * as long as whichever invocation happened to run `register()`, which is exactly how deferred
 * solo starts, bot picks and clock expiries froze in production. Drafts on Vercel advance
 * through the three drivers instead — advance-on-read, the SSE watcher loop, and the minute-cron
 * `draft-sweep` job (`src/jobs/defs/draft-sweep-job.ts`) — all funneling into the same store
 * paths this ticker uses, so gating it off changes topology, never semantics. `process.env.VERCEL`
 * is the platform's own marker, set on every Vercel build and function.
 *
 * The stats ingestion worker has the same serverless death, and its correct production path is
 * the existing jobs system (`src/jobs/defs/season-week-job.ts` carries the weekly cadence
 * already). KNOWN FOLLOW-UP: live-Sunday ingestion cadence on Vercel needs its own jobs-system
 * def — minute-granularity polling during game windows — tracked as a jobs ticket; until then
 * live scores on Vercel move only as often as the season-week job runs.
 *
 * The dynamic import must stay INSIDE the `if` block (not behind an early return): Next's
 * bundler statically recognizes `if (process.env.NEXT_RUNTIME === "nodejs") { import(...) }`
 * and excludes that branch from the edge runtime bundle. `@/draft-service` and `@/stats-pipeline`
 * both pull in ioredis, which needs Node core modules ('net', 'dns', 'crypto', 'stream') the
 * edge runtime doesn't have — an early-return guard still leaves the import reachable from the
 * edge bundle's perspective and fails the build. Both workers' starts live inside the SAME `if`
 * block for that same bundler reason: a second identical guard would still be recognized
 * correctly, but there is no reason to write it twice, and two separate blocks would be two
 * places to keep in sync instead of one. The Vercel gate is an ordinary runtime condition
 * NESTED inside that statically-recognized block, so the bundler shape is untouched.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // THE WAKE GATE'S INSTALL (Neon cost audit 2026-09-07, finding 1): every Node process that
    // enqueues a job or applies a draft action registers the instant that work becomes due in
    // one Redis sorted set, and the minute cron reads that set instead of Postgres. Installed
    // here — once per server instance, on Vercel and locally alike — because `register()` runs
    // before the first request on every instance, so no route can enqueue into an uninstalled
    // (and therefore ungated, fail-open) process. Skipped when there is no Redis to install
    // over: `wakeSet()` then stays ungated, which is the tick exactly as it was.
    if (process.env.REDIS_URL !== undefined && process.env.REDIS_URL !== "") {
      const { createRedisWakeSet, installWakeSet } = await import("@/jobs/wake");
      const { getSharedRedis } = await import("@/lib/realtime/redis");
      installWakeSet(createRedisWakeSet(getSharedRedis()));
    }
    if (process.env.VERCEL === undefined) {
      const { getDraftTicker } = await import("@/draft-service");
      getDraftTicker().start();
      const { getIngestionWorker } = await import("@/stats-pipeline");
      getIngestionWorker().start();
    }
  }
}
