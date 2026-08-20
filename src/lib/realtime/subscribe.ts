import type Redis from "ioredis";
import { REALTIME_CONFIG } from "./config";
import type { RealtimeEvent, RealtimeEventType } from "./events";

interface SubscribeInput {
  readonly redis: Redis;
  /**
   * The Redis Stream key to read — a league's broadcast (`REALTIME_CONFIG.leagueStreamKey`) or
   * one user's own stream (`REALTIME_CONFIG.userStreamKey`). Resolved by the caller, not here:
   * this iterator has no opinion about which key format a given event type belongs on.
   */
  readonly streamKey: string;
  /**
   * Resume cursor. "$" = only events published from now on (fresh connection);
   * a stream entry id = replay everything after it (a reconnecting client's Last-Event-ID).
   */
  readonly afterId?: string;
  readonly signal: AbortSignal;
}

type XReadReply = readonly [key: string, entries: readonly [id: string, fields: readonly string[]][]][] | null;

function fieldsToRecord(fields: readonly string[]): Readonly<Record<string, string>> {
  const out: Record<string, string> = {};
  for (let i = 0; i + 1 < fields.length; i += 2) {
    const key = fields[i];
    const value = fields[i + 1];
    if (key !== undefined && value !== undefined) out[key] = value;
  }
  return out;
}

function toEvent(id: string, fields: readonly string[]): RealtimeEvent | null {
  const f = fieldsToRecord(fields);
  if (f.type === undefined || f.leagueId === undefined || f.timestamp === undefined) return null;
  let payload: unknown = null;
  try {
    payload = f.payload === undefined ? null : JSON.parse(f.payload);
  } catch {
    payload = null;
  }
  return { id, type: f.type as RealtimeEventType, leagueId: f.leagueId, payload, timestamp: f.timestamp };
}

/**
 * The one real-time delivery mechanism: an async iterator of events for a stream key,
 * read with plain XREAD BLOCK from a per-connection cursor.
 *
 * Deliberately NOT a consumer group. XREADGROUP partitions each entry to exactly one
 * consumer in the group; a draft room needs every viewer to see every pick. XREAD gives
 * every subscriber its own independent cursor over the same stream — true broadcast —
 * with no group bookkeeping to leak. Broadcast semantics are exactly right for a league
 * stream (every member should see every pick) and equally right for a user stream (every
 * one of that user's own open tabs should see every notice) — the same mechanism serves
 * both because nothing about it assumes there is only one legitimate reader.
 */
const ABORTED = Symbol("aborted");

/** Resolves when the signal aborts, so a blocking XREAD can be raced against cancellation. */
function abortPromise(signal: AbortSignal): Promise<typeof ABORTED> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve(ABORTED);
      return;
    }
    signal.addEventListener("abort", () => resolve(ABORTED), { once: true });
  });
}

export async function* subscribe({ redis, streamKey, afterId = "$", signal }: SubscribeInput): AsyncGenerator<RealtimeEvent> {
  const aborted = abortPromise(signal);
  let cursor = afterId;
  while (!signal.aborted) {
    // Race the blocking read against abort so a disconnected client releases immediately,
    // rather than only after the current BLOCK window (up to blockMs) expires.
    const read = redis.xread("BLOCK", REALTIME_CONFIG.blockMs, "STREAMS", streamKey, cursor) as Promise<XReadReply>;
    const outcome = await Promise.race([read, aborted]);
    if (outcome === ABORTED) return;
    if (outcome === null) continue;
    for (const [, entries] of outcome) {
      for (const [id, fields] of entries) {
        cursor = id;
        const event = toEvent(id, fields);
        if (event !== null) yield event;
      }
    }
  }
}
