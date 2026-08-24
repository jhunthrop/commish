import { getSharedRedis } from "@/lib/realtime/redis";
import { createProofCache, type ProofCache } from "@/stats-pipeline/proof-cache";

/**
 * The process-wide `ProofCache` for the front door's own read (`src/app/page.tsx`, `src/app/
 * browse/page.tsx`) — the same role `getReferenceCache`/`getScoreCache` (`./reference-cache-
 * instance.ts`, `./score-cache-instance.ts`) play for their own callers, built the same way for
 * the same reasons: see `getReferenceCache`'s own docblock for why `getSharedRedis()` rather than
 * a dedicated connection, why `globalThis` rather than a module-level `let`, and why this
 * degrades open on a dead Redis instead of failing the page.
 */
const globalProofCache = globalThis as { __commishProofCache?: ProofCache };

export function getProofCache(): ProofCache {
  globalProofCache.__commishProofCache ??= createProofCache({ redis: getSharedRedis() });
  return globalProofCache.__commishProofCache;
}
