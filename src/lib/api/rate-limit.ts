export interface RateLimitOptions {
  /** Requests one key may make inside one window. */
  readonly maxRequests: number;
  readonly windowMs: number;
  /** Injectable clock. Defaults to the wall clock; tests pass their own. */
  readonly now?: () => number;
}

export interface RateLimiter {
  /** Records one request against `key` and answers whether it is inside the ceiling. */
  readonly allow: (key: string) => boolean;
  /** Keys currently holding a live window — the sweep's observable half. */
  readonly tracked: () => number;
  /** Drops every window: what a process restart does, made explicit so tests stay independent. */
  readonly reset: () => void;
}

interface Window {
  readonly start: number;
  readonly count: number;
}

/**
 * A fixed-window request ceiling, per key, held in this process's memory.
 *
 * Deliberately the same shape and the same rationale as `openPerUser` in
 * `src/lib/realtime/sse.ts`: a blast-radius bound on a single instance, not a distributed
 * quota. It stops one authenticated caller from looping an expensive endpoint; it does not and
 * cannot account a budget across instances, and it resets when the process does.
 *
 * The map is bounded by sweeping lapsed windows whenever a key is first seen — the only moment
 * it would otherwise grow — so a process that has served a million users still holds only the
 * keys active inside one window.
 */
export function createRateLimiter({ maxRequests, windowMs, now = Date.now }: RateLimitOptions): RateLimiter {
  const windows = new Map<string, Window>();

  return {
    allow: (key) => {
      const at = now();
      const held = windows.get(key);
      if (held === undefined) {
        for (const [other, window] of windows) {
          if (at - window.start >= windowMs) windows.delete(other);
        }
        windows.set(key, { start: at, count: 1 });
        return true;
      }
      if (at - held.start >= windowMs) {
        windows.set(key, { start: at, count: 1 });
        return true;
      }
      const count = held.count + 1;
      windows.set(key, { start: held.start, count });
      return count <= maxRequests;
    },
    tracked: () => windows.size,
    reset: () => windows.clear(),
  };
}
