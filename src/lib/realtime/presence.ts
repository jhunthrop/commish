import { randomUUID } from "node:crypto";
import type Redis from "ioredis";
import type { PublishFn } from "./publish";

/**
 * PRESENCE (Sideline P5: "a league has presence: who is here now"). Derived from the one thing
 * the server already knows for certain, the league SSE connections it is holding open, and
 * never from a client's own claim. Every open stream marks ITS OWN CONNECTION present on open
 * and on every keepalive, and retires that one mark when the socket closes; a member is present
 * while any connection of theirs holds a live mark, so a second tab or the 280s planned close of
 * one connection never blinks a member away. A mark older than `ttlMs` (a dropped socket that
 * never said goodbye) is treated as gone.
 *
 * A Redis HASH per league, field = `userId|connectionId`, value = last-seen epoch ms. The hash
 * expires on its own so a league nobody opens for a day holds nothing, and reads prune stale
 * fields as they go, so the hash stays the size of the room's open sockets.
 */
export const PRESENCE_CONFIG = {
  /** A mark older than this is a connection that is gone: three missed keepalives at 15s. */
  ttlMs: 45_000,
  key: (leagueId: string): string => `league:${leagueId}:presence`,
} as const;

/** The hash field for one connection. User ids never carry the bar, connection ids are uuids. */
const FIELD_SEPARATOR = "|";

function fieldFor(userId: string, connectionId: string): string {
  return `${userId}${FIELD_SEPARATOR}${connectionId}`;
}

function userOf(field: string): string {
  const at = field.lastIndexOf(FIELD_SEPARATOR);
  return at === -1 ? field : field.slice(0, at);
}

export interface PresenceStore {
  readonly markPresent: (leagueId: string, userId: string, connectionId: string, nowMs: number) => Promise<void>;
  /** Retires this connection's mark and nothing else: another tab of the same member stays. */
  readonly markAway: (leagueId: string, userId: string, connectionId: string) => Promise<void>;
  /** Distinct members with at least one connection seen inside `ttlMs` of `nowMs`, in no particular order. */
  readonly listPresent: (leagueId: string, nowMs: number) => Promise<readonly string[]>;
}

export function createPresenceStore(redis: Redis): PresenceStore {
  return {
    async markPresent(leagueId, userId, connectionId, nowMs) {
      const key = PRESENCE_CONFIG.key(leagueId);
      await redis.hset(key, fieldFor(userId, connectionId), String(nowMs));
      await redis.pexpire(key, PRESENCE_CONFIG.ttlMs * 2);
    },
    async markAway(leagueId, userId, connectionId) {
      await redis.hdel(PRESENCE_CONFIG.key(leagueId), fieldFor(userId, connectionId));
    },
    async listPresent(leagueId, nowMs) {
      const key = PRESENCE_CONFIG.key(leagueId);
      const marks = await redis.hgetall(key);
      const floor = nowMs - PRESENCE_CONFIG.ttlMs;
      const present = new Set<string>();
      const stale: string[] = [];
      for (const [field, seen] of Object.entries(marks)) {
        if (Number(seen) >= floor) present.add(userOf(field));
        else stale.push(field);
      }
      if (stale.length > 0) await redis.hdel(key, ...stale);
      return [...present];
    },
  };
}

export interface PresenceLifecycle {
  readonly onOpen: () => Promise<void>;
  readonly onKeepalive: () => Promise<void>;
  readonly onClose: () => Promise<void>;
}

/** What a `presence.changed` frame carries: the whole room, so a reader folds it without a read. */
export interface PresenceChangedPayload {
  readonly userIds: readonly string[];
}

interface PresenceLifecycleDeps {
  readonly store: PresenceStore;
  readonly publish: PublishFn;
  readonly now: () => number;
  /** Test seam over `randomUUID`: the id of THIS connection's mark. */
  readonly newConnectionId?: () => string;
}

/**
 * The three moments a league stream reports to the presence store, wired for one member's one
 * connection. Open and close each publish the room's whole present list on `presence.changed`
 * (H2: readers fold the frame, they do not re-read), keepalive only refreshes the mark. Every
 * call swallows its own failure: presence is a fact about the room, not the room itself, and a
 * Redis hiccup must never close the stream that carries the picks.
 */
export function presenceLifecycle({ store, publish, now, newConnectionId }: PresenceLifecycleDeps, leagueId: string, userId: string): PresenceLifecycle {
  const connectionId = newConnectionId?.() ?? randomUUID();
  const quietly = async (work: () => Promise<unknown>): Promise<void> => {
    try {
      await work();
    } catch {
      // A failed mark is a member who reads as away until the next keepalive, the honest answer.
    }
  };
  const announce = async (): Promise<void> => {
    const payload: PresenceChangedPayload = { userIds: await store.listPresent(leagueId, now()) };
    await publish({ leagueId, type: "presence.changed", payload });
  };
  return {
    onOpen: () =>
      quietly(async () => {
        await store.markPresent(leagueId, userId, connectionId, now());
        await announce();
      }),
    onKeepalive: () => quietly(() => store.markPresent(leagueId, userId, connectionId, now())),
    onClose: () =>
      quietly(async () => {
        await store.markAway(leagueId, userId, connectionId);
        await announce();
      }),
  };
}
