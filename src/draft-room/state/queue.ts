/**
 * Pure ordered-list edits for the autopick queue. Display-layer arithmetic only: no length
 * cap lives here, because the cap (`DRAFT_QUEUE_CONFIG.maxLength`) is an ENGINE value and
 * the room may only import engine TYPES — re-declaring the number on this side of the wire
 * is exactly the drift the conventions forbid. The route rejects an over-long queue with its
 * own plain-language 409, which the room shows as a toast.
 */
export function addToQueue(queue: readonly string[], playerId: string): readonly string[] {
  return queue.includes(playerId) ? queue : [...queue, playerId];
}

export function removeFromQueue(queue: readonly string[], playerId: string): readonly string[] {
  return queue.filter((id) => id !== playerId);
}

/** Moves one entry by `delta` places, clamped to the ends. A no-op if the id isn't queued. */
export function moveInQueue(queue: readonly string[], playerId: string, delta: number): readonly string[] {
  const from = queue.indexOf(playerId);
  if (from === -1) return queue;
  const to = Math.min(queue.length - 1, Math.max(0, from + delta));
  if (to === from) return queue;
  const next = [...queue];
  next.splice(from, 1);
  next.splice(to, 0, playerId);
  return next;
}
