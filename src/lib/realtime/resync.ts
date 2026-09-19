/**
 * THE RESYNC MARKER (draft-room performance round, review finding 3). A pick is committed to
 * Postgres before the room is told over Redis; when that telling fails fast the picker's own view
 * updates from the POST body, but every other viewer's stream stays open and silent until its
 * planned close. The store marks the draft here the moment a publish fails, and every open
 * league stream reads the mark on its keepalive (`sse.ts`), relaying a `draft.resync` frame when
 * the mark is newer than the one it last saw, so a viewer refetches the room within one
 * keepalive. The mark is an ISO instant so a stream tells a new mark from the one it relayed.
 *
 * Best-effort both ways, and never thrown: a mark that cannot be written (the same Redis that
 * just refused the publish) is logged once per streak, and a read that fails is no mark.
 */
import type Redis from "ioredis";
import { REALTIME_CONFIG } from "./config";
import { getSharedRedis } from "./redis";

export interface ResyncMarker {
  /** Marks `draftId` as needing a resync, now. Never throws. */
  mark(draftId: string): Promise<void>;
  /** The mark's instant, or null when none stands. Never throws. */
  check(draftId: string): Promise<string | null>;
}

type MarkerRedis = Pick<Redis, "get" | "set">;

export function createResyncMarker(redis: MarkerRedis, now: () => string = () => new Date().toISOString()): ResyncMarker {
  let erroring = false;
  const report = (operation: string, error: unknown): void => {
    if (!erroring) console.error(`[realtime] resync marker ${operation} failed`, error);
    erroring = true;
  };
  return {
    async mark(draftId) {
      try {
        await redis.set(REALTIME_CONFIG.resyncKey(draftId), now(), "PX", REALTIME_CONFIG.resyncMarkerTtlMs);
        erroring = false;
      } catch (error: unknown) {
        report("write", error);
      }
    },
    async check(draftId) {
      try {
        const held = await redis.get(REALTIME_CONFIG.resyncKey(draftId));
        erroring = false;
        return held;
      } catch (error: unknown) {
        report("read", error);
        return null;
      }
    },
  };
}

let shared: ResyncMarker | undefined;

/** The process-wide marker over the shared Redis. */
export function getResyncMarker(): ResyncMarker {
  shared ??= createResyncMarker(getSharedRedis());
  return shared;
}
