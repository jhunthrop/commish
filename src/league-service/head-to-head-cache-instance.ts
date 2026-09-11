import { getSharedRedis } from "@/lib/realtime/redis";
import { createHeadToHeadCache, type HeadToHeadCache } from "./head-to-head-cache";

/**
 * The process-wide `HeadToHeadCache`, the same shape and the same reasons as `getScoreCache`
 * (`./score-cache-instance.ts`): one instance so the room's READ and the ingestion worker's
 * INVALIDATE are two ends of one key, `getSharedRedis()` rather than a connection of its own, and
 * `globalThis` rather than a module-level `let` so a dev-server hot reload does not leak one.
 */
const globalHeadToHeadCache = globalThis as { __commishHeadToHeadCache?: HeadToHeadCache };

/**
 * Always a miss, never a write — what "there is no Redis here" means, spelled rather than thrown.
 * `getSharedRedis()` throws outright when `REDIS_URL` is unset, which is true of a unit test that
 * renders a league page and of a misconfigured deploy alike. The cache's every method already
 * degrades open on a dead connection (`createHeadToHeadCache`); degrading open on an ABSENT one is
 * the same contract, applied one layer earlier, and it is what keeps a page render from depending
 * on an accelerator.
 */
const NO_CACHE: HeadToHeadCache = {
  read: async () => null,
  write: async () => {},
  invalidate: async () => {},
};

export function getHeadToHeadCache(): HeadToHeadCache {
  if (globalHeadToHeadCache.__commishHeadToHeadCache === undefined) {
    try {
      globalHeadToHeadCache.__commishHeadToHeadCache = createHeadToHeadCache({ redis: getSharedRedis() });
    } catch {
      return NO_CACHE;
    }
  }
  return globalHeadToHeadCache.__commishHeadToHeadCache;
}
