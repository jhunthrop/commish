import type { DraftPoolEntry, SetQueueAction } from "@/domain/draft";
import type { DraftReduceResult, DraftState } from "./state";

/**
 * Replaces one team's ranked autopick queue.
 *
 * Two checks are conditional on the draft having started, because `draftOrder` and `pool`
 * are both empty until START_DRAFT and a queue is a PRE-draft artifact by design: team
 * membership is enforced only once an order exists, and pool membership only once a pool
 * does. Before then the HTTP boundary (`POST /api/drafts/:id/queue`) is what proves the ids
 * name real players, and `queuedEntriesFor` below drops anything the pool doesn't contain
 * anyway — so a queue naming a player the draft never included is harmless, never fatal.
 *
 * Deliberately touches nothing but `queues`: editing a queue must never restart, extend or
 * shorten anybody's pick clock.
 *
 * The length cap lives in `admit.ts`, not here: `DRAFT_QUEUE_CONFIG.maxLength` is a tunable,
 * and re-checking it on replay would brick every draft holding a longer persisted queue —
 * which is precisely what `PERSISTED_QUEUE_MAX` exists to prevent.
 */
export function reduceSetQueue(state: DraftState, action: SetQueueAction): DraftReduceResult {
  const { playerIds, teamId } = action;
  if (new Set(playerIds).size !== playerIds.length) {
    return { ok: false, reason: "Each player may appear in your queue only once." };
  }
  if (state.draftOrder.length > 0 && !state.draftOrder.includes(teamId)) {
    return { ok: false, reason: "That team isn't in this draft." };
  }
  if (state.pool.length > 0) {
    const inPool = new Set(state.pool.map((entry) => entry.playerId));
    if (playerIds.some((id) => !inPool.has(id))) {
      return { ok: false, reason: "That player isn't in this draft's player pool." };
    }
  }
  return { ok: true, state: { ...state, queues: { ...state.queues, [teamId]: playerIds } } };
}

/**
 * The team's queue projected onto the pool, in queue order. Ids the pool doesn't contain are
 * dropped here rather than at write time, which is what lets a queue set before START_DRAFT
 * survive a pool snapshotted afterwards.
 */
export function queuedEntriesFor(state: DraftState, teamId: string): readonly DraftPoolEntry[] {
  const queue = state.queues[teamId] ?? [];
  const byId = new Map(state.pool.map((entry) => [entry.playerId, entry]));
  return queue.flatMap((playerId) => {
    const entry = byId.get(playerId);
    return entry === undefined ? [] : [entry];
  });
}
