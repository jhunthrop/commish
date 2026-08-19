export interface KeyedMutex {
  run<T>(key: string, task: () => Promise<T>): Promise<T>;
}

/**
 * Serializes work per key by chaining promises.
 *
 * Phase 1 ran a single Node process, so an in-process queue was enough to keep two submissions
 * for the same draft from interleaving their read-validate-write. It is still worth keeping as
 * an intra-process fast path — it turns same-process contention into a cheap queue instead of a
 * round trip to Postgres — but it is no longer what makes the write path safe. Phase 2 Plan A
 * moved the read-validate-write inside one transaction holding `SELECT ... FOR UPDATE` on the
 * draft's own row (`store.ts`), and made the cache validate itself against `MAX(sequence)`.
 *
 * A ROW lock and not a Postgres advisory lock, deliberately: `pg_advisory_lock` is
 * SESSION-scoped, and this app's connection reaches Postgres through PgBouncer in transaction
 * pooling mode, where a session is not a stable thing to hold anything on. `SELECT ... FOR
 * UPDATE` is transaction-scoped by construction, so it is released by the same COMMIT that
 * makes the write visible and it cannot leak onto whichever pooled backend serves the next
 * statement. See `docs/decisions/data-layer-hardening.md`.
 *
 * The unique index on `(draft_id, sequence)` remains the database's own backstop: a bug in
 * either lock can then cost a rejected action, never a double-drafted player.
 */
export function createKeyedMutex(): KeyedMutex {
  const tails = new Map<string, Promise<unknown>>();
  return {
    async run<T>(key: string, task: () => Promise<T>): Promise<T> {
      const previous = tails.get(key) ?? Promise.resolve();
      // Run whether the previous task fulfilled or rejected — one failure must not wedge the queue.
      const result = previous.then(task, task);
      const settled = result.then(
        () => undefined,
        () => undefined,
      );
      tails.set(key, settled);
      try {
        return await result;
      } finally {
        // Only the last queued task clears the key, so a follower is never orphaned.
        if (tails.get(key) === settled) tails.delete(key);
      }
    },
  };
}
