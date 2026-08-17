export interface KeyedMutex {
  run<T>(key: string, task: () => Promise<T>): Promise<T>;
}

/**
 * Serializes work per key by chaining promises.
 *
 * Phase 1 runs a single Node process, so an in-process queue is enough to keep two
 * submissions for the same draft from interleaving their read-validate-write. Phase 2 (multi
 * instance) replaces this with a Postgres advisory lock — which is exactly why the unique
 * index on (draft_id, sequence) exists as well: the database, not this map, is what makes a
 * double append impossible.
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
