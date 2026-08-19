import type Redis from "ioredis";
import { STATS_INGESTION_CONFIG } from "./config";

export interface ReferenceCache {
  /** Calls `load` once on a miss (including a Redis outage) and zero times on a hit. */
  players<T>(load: () => Promise<T>): Promise<T>;
  invalidatePlayers(): Promise<void>;
  /** Per-league: invalidating one league's settings never evicts another league's. */
  scoringSettings<T>(leagueId: string, load: () => Promise<T>): Promise<T>;
  invalidateScoringSettings(leagueId: string): Promise<void>;
}

interface ReferenceCacheDeps {
  readonly redis: Redis;
}

/** `undefined` means "no usable cached value" — a miss, a corrupt value, or an outage all read the same to the caller. */
async function readCached<T>(redis: Redis, key: string): Promise<T | undefined> {
  let raw: string | null;
  try {
    raw = await redis.get(key);
  } catch {
    // Redis outage. Degrade OPEN: the caller falls back to `load`.
    return undefined;
  }
  if (raw === null) return undefined;
  try {
    return JSON.parse(raw) as T;
  } catch {
    // Corrupt value: not JSON. Treated as a miss, never a throw.
    return undefined;
  }
}

async function writeThrough<T>(redis: Redis, key: string, ttlSeconds: number, value: T): Promise<void> {
  try {
    await redis.set(key, JSON.stringify(value), "EX", ttlSeconds);
  } catch {
    // Degrade OPEN: a failed cache write must never fail the read path that triggered it.
  }
}

async function cached<T>(redis: Redis, key: string, ttlSeconds: number, load: () => Promise<T>): Promise<T> {
  const hit = await readCached<T>(redis, key);
  if (hit !== undefined) return hit;
  const value = await load();
  await writeThrough(redis, key, ttlSeconds, value);
  return value;
}

async function invalidate(redis: Redis, key: string): Promise<void> {
  try {
    await redis.del(key);
  } catch {
    // Degrade OPEN: a failed invalidation is one possible stale read, not a thrown error.
  }
}

/**
 * Read-heavy, rarely-changing reference data cached with explicit write-through invalidation
 * rather than a blind TTL — a blind TTL could serve a league its old scoring rules mid-week.
 * The TTLs configured for these keys (`STATS_INGESTION_CONFIG.ttlSeconds`) are belt and braces
 * only, bounding how wrong a missed invalidation can get.
 *
 * Degrades OPEN, the same posture `score-cache.ts` takes and for the same reason: a Redis
 * outage falls through to `load` and costs milliseconds, never correctness.
 */
export function createReferenceCache({ redis }: ReferenceCacheDeps): ReferenceCache {
  async function players<T>(load: () => Promise<T>): Promise<T> {
    return cached(redis, STATS_INGESTION_CONFIG.keys.playerIndex, STATS_INGESTION_CONFIG.ttlSeconds.playerIndex, load);
  }

  async function invalidatePlayers(): Promise<void> {
    await invalidate(redis, STATS_INGESTION_CONFIG.keys.playerIndex);
  }

  async function scoringSettings<T>(leagueId: string, load: () => Promise<T>): Promise<T> {
    return cached(
      redis,
      STATS_INGESTION_CONFIG.keys.scoringSettings(leagueId),
      STATS_INGESTION_CONFIG.ttlSeconds.scoringSettings,
      load,
    );
  }

  async function invalidateScoringSettings(leagueId: string): Promise<void> {
    await invalidate(redis, STATS_INGESTION_CONFIG.keys.scoringSettings(leagueId));
  }

  return { players, invalidatePlayers, scoringSettings, invalidateScoringSettings };
}
