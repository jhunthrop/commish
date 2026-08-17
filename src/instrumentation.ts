/**
 * Next.js calls this once per server process. The draft clock has to keep running whether
 * or not anyone has a browser tab open, so it starts here rather than on first request.
 *
 * The dynamic import must stay INSIDE the `if` block (not behind an early return): Next's
 * bundler statically recognizes `if (process.env.NEXT_RUNTIME === "nodejs") { import(...) }`
 * and excludes that branch from the edge runtime bundle. `@/draft-service` pulls in ioredis,
 * which needs Node core modules ('net', 'dns', 'crypto', 'stream') the edge runtime doesn't
 * have — an early-return guard still leaves the import reachable from the edge bundle's
 * perspective and fails the build.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { getDraftTicker } = await import("@/draft-service");
    getDraftTicker().start();
  }
}
