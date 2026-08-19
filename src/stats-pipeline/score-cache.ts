import type Redis from "ioredis";
import type { TeamScore } from "./contract";
import { STATS_INGESTION_CONFIG } from "./config";

/** The read shape that carries the version. */
export interface CachedScores {
  readonly version: number;
  readonly scores: readonly TeamScore[];
}

/** One (league, week) pair to batch-read, at the version the caller considers fresh. */
export interface ScoreCacheBatchRequest {
  readonly leagueId: string;
  readonly week: number;
  readonly version: number;
}

export interface ScoreCache {
  /** A miss (including a stale-version miss and a corrupt-value miss) resolves `null`, never throws. */
  read(leagueId: string, week: number, version: number): Promise<readonly TeamScore[] | null>;
  /**
   * Many (league, week) pairs in ONE round trip — the cross-league home's read, where a manager
   * in ten leagues must cost one `MGET`, not ten `GET`s. Keyed in the returned map by
   * `STATS_INGESTION_CONFIG.keys.score(leagueId, week)`, the same key `read`/`write` use — a
   * caller already holding that key (or able to recompute it) needs no second key scheme.
   *
   * A miss for a given pair — absent, corrupt, or stale-version — is simply absent from the
   * returned map, never a `null` entry or a throw: the same degrade-open contract as `read`,
   * extended to "the whole call degrades open" rather than "each entry degrades open
   * independently", since one dead Redis fails every key in the batch identically.
   */
  readMany(requests: readonly ScoreCacheBatchRequest[]): Promise<ReadonlyMap<string, readonly TeamScore[]>>;
  write(leagueId: string, week: number, version: number, scores: readonly TeamScore[]): Promise<void>;
  invalidate(leagueId: string, week: number): Promise<void>;
}

interface ScoreCacheDeps {
  readonly redis: Redis;
}

function isTeamScore(value: unknown): value is TeamScore {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record.teamId === "string" && typeof record.points === "number";
}

function isCachedScores(value: unknown): value is CachedScores {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record.version === "number" && Array.isArray(record.scores) && record.scores.every(isTeamScore);
}

/**
 * One key per (leagueId, week). The version lives in the VALUE and not in the key, on purpose:
 * a version in the key would make invalidating on a lineup change either a SCAN over a pattern or
 * a bet that you know every version ever written. With it in the value, a read compares and
 * discards, and a lineup write is a single DEL of a key it can name exactly.
 *
 * Every method degrades OPEN. Phase 1's convention is that Postgres is authoritative and Redis is
 * an accelerator, so a Redis outage makes reads slower and never wrong, and never an error. This
 * is the deliberate opposite of `budget.ts`, which fails closed, for the reason recorded there.
 */
export function createScoreCache({ redis }: ScoreCacheDeps): ScoreCache {
  async function read(leagueId: string, week: number, version: number): Promise<readonly TeamScore[] | null> {
    try {
      const raw = await redis.get(STATS_INGESTION_CONFIG.keys.score(leagueId, week));
      if (raw === null) return null;

      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        // Corrupt value: not JSON. Redis holds whatever the last deploy put there; a shape
        // change must not take the site down, so this is a miss, never a throw.
        return null;
      }
      if (!isCachedScores(parsed)) return null; // Corrupt value: JSON of the wrong shape.
      if (parsed.version !== version) return null; // Stale version: the whole point.

      return parsed.scores;
    } catch {
      // Redis outage. Degrade OPEN: a cache that can fail a page render is worse than no cache.
      return null;
    }
  }

  async function readMany(requests: readonly ScoreCacheBatchRequest[]): Promise<ReadonlyMap<string, readonly TeamScore[]>> {
    const result = new Map<string, readonly TeamScore[]>();
    if (requests.length === 0) return result;
    try {
      const keys = requests.map((request) => STATS_INGESTION_CONFIG.keys.score(request.leagueId, request.week));
      const raws = await redis.mget(...keys);
      raws.forEach((raw, index) => {
        const request = requests[index]!;
        if (raw === null) return;

        let parsed: unknown;
        try {
          parsed = JSON.parse(raw);
        } catch {
          return; // Corrupt value: not JSON.
        }
        if (!isCachedScores(parsed)) return; // Corrupt value: JSON of the wrong shape.
        if (parsed.version !== request.version) return; // Stale version.

        result.set(keys[index]!, parsed.scores);
      });
      return result;
    } catch {
      return result; // Redis outage. Degrade OPEN, same as `read`.
    }
  }

  async function write(leagueId: string, week: number, version: number, scores: readonly TeamScore[]): Promise<void> {
    try {
      const value: CachedScores = { version, scores };
      await redis.set(
        STATS_INGESTION_CONFIG.keys.score(leagueId, week),
        JSON.stringify(value),
        "EX",
        STATS_INGESTION_CONFIG.ttlSeconds.score,
      );
    } catch {
      // Degrade OPEN: a failed cache write must never fail the write path that triggered it.
    }
  }

  async function invalidate(leagueId: string, week: number): Promise<void> {
    try {
      await redis.del(STATS_INGESTION_CONFIG.keys.score(leagueId, week));
    } catch {
      // Degrade OPEN: a failed invalidation is one possible stale read, not a thrown error.
    }
  }

  return { read, readMany, write, invalidate };
}
