import Redis, { type RedisOptions } from "ioredis";
import { REALTIME_CONFIG } from "./config";

function requireRedisUrl(): string {
  const url = process.env.REDIS_URL;
  if (url === undefined || url.length === 0) {
    throw new Error("REDIS_URL is not set. Copy .env.example to .env.local and run `docker compose up -d`.");
  }
  return url;
}

/** What a connection is for, which decides how long it may wait on Redis. */
export type RedisRole = "publish" | "subscribe";

/**
 * FINITE RETRIES, EVERYWHERE (draft-room performance round, item 4). Every connection used to
 * carry `maxRetriesPerRequest: null`: a command against a Redis that would not answer waited for
 * the reconnect forever, which on production was a publish (or a wake write) hanging an advance
 * until the sweep's 45 s attempt timeout dead-lettered it (fifty `connect ETIMEDOUT` in seven
 * days, Phase 1). Now a command is retried a bounded number of times and every non-blocking
 * command is cut off at `REALTIME_CONFIG.commandTimeoutMs`, so a publish FAILS in a few seconds
 * and the caller reports it (the write it announces is already committed). A subscriber's
 * `XREAD BLOCK` waits `blockMs` by design, so it takes the bounded retries and no command
 * timeout: a dropped socket surfaces as a stream error the browser reconnects from.
 */
export function redisOptionsFor(role: RedisRole): RedisOptions {
  const shared: RedisOptions = { maxRetriesPerRequest: REALTIME_CONFIG.maxRetriesPerRequest, connectTimeout: REALTIME_CONFIG.connectTimeoutMs };
  return role === "publish" ? { ...shared, commandTimeout: REALTIME_CONFIG.commandTimeoutMs } : shared;
}

/**
 * A blocking XREAD holds its connection, so every SSE subscriber needs a dedicated
 * connection rather than sharing a pooled one. Publishing can share a single connection.
 */
export function createRedisConnection(role: RedisRole = "publish"): Redis {
  return new Redis(requireRedisUrl(), redisOptionsFor(role));
}

let shared: Redis | undefined;

/** Shared connection for non-blocking commands (publishing). Never use for XREAD BLOCK. */
export function getSharedRedis(): Redis {
  if (shared === undefined) {
    shared = createRedisConnection("publish");
  }
  return shared;
}
