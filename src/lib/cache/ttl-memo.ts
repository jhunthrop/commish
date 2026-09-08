/**
 * AN IN-PROCESS, TIME-BOUNDED MEMO for reference reads that do not vary per user (Neon cost
 * audit 2026-09-07, findings 6 and 7): the week's fixtures, each team's bye, the board's
 * reasons, the crosswalk, the newest projections capture. On a warm Fluid Compute instance every
 * league room render re-read these unchanged rows; with a memo the instance reads them once per
 * TTL and the cost of a render is the rows that actually differ per user.
 *
 * WHY NOT `unstable_cache`. Next's data cache serializes through JSON (a `Map` becomes `{}`),
 * throws outside a Next request context (every service test), and on Vercel is itself a
 * network hop into a billed store. A process-local memo is the shape the audit's savings come
 * from — the warm instance — with none of that. The trade is cross-instance invalidation: a
 * write is visible to another instance only when its entry expires, so every TTL here is set
 * below the source's own refresh cadence and stated beside the memo that uses it.
 *
 * Pure over an injected clock so a test can age an entry without waiting. Entries are keyed by
 * a caller-built string; the value is whatever the loader returned, shared by reference, so
 * loaders return immutable shapes (`ReadonlyMap`, frozen objects) and callers never mutate them.
 */
import type { Clock } from "@/domain/timing";

export interface TtlMemo<T> {
  /** The cached value for `key`, or the loader's fresh one when absent or expired. In-flight
   *  loads are shared: two concurrent misses on one key run the loader once. */
  get(key: string, load: () => Promise<T>): Promise<T>;
  /** Drops one key (a writer's own invalidation) — or every key when none is named. */
  invalidate(key?: string): void;
}

interface Entry<T> {
  readonly value: Promise<T>;
  readonly expiresAtMs: number;
}

const systemClock: Clock = { now: () => new Date().toISOString() };

/** Every memo ever created, so a test harness that reseeds the database can empty them all
 *  (`truncateAll` in `src/db/test-db.ts`) the way it already resets `rankedPlayers`' cache. */
const registry = new Set<TtlMemo<unknown>>();

/**
 * MEMOS BY THE SOURCE THEY CACHE (site search fix round, 2026-09-08). A TTL bounds how stale a
 * memo may be on an instance that saw no write; it cannot see a write. A memo that names its
 * source's group is dropped the moment that source is written on THIS instance
 * (`invalidateTtlMemoGroup`), so a board re-persist reaches the search index and the team pages
 * at once rather than within the hour. Other instances still learn of the write by expiry, the
 * cross-instance trade the module docblock already states.
 */
const groups = new Map<string, Set<TtlMemo<unknown>>>();

/** The group every memo built on the served board joins: the generic board, its reasons, the
 *  search index, the team pages. `writePreseasonBoard` clears it. */
export const BOARD_MEMO_GROUP = "board";

export interface TtlMemoOptions {
  /** The source this memo caches, for write-triggered invalidation. */
  readonly group?: string;
}

/** Test-only escape hatch: drops every entry of every memo in this process. */
export function invalidateAllTtlMemosForTests(): void {
  for (const memo of registry) memo.invalidate();
}

/** Drops every entry of every memo in `group`; answers how many memos were cleared. */
export function invalidateTtlMemoGroup(group: string): number {
  const members = groups.get(group);
  if (members === undefined) return 0;
  for (const memo of members) memo.invalidate();
  return members.size;
}

export function createTtlMemo<T>(ttlMs: number, clock: Clock = systemClock, options: TtlMemoOptions = {}): TtlMemo<T> {
  if (!(ttlMs > 0)) throw new Error(`createTtlMemo: ttlMs must be positive, got ${ttlMs}.`);
  const entries = new Map<string, Entry<T>>();
  const memo = build<T>(ttlMs, clock, entries);
  registry.add(memo as TtlMemo<unknown>);
  if (options.group !== undefined) {
    const members = groups.get(options.group) ?? new Set<TtlMemo<unknown>>();
    members.add(memo as TtlMemo<unknown>);
    groups.set(options.group, members);
  }
  return memo;
}

function build<T>(ttlMs: number, clock: Clock, entries: Map<string, Entry<T>>): TtlMemo<T> {
  return {
    get: (key, load) => {
      const nowMs = Date.parse(clock.now());
      const held = entries.get(key);
      if (held !== undefined && held.expiresAtMs > nowMs) return held.value;
      const value = load();
      entries.set(key, { value, expiresAtMs: nowMs + ttlMs });
      // A failed load must not be served for the whole TTL: drop it so the next call retries.
      value.catch(() => {
        if (entries.get(key)?.value === value) entries.delete(key);
      });
      return value;
    },
    invalidate: (key) => {
      if (key === undefined) entries.clear();
      else entries.delete(key);
    },
  };
}
