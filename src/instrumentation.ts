/**
 * Next.js calls this once per server process. The draft clock has to keep running whether
 * or not anyone has a browser tab open, so it starts here rather than on first request. Plan
 * B's stats-ingestion worker (`@/stats-pipeline`) is the same shape for the same reason: nobody
 * has to have a browser tab open on a Sunday afternoon for the live scores to keep moving, so
 * it starts here too, right beside the draft ticker.
 *
 * The dynamic import must stay INSIDE the `if` block (not behind an early return): Next's
 * bundler statically recognizes `if (process.env.NEXT_RUNTIME === "nodejs") { import(...) }`
 * and excludes that branch from the edge runtime bundle. `@/draft-service` and `@/stats-pipeline`
 * both pull in ioredis, which needs Node core modules ('net', 'dns', 'crypto', 'stream') the
 * edge runtime doesn't have — an early-return guard still leaves the import reachable from the
 * edge bundle's perspective and fails the build. Both workers' starts live inside the SAME `if`
 * block for that same bundler reason: a second identical guard would still be recognized
 * correctly, but there is no reason to write it twice, and two separate blocks would be two
 * places to keep in sync instead of one.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { getDraftTicker } = await import("@/draft-service");
    getDraftTicker().start();
    const { getIngestionWorker } = await import("@/stats-pipeline");
    getIngestionWorker().start();
  }
}
