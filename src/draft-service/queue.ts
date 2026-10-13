import { inArray } from "drizzle-orm";
import type { Db } from "@research-ts/db/client";
import { players } from "@research-ts/db/schema";
import type { Clock } from "@research-ts/domain/timing";
import { queueFor, toSetQueueAction } from "@/draft-engine";
import type { DraftStore } from "./store";

export interface QueueDeps {
  readonly db: Db;
  readonly store: DraftStore;
  readonly clock: Clock;
}

export interface SetQueueInput {
  readonly draftId: string;
  readonly teamId: string;
  readonly playerIds: readonly string[];
}

export type QueueResult =
  | { readonly ok: true; readonly queue: readonly string[] }
  | { readonly ok: false; readonly reason: string };

/**
 * Replaces one team's autopick queue.
 *
 * The existence check against `players` is what makes a PRE-draft queue safe: the engine
 * can't validate against `state.pool` before START_DRAFT snapshots it, so the boundary does
 * it here instead. Everything after that is the ordinary action path — persist, cache,
 * publish — so the queue is replay-durable like every other decision in the draft.
 */
export async function setTeamQueue({ db, store, clock }: QueueDeps, input: SetQueueInput): Promise<QueueResult> {
  const { draftId, teamId, playerIds } = input;
  if (playerIds.length > 0) {
    const found = await db.select({ id: players.id }).from(players).where(inArray(players.id, [...playerIds]));
    if (found.length !== new Set(playerIds).size) {
      return { ok: false, reason: "We couldn't find one of those players. Refresh and try again." };
    }
  }
  const result = await store.applyAction(draftId, toSetQueueAction(playerIds, teamId, clock.now()));
  return result.ok ? { ok: true, queue: queueFor(result.state, teamId) } : { ok: false, reason: result.reason };
}

/** The team's stored queue, or null when the draft doesn't exist. */
export async function getTeamQueue(store: DraftStore, draftId: string, teamId: string): Promise<readonly string[] | null> {
  const state = await store.getDraftState(draftId);
  return state === null ? null : queueFor(state, teamId);
}
