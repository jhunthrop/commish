import type Redis from "ioredis";
import type { ProofStats } from "@/matchmaking/contract";
import { MATCHMAKING_CONFIG } from "@/matchmaking/config";

/** The one key this cache ever reads or writes — a single, process-wide strapline, not a
 *  per-visitor or per-league value, so there is exactly one row to invalidate and nothing here
 *  ever does: see `MATCHMAKING_CONFIG.proof.cacheTtlSeconds`'s own docblock for why a blind TTL
 *  is the honest cache for this value rather than `ReferenceCache`'s write-through form. */
const PROOF_CACHE_KEY = "matchmaking:proof";

export interface ProofCache {
  /** Calls `load` once on a miss (including a Redis outage or a corrupt/wrong-shape cached
   *  value) and zero times on a hit — the identical contract `ReferenceCache.players` and
   *  `ReferenceCache.scoringSettings` (`./reference-cache.ts`) already state for the same reason. */
  stats(load: () => Promise<ProofStats>): Promise<ProofStats>;
}

interface ProofCacheDeps {
  readonly redis: Redis;
}

function isRating(value: unknown): value is ProofStats["rating"] {
  if (value === null) return true;
  if (typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return typeof record.average === "number" && typeof record.count === "number";
}

function isProofStats(value: unknown): value is ProofStats {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    (typeof record.leaguesFilled === "number" || record.leaguesFilled === null) &&
    (typeof record.draftsNext48h === "number" || record.draftsNext48h === null) &&
    isRating(record.rating) &&
    typeof record.any === "boolean"
  );
}

/**
 * The front door's own proof-strip cache (Phase 3.6, Task 5, P4 review's binding CARRY) — built
 * on the identical seam `createReferenceCache`/`createScoreCache` (`./reference-cache.ts`,
 * `./score-cache.ts`) already establish in this directory: real field checks on read (never just
 * "did `JSON.parse` throw"), and DEGRADES OPEN on every failure — a Redis outage, a corrupt
 * value, or a failed write all fall through to `load` (or are silently dropped on write), because
 * a cache that can fail a page render is worse than no cache. The one difference from those two
 * siblings is that this cache has no explicit invalidation path at all: see `PROOF_CACHE_KEY`'s
 * own docblock for why a blind TTL is the correct, and simpler, choice for this particular value.
 */
export function createProofCache({ redis }: ProofCacheDeps): ProofCache {
  async function stats(load: () => Promise<ProofStats>): Promise<ProofStats> {
    try {
      const raw = await redis.get(PROOF_CACHE_KEY);
      if (raw !== null) {
        let parsed: unknown;
        try {
          parsed = JSON.parse(raw);
        } catch {
          parsed = undefined; // Corrupt value: not JSON. Treated as a miss, never a throw.
        }
        if (parsed !== undefined && isProofStats(parsed)) return parsed;
      }
    } catch {
      // Redis outage. Degrade OPEN: fall through to `load`.
    }

    const value = await load();
    try {
      await redis.set(PROOF_CACHE_KEY, JSON.stringify(value), "EX", MATCHMAKING_CONFIG.proof.cacheTtlSeconds);
    } catch {
      // Degrade OPEN: a failed cache write must never fail the read path that triggered it.
    }
    return value;
  }

  return { stats };
}
