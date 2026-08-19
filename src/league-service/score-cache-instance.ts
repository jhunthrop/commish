import { getSharedRedis } from "@/lib/realtime/redis";
import { createScoreCache, type ScoreCache } from "@/stats-pipeline/score-cache";

/**
 * The process-wide `ScoreCache` for the one production read path that needs one off the
 * ingestion worker: `crossLeagueHome`'s `readMany` (`@/league-service/home.ts`) — the same role
 * `getReferenceCache` (`./reference-cache-instance.ts`) plays for `matchupWeek`'s reads, and
 * built the same way for the same reasons: see that module's docblock for why `getSharedRedis()`
 * rather than a dedicated connection, why `globalThis` rather than a module-level `let`, and why
 * this degrades open on a dead Redis instead of failing the page.
 */
const globalScoreCache = globalThis as { __commishScoreCache?: ScoreCache };

export function getScoreCache(): ScoreCache {
  globalScoreCache.__commishScoreCache ??= createScoreCache({ redis: getSharedRedis() });
  return globalScoreCache.__commishScoreCache;
}
