import { getSharedRedis } from "@/lib/realtime/redis";
import { createReferenceCache, type ReferenceCache } from "@/stats-pipeline/reference-cache";

/**
 * The process-wide `ReferenceCache` for the two read paths that need one off the ingestion
 * worker: `matchupWeek`'s `players` and `scoringSettings` reads (`@/league-service/read.ts`).
 *
 * Built over `getSharedRedis()` (`@/lib/realtime/redis`) — the same non-blocking connection the
 * ingestion worker already publishes through — never a dedicated connection, since this cache
 * issues nothing but GET/SET/DEL and that module's own rule is "never use for XREAD BLOCK".
 *
 * The singleton lives on `globalThis`, not a module-level `let` — the same reason `getDb`
 * (`src/db/client.ts`) does: `next dev`'s recompiles mint a fresh module instance on every
 * rebuild, and a module-level singleton would reset with it while nothing tore down the last
 * one's state. `globalThis` survives a recompile; in production the module loads once and this
 * is equivalent to a plain `let`.
 *
 * Degrades open on a dead Redis, the same posture `createReferenceCache` documents for itself:
 * a page reads correctly, just slower, never stale-wrong and never down.
 */
const globalReferenceCache = globalThis as { __commishReferenceCache?: ReferenceCache };

export function getReferenceCache(): ReferenceCache {
  globalReferenceCache.__commishReferenceCache ??= createReferenceCache({ redis: getSharedRedis() });
  return globalReferenceCache.__commishReferenceCache;
}
