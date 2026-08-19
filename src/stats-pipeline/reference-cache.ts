import type Redis from "ioredis";
import type { Player } from "@/domain/player";
import type { ScoringSettings } from "@/domain/scoring";
import { STATS_INGESTION_CONFIG } from "./config";

export interface ReferenceCache {
  /** Calls `load` once on a miss (including a Redis outage or a corrupt/wrong-shape cached value) and zero times on a hit. */
  players(load: () => Promise<readonly Player[]>): Promise<readonly Player[]>;
  invalidatePlayers(): Promise<void>;
  /** Per-league: invalidating one league's settings never evicts another league's. */
  scoringSettings(leagueId: string, load: () => Promise<ScoringSettings>): Promise<ScoringSettings>;
  invalidateScoringSettings(leagueId: string): Promise<void>;
}

interface ReferenceCacheDeps {
  readonly redis: Redis;
}

function isPlayer(value: unknown): value is Player {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === "string" &&
    typeof record.name === "string" &&
    typeof record.position === "string" &&
    typeof record.nflTeam === "string"
  );
}

function isPlayerIndex(value: unknown): value is readonly Player[] {
  return Array.isArray(value) && value.every(isPlayer);
}

/** Every numeric field `ScoringSettings` carries, besides `leagueId`. Kept as a list, not one
 *  `typeof` check per field written out by hand, so a new scoring rule can't add a field to the
 *  domain type and silently stay unchecked here. */
const NUMERIC_SCORING_FIELDS = [
  "pointsPerPassingYard",
  "pointsPerPassingTouchdown",
  "pointsPerInterception",
  "pointsPerRushingYard",
  "pointsPerRushingTouchdown",
  "pointsPerReceivingYard",
  "pointsPerReceivingTouchdown",
  "pointsPerReception",
  "pointsPerFumbleLost",
  "teReceptionBonus",
  "pointsPerFieldGoal",
  "pointsPerExtraPoint",
  "pointsPerSack",
  "pointsPerDefensiveInterception",
  "pointsPerDefensiveTouchdown",
] as const satisfies readonly (keyof Omit<ScoringSettings, "leagueId">)[];

function isScoringSettings(value: unknown): value is ScoringSettings {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  if (typeof record.leagueId !== "string") return false;
  return NUMERIC_SCORING_FIELDS.every((field) => typeof record[field] === "number");
}

/** `undefined` means "no usable cached value" — a miss, a corrupt/wrong-shape value, or an outage all read the same to the caller. */
async function readCached<T>(redis: Redis, key: string, isValid: (value: unknown) => value is T): Promise<T | undefined> {
  let raw: string | null;
  try {
    raw = await redis.get(key);
  } catch {
    // Redis outage. Degrade OPEN: the caller falls back to `load`.
    return undefined;
  }
  if (raw === null) return undefined;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Corrupt value: not JSON. Treated as a miss, never a throw.
    return undefined;
  }
  // Corrupt value: JSON of the wrong shape. Redis holds whatever the last deploy put there;
  // a shape change must not take the site down, so this is a miss too, never a throw.
  return isValid(parsed) ? parsed : undefined;
}

async function writeThrough<T>(redis: Redis, key: string, ttlSeconds: number, value: T): Promise<void> {
  try {
    await redis.set(key, JSON.stringify(value), "EX", ttlSeconds);
  } catch {
    // Degrade OPEN: a failed cache write must never fail the read path that triggered it.
  }
}

async function cached<T>(
  redis: Redis,
  key: string,
  ttlSeconds: number,
  isValid: (value: unknown) => value is T,
  load: () => Promise<T>,
): Promise<T> {
  const hit = await readCached(redis, key, isValid);
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
 * Cached values are guarded on read with the same rigor `score-cache.ts` uses for `TeamScore` —
 * real field checks (`isPlayerIndex`, `isScoringSettings`), not just "did `JSON.parse` throw" —
 * so a value of the right JSON but the wrong shape is a miss, not a bad value handed to a caller.
 *
 * Degrades OPEN, the same posture `score-cache.ts` takes and for the same reason: a Redis
 * outage falls through to `load` and costs milliseconds, never correctness.
 */
export function createReferenceCache({ redis }: ReferenceCacheDeps): ReferenceCache {
  async function players(load: () => Promise<readonly Player[]>): Promise<readonly Player[]> {
    return cached(redis, STATS_INGESTION_CONFIG.keys.playerIndex, STATS_INGESTION_CONFIG.ttlSeconds.playerIndex, isPlayerIndex, load);
  }

  async function invalidatePlayers(): Promise<void> {
    await invalidate(redis, STATS_INGESTION_CONFIG.keys.playerIndex);
  }

  async function scoringSettings(leagueId: string, load: () => Promise<ScoringSettings>): Promise<ScoringSettings> {
    return cached(
      redis,
      STATS_INGESTION_CONFIG.keys.scoringSettings(leagueId),
      STATS_INGESTION_CONFIG.ttlSeconds.scoringSettings,
      isScoringSettings,
      load,
    );
  }

  async function invalidateScoringSettings(leagueId: string): Promise<void> {
    await invalidate(redis, STATS_INGESTION_CONFIG.keys.scoringSettings(leagueId));
  }

  return { players, invalidatePlayers, scoringSettings, invalidateScoringSettings };
}
