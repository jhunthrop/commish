import { asc, ne } from "drizzle-orm";
import { createDb, type Db } from "@/db/client";
import { statWeeks } from "@/db/schema";
import { envOrUndefined } from "@/lib/env";
import { captureOnce, type CaptureResult } from "@/projections/capture";
import { NFL_TEAM_ABBREVIATIONS } from "@/projections/capture-feeds";
import { createTank01Client } from "@/stats/tank01/client";
import { TANK01_CONFIG } from "@/stats/tank01/config";
import { DB_POOL_CONFIG } from "@/db/config";
import type { PublishFn } from "@/lib/realtime/publish";
import { getPublisher } from "@/lib/realtime/publisher";
import { getSharedRedis } from "@/lib/realtime/redis";
import { getScoreCache } from "@/league-service/score-cache-instance";
import type { StatsProvider } from "@/stats/provider";
import { createStatsProvider } from "@/stats/registry";
import { createRequestBudget, type RequestBudget } from "./budget";
import { resolveIngestionSettings, type IngestionSettings } from "./settings";
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
  __commishIngestionSettings?: IngestionSettings;
  __commishStatsProvider?: StatsProvider;
};

/**
 * The process-wide `StatsProvider`. One instance, not one per consumer: the Tank01 adapter
 * memoizes its player list for the life of the instance (two upstream requests), and the worker,
 * the ledger, `npm run seed` and — as of Task 10 — `correctSettledWeek` (`./correction`, called
 * from `scripts/correct-stat-week.ts`) all need to agree about which provider is configured,
 * including whether its calls cost anything (`requestCost`, read by `getIngestionBudget` below).
 */
export function getStatsProvider(): StatsProvider {
  globalIngestion.__commishStatsProvider ??= createStatsProvider();
  return globalIngestion.__commishStatsProvider;
}

/**
 * `STATS_INGESTION_MODE`, `STATS_POLL_INTERVAL_MS` and `STATS_DAILY_REQUEST_BUDGET`, resolved
 * ONCE per process and shared by the budget and the worker — they have to agree, and resolving
 * them twice is how they would eventually stop agreeing. Memoized alongside the singletons
 * because a bad value throws, and throwing on the first construction rather than on every hot
 * reload is what makes the failure legible.
 */
export function getIngestionSettings(): IngestionSettings {
  globalIngestion.__commishIngestionSettings ??= resolveIngestionSettings();
  return globalIngestion.__commishIngestionSettings;
}

/**
 * The process-wide ingestion request budget — the same instance `getIngestionWorker()` wires
 * into its worker, exported separately so `scripts/ingest-once.ts` can report what a tick cost
 * without a second Redis connection or a second wiring of its own. `correctSettledWeek`
 * (`./correction`) defaults to this SAME instance too, deliberately: an operator correction is a
 * third spender against one daily ceiling, never a ledger of its own — see that module's own
 * docblock for why a second ledger would be the wrong shape entirely.
 */
export function getIngestionBudget(): RequestBudget {
  globalIngestion.__commishIngestionBudget ??= createRequestBudget({
    redis: getSharedRedis(),
    clock: systemClock,
    dailyRequestBudget: getIngestionSettings().dailyRequestBudget,
    // The ledger exists to protect a paid API key. A provider that never reaches a network has no
    // key to protect, and debiting it would spend a real ceiling on imaginary requests.
    metered: getStatsProvider().requestCost === "metered",
  });
  return globalIngestion.__commishIngestionBudget;
}

/**
 * The projection engine's ephemeral-feed capture, bound to this process's real dependencies — or
 * `undefined` when there is nothing to capture.
 *
 * `undefined` for any provider but Tank01, and that is not a shortcut: the feeds are Tank01
 * endpoints, and the mock provider answers out of a committed JSON file with no injury report, no
 * betting line and no ADP drift to preserve. Capturing a fixture every day would fill the table
 * with one unchanging row and teach nobody anything.
 *
 * The freshness keys go through `getSharedRedis()` — `EXISTS` and `SET EX` only, never a blocking
 * read, which is that module's rule for sharing. The budget is the SAME ledger instance live
 * scoring reserves against, deliberately: one paid quota, one counter, and the capture takes its
 * share through the same door rather than beside it.
 */
export function getCapture(db: Db): (() => Promise<CaptureResult>) | undefined {
  if (getStatsProvider().requestCost !== "metered") return undefined;
  const apiKey = envOrUndefined(TANK01_CONFIG.envVars.apiKey);
  if (apiKey === undefined) return undefined;
  const client = createTank01Client({ apiKey });
  const redis = getSharedRedis();
  const budget = getIngestionBudget();
  const seasonSetting = envOrUndefined(TANK01_CONFIG.envVars.season);
  const season = seasonSetting === undefined ? TANK01_CONFIG.defaultSeason : Number(seasonSetting);

  return async () =>
    captureOnce({
      db,
      client,
      clock: systemClock,
      budget,
      season,
      // Read per pass, not captured at wiring time: this process lives for months and the week
      // it was constructed in is not the week it is capturing in.
      week: await currentNflWeek(db),
      teams: NFL_TEAM_ABBREVIATIONS,
      isFresh: async (key) => (await redis.exists(key)) === 1,
      markFresh: async (key, ttlSeconds) => {
        await redis.set(key, "1", "EX", ttlSeconds);
      },
    });
}

/**
 * The earliest week not yet final — the week the odds and salary feeds are asking about.
 *
 * Falls back to week 1 when `stat_weeks` is empty, which is the preseason: exactly when ADP drift
 * and injury designations matter most and the scoring half of the tick has nothing to do at all.
 *
 * Exported (not module-private) so `jobs/defs/capture-harvest-job.ts` derives the same week the
 * ingestion worker's own `getCapture()` above does, rather than a second copy of this query
 * drifting from this one.
 */
export async function currentNflWeek(db: Db): Promise<number> {
  const [row] = await db
    .select({ week: statWeeks.week })
    .from(statWeeks)
    .where(ne(statWeeks.status, "final"))
    .orderBy(asc(statWeeks.week))
    .limit(1);
  return row?.week ?? 1;
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
  const settings = getIngestionSettings();
  const db = createDb(undefined, ingestionPoolOptions());
  globalIngestion.__commishIngestionWorker ??= createIngestionWorker({
    db,
    capture: getCapture(db),
    provider: getStatsProvider(),
    redis: getSharedRedis(),
    publish: publishViaSharedPublisher,
    clock: systemClock,
    budget: getIngestionBudget(),
    // The one production writer of the score cache the cross-league home reads. The SAME
    // singleton `/api/home` and `/app` read through (`getScoreCache`), so the version the worker
    // stamps a value with and the version a read compares against are two ends of one key.
    scoreCache: getScoreCache(),
    mode: settings.mode,
    intervalMs: settings.pollIntervalMs,
  });
  return globalIngestion.__commishIngestionWorker;
}
