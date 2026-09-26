/**
 * Next.js calls this once per server process. On a LONG-LIVED server (local dev, a self-hosted
 * node) Plan B's stats-ingestion worker (`@/stats-pipeline`) starts here.
 *
 * NO DRAFT TICKER, ANYWHERE (the batched bots round, 2026-09-25). Drafts advance through the
 * same two drivers on every host — advance-on-read and the minute-cron `draft-sweep` job
 * (`src/jobs/defs/draft-sweep-job.ts`, run locally by `npm run jobs:runner`) — and a mock's bot
 * picks are batched into the commit that lands the human action before them, so nothing has to
 * tick for a room to move. The dev ticker that used to start here paced bots and expiries
 * per second on a local process only; one topology now, never two.
 *
 * ON VERCEL THE INGESTION WORKER DOES NOT START EITHER (the draft-driver design, 2026-09-03):
 * each function invocation is short-lived, so a worker started here would live only as long as
 * whichever invocation happened to run `register()`. `process.env.VERCEL` is the platform's own
 * marker, set on every Vercel build and function.
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
 * edge bundle's perspective and fails the build. The Vercel gate is an ordinary runtime
 * condition NESTED inside that statically-recognized block, so the bundler shape is untouched.
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
      const { getIngestionWorker } = await import("@/stats-pipeline");
      getIngestionWorker().start();
    }
  }
}
