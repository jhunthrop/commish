import type Redis from "ioredis";
import type { PublishFn } from "./publish";

/**
 * PRESENCE (Sideline P5: "a league has presence: who is here now"). Derived from the one thing
 * the server already knows for certain, the league SSE connections it is holding open, and
 * never from a client's own claim. Every open stream marks its member present on open and on
 * every keepalive, and marks them away when the socket closes; a member whose mark is older
 * than `ttlMs` (a dropped socket that never said goodbye) is treated as gone.
 *
 * A Redis HASH per league, field = user id, value = last-seen epoch ms. The hash expires on its
 * own so a league nobody opens for a day holds nothing. Reads prune stale fields as they go, so
 * the hash stays the size of the room.
 */
export const PRESENCE_CONFIG = {
  /** A mark older than this is a member who is gone: three missed keepalives at 15s. */
  ttlMs: 45_000,
  key: (leagueId: string): string => `league:${leagueId}:presence`,
} as const;

export interface PresenceStore {
  readonly markPresent: (leagueId: string, userId: string, nowMs: number) => Promise<void>;
  readonly markAway: (leagueId: string, userId: string) => Promise<void>;
  /** Members seen inside `ttlMs` of `nowMs`, in no particular order. */
  readonly listPresent: (leagueId: string, nowMs: number) => Promise<readonly string[]>;
}

export function createPresenceStore(redis: Redis): PresenceStore {
  return {
    async markPresent(leagueId, userId, nowMs) {
      const key = PRESENCE_CONFIG.key(leagueId);
      await redis.hset(key, userId, String(nowMs));
      await redis.pexpire(key, PRESENCE_CONFIG.ttlMs * 2);
    },
    async markAway(leagueId, userId) {
      await redis.hdel(PRESENCE_CONFIG.key(leagueId), userId);
    },
    async listPresent(leagueId, nowMs) {
      const key = PRESENCE_CONFIG.key(leagueId);
      const marks = await redis.hgetall(key);
      const floor = nowMs - PRESENCE_CONFIG.ttlMs;
      const present: string[] = [];
      const stale: string[] = [];
      for (const [userId, seen] of Object.entries(marks)) {
        if (Number(seen) >= floor) present.push(userId);
        else stale.push(userId);
      }
      if (stale.length > 0) await redis.hdel(key, ...stale);
      return present;
    },
  };
}

export interface PresenceLifecycle {
  readonly onOpen: () => Promise<void>;
  readonly onKeepalive: () => Promise<void>;
  readonly onClose: () => Promise<void>;
}

interface PresenceLifecycleDeps {
  readonly store: PresenceStore;
  readonly publish: PublishFn;
  readonly now: () => number;
}

/**
 * The three moments a league stream reports to the presence store, wired for one member's one
 * connection. Every call swallows its own failure: presence is a fact about the room, not the
 * room itself, and a Redis hiccup must never close the stream that carries the picks.
 */
export function presenceLifecycle({ store, publish, now }: PresenceLifecycleDeps, leagueId: string, userId: string): PresenceLifecycle {
  const quietly = async (work: () => Promise<unknown>): Promise<void> => {
    try {
      await work();
    } catch {
      // Presence is decorative next to the stream it rides; a failed mark is a member who reads
      // as away until the next keepalive, which is the honest answer.
    }
  };
  const announce = (present: boolean) => publish({ leagueId, type: "presence.changed", payload: { userId, present } });
  return {
    onOpen: () =>
      quietly(async () => {
        await store.markPresent(leagueId, userId, now());
        await announce(true);
      }),
    onKeepalive: () => quietly(() => store.markPresent(leagueId, userId, now())),
    onClose: () =>
      quietly(async () => {
        await store.markAway(leagueId, userId);
        await announce(false);
      }),
  };
}
