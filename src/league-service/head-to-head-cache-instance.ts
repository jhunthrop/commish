import { getSharedRedis } from "@/lib/realtime/redis";
import { createHeadToHeadCache, type HeadToHeadCache } from "./head-to-head-cache";

/**
 * The process-wide `HeadToHeadCache`, the same shape and the same reasons as `getScoreCache`
 * (`./score-cache-instance.ts`): one instance so the room's READ and the ingestion worker's
 * INVALIDATE are two ends of one key, `getSharedRedis()` rather than a connection of its own, and
 * `globalThis` rather than a module-level `let` so a dev-server hot reload does not leak one.
 */
const globalHeadToHeadCache = globalThis as { __commishHeadToHeadCache?: HeadToHeadCache };

export function getHeadToHeadCache(): HeadToHeadCache {
  globalHeadToHeadCache.__commishHeadToHeadCache ??= createHeadToHeadCache({ redis: getSharedRedis() });
  return globalHeadToHeadCache.__commishHeadToHeadCache;
}
