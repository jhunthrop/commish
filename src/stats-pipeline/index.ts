import { createDb } from "@/db/client";
import { DB_POOL_CONFIG } from "@/db/config";
import type { PublishFn } from "@/lib/realtime/publish";
import { getPublisher } from "@/lib/realtime/publisher";
import { getSharedRedis } from "@/lib/realtime/redis";
import { createStatsProvider } from "@/stats/registry";
import { createRequestBudget, type RequestBudget } from "./budget";
import { createIngestionWorker, type IngestionWorker } from "./worker";

/**
 * The worker's `publish` dependency: delegates to the process-wide publisher. Extracted to its
 * own name, rather than inlined into `getIngestionWorker()`'s construction, so this one line of
 * wiring is directly unit-testable — a full ingestion tick is what would otherwise be needed to
 * reach it, since it only runs when a tick actually has something to publish.
 */
export const publishViaSharedPublisher: PublishFn = (input) => getPublisher().publish(input);

/** The outermost edge is the only place a wall clock is allowed. Exported so its own `now()` is
 *  directly unit-testable without needing a real tick to reach it. */
export const systemClock = { now: () => new Date().toISOString() };

/**
 * The pool size a background job is allowed: `DB_POOL_CONFIG.backgroundJobPoolSize`, exported
 * as its own function rather than inlined into `getIngestionWorker()`'s construction, because
 * asserting on it is the only way to prove the worker actually draws from the background job
 * budget rather than the request path's — asserting on a live `postgres` pool's internals would
 * mean asserting on `postgres` itself. See `index.test.ts`.
 */
export function ingestionPoolOptions(): { readonly max: number } {
  return { max: DB_POOL_CONFIG.backgroundJobPoolSize };
}

/**
 * The singletons live on `globalThis`, not a module-level `let` — the same reason `getDb`
 * (`src/db/client.ts`) and `getReferenceCache` (`src/league-service/reference-cache-instance.ts`)
 * do: `next dev`'s recompiles mint a fresh module instance on every rebuild, and a module-level
 * singleton would reset with it while nothing tore down the last one's state. That matters MORE
 * here than it does for the draft ticker (`src/draft-service/index.ts`, which reuses the shared
 * `getDb()` pool and so is safe as a plain `let`): this module constructs its OWN dedicated
 * Postgres pool (see `getIngestionWorker` below), and a plain `let` would mint — and leak — a
 * fresh pool on every hot reload, which is exactly the "too many clients already" failure mode
 * `getDb`'s own docblock describes. `globalThis` survives a recompile; in production the module
 * loads once and this is equivalent to a plain `let`.
 */
const globalIngestion = globalThis as {
  __commishIngestionWorker?: IngestionWorker;
  __commishIngestionBudget?: RequestBudget;
};

/**
 * The process-wide ingestion request budget — the same instance `getIngestionWorker()` wires
 * into its worker, exported separately so `scripts/ingest-once.ts` can report what a tick cost
 * without a second Redis connection or a second wiring of its own.
 */
export function getIngestionBudget(): RequestBudget {
  globalIngestion.__commishIngestionBudget ??= createRequestBudget({ redis: getSharedRedis(), clock: systemClock });
  return globalIngestion.__commishIngestionBudget;
}

/**
 * Mirrors `src/draft-service/index.ts`: a module singleton, a system clock at the outermost
 * edge, publishing via `getPublisher()`. The one deliberate difference: this constructs its OWN
 * `createDb(undefined, ingestionPoolOptions())` rather than calling `getDb()`, because sharing
 * the request path's pool is precisely the thing `DB_POOL_CONFIG`'s formula
 * (`src/db/config.ts`) was written to prevent — a batch job that can borrow from the request
 * path's connections is a batch job that can take the request path down on the busiest day of
 * the week. The formula is only true if this worker actually honors it, which is what
 * `index.test.ts` asserts on `ingestionPoolOptions()` rather than on this function's pool.
 *
 * The budget's Redis connection uses `getSharedRedis()` (non-blocking commands only, per that
 * module's own rule) — `createRequestBudget` issues nothing but `EVAL`/`GET`, never `XREAD
 * BLOCK`, so sharing is safe.
 */
export function getIngestionWorker(): IngestionWorker {
  globalIngestion.__commishIngestionWorker ??= createIngestionWorker({
    db: createDb(undefined, ingestionPoolOptions()),
    provider: createStatsProvider(),
    redis: getSharedRedis(),
    publish: publishViaSharedPublisher,
    clock: systemClock,
    budget: getIngestionBudget(),
  });
  return globalIngestion.__commishIngestionWorker;
}
