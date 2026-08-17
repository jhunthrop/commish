import Redis from "ioredis";

function requireRedisUrl(): string {
  const url = process.env.REDIS_URL;
  if (url === undefined || url.length === 0) {
    throw new Error("REDIS_URL is not set. Copy .env.example to .env.local and run `docker compose up -d`.");
  }
  return url;
}

/**
 * A blocking XREAD holds its connection, so every SSE subscriber needs a dedicated
 * connection rather than sharing a pooled one. Publishing can share a single connection.
 */
export function createRedisConnection(): Redis {
  return new Redis(requireRedisUrl(), { maxRetriesPerRequest: null });
}

let shared: Redis | undefined;

/** Shared connection for non-blocking commands (publishing). Never use for XREAD BLOCK. */
export function getSharedRedis(): Redis {
  if (shared === undefined) {
    shared = createRedisConnection();
  }
  return shared;
}
