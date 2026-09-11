import type Redis from "ioredis";
import { LEAGUE_CONFIG, type HeadToHeadRecord } from "@/league";

/** The wire shape in Redis: the map, flattened to entries, because JSON has no Map. */
type CachedEntries = readonly (readonly [string, HeadToHeadRecord])[];

export interface HeadToHeadCache {
  /** A miss — absent, corrupt, or a dead Redis — resolves `null`, never throws. */
  read(leagueId: string, week: number): Promise<ReadonlyMap<string, HeadToHeadRecord> | null>;
  write(leagueId: string, week: number, records: ReadonlyMap<string, HeadToHeadRecord>): Promise<void>;
  invalidate(leagueId: string, week: number): Promise<void>;
}

function isRecord(value: unknown): value is HeadToHeadRecord {
  if (typeof value !== "object" || value === null) return false;
  const held = value as Record<string, unknown>;
  return (
    typeof held.wins === "number" &&
    typeof held.losses === "number" &&
    typeof held.ties === "number" &&
    Array.isArray(held.seasons) &&
    held.seasons.every((season) => typeof season === "number")
  );
}

function isCachedEntries(value: unknown): value is CachedEntries {
  return Array.isArray(value) && value.every((entry) => Array.isArray(entry) && entry.length === 2 && typeof entry[0] === "string" && isRecord(entry[1]));
}

/**
 * The rival card's head-to-head answer, held per league and week.
 *
 * ONE ENTRY SERVES THE WHOLE ROOM. `headToHeadRecords` reads every pair in the league in one
 * query, so twelve managers opening the front page share one cached value rather than each
 * warming a slice of their own — the reason the service answers whole-league rather than per-pair.
 *
 * EVERY METHOD DEGRADES OPEN, the same convention `createScoreCache` states and for the same
 * reason: Postgres is authoritative and Redis is an accelerator, so an outage makes the card
 * slower and never wrong, and never an error.
 */
export function createHeadToHeadCache({ redis }: { readonly redis: Redis }): HeadToHeadCache {
  async function read(leagueId: string, week: number): Promise<ReadonlyMap<string, HeadToHeadRecord> | null> {
    try {
      const raw = await redis.get(LEAGUE_CONFIG.headToHead.cacheKey(leagueId, week));
      if (raw === null) return null;
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return null; // Corrupt value: not JSON. A shape change must never take the room down.
      }
      if (!isCachedEntries(parsed)) return null; // Corrupt value: JSON of the wrong shape.
      return new Map(parsed.map(([key, record]) => [key, record]));
    } catch {
      return null; // Redis outage. Degrade OPEN.
    }
  }

  async function write(leagueId: string, week: number, records: ReadonlyMap<string, HeadToHeadRecord>): Promise<void> {
    try {
      await redis.set(
        LEAGUE_CONFIG.headToHead.cacheKey(leagueId, week),
        JSON.stringify([...records.entries()]),
        "EX",
        LEAGUE_CONFIG.headToHead.cacheTtlSeconds,
      );
    } catch {
      // Degrade OPEN: a failed cache write must never fail the read that triggered it.
    }
  }

  async function invalidate(leagueId: string, week: number): Promise<void> {
    try {
      await redis.del(LEAGUE_CONFIG.headToHead.cacheKey(leagueId, week));
    } catch {
      // Degrade OPEN: a failed invalidation is one possible stale read, not a thrown error.
    }
  }

  return { read, write, invalidate };
}

/** What a caller that only ever settles needs — the settle path never reads or writes. */
export type HeadToHeadInvalidator = Pick<HeadToHeadCache, "invalidate">;

/** The do-nothing default for a caller with no Redis wired (the seed, a test). */
export const NOOP_HEAD_TO_HEAD_CACHE: HeadToHeadInvalidator = {
  invalidate: async () => {},
};
