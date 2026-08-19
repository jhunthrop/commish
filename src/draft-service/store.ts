import { asc, eq, sql } from "drizzle-orm";
import type { Db, DbTx } from "@/db/client";
import { isUniqueViolation } from "@/db/errors";
import { draftActions, drafts, teams } from "@/db/schema";
import { DRAFT_ACTION_VERSION, type DraftAction } from "@/domain/draft";
import type { Clock } from "@/domain/timing";
import {
  admitCommand,
  AUCTION_CONFIG,
  draftActionSchema,
  draftEventsFor,
  reduceDraft,
  replayDraft,
  type DraftState,
} from "@/draft-engine";
import type { RealtimeEventType } from "@/lib/realtime/events";
import type { PublishFn } from "@/lib/realtime/publish";
import { commitDraftState } from "./commit";
import { createKeyedMutex } from "./mutex";
import { draftOrderFor } from "./order";
import { buildDraftPool } from "./pool";
import { loadDraftConfig } from "./setup";

export type { PublishFn } from "@/lib/realtime/publish";

interface PublishFailureEvent {
  readonly type: RealtimeEventType;
  readonly leagueId: string;
}

export interface DraftStoreDeps {
  readonly db: Db;
  readonly publish: PublishFn;
  readonly clock: Clock;
  /** Optional sink for publish failures — mirrors `PublisherDeps.onError`. Defaults to a no-op. */
  readonly onPublishError?: (error: unknown, event: PublishFailureEvent) => void;
}

export type ApplyResult =
  | { readonly ok: true; readonly state: DraftState }
  | { readonly ok: false; readonly reason: string };

export interface ApplyOptions {
  /** Extra work to commit atomically with the action row (e.g. flipping `drafts.status`). */
  readonly alsoInTransaction?: (tx: DbTx) => Promise<void>;
}

export type CommitResult =
  | { readonly ok: true; readonly picks: number; readonly teams: number; readonly alreadyCommitted: boolean }
  | { readonly ok: false; readonly reason: string };

export interface DraftStore {
  getDraftState(draftId: string): Promise<DraftState | null>;
  applyAction(draftId: string, action: DraftAction, options?: ApplyOptions): Promise<ApplyResult>;
  invalidate(draftId: string): void;
  startDraft(draftId: string): Promise<ApplyResult>;
  commitDraftResults(draftId: string): Promise<CommitResult>;
}

/** The unique index `applyAction`'s append actually races on — see `schema.ts`. */
const SEQUENCE_UNIQUE_INDEX = "draft_actions_draft_sequence_idx";

/**
 * True only for the specific race `applyAction` retries on: two writers both inserting the
 * same `(draft_id, sequence)`. Keying on the constraint name — not just the SQLSTATE — matters
 * because 23505 is the generic "unique violation" code; a `draft_picks` primary-key clash
 * from `commitDraftState` running inside the same transaction is also a 23505, and mislabeling
 * that as "Someone else acted first. Try again." would hide a real commit bug behind a retry
 * message instead of surfacing it as the unexpected error it is.
 */
export function isSequenceConflict(error: unknown): boolean {
  return isUniqueViolation(error, SEQUENCE_UNIQUE_INDEX);
}

/**
 * The highest `sequence` this draft's action log holds, or 0 for a log with no rows.
 *
 * This is the whole cross-instance freshness mechanism. `DraftState.sequence` counts accepted
 * actions and is exactly the value written to `draft_actions.sequence` for the row that action
 * produced, so a cached state whose `sequence` equals this is provably a materialization of the
 * complete log and a cached state whose `sequence` is lower is provably behind. One row, served
 * by the existing unique index on `(draft_id, sequence)`.
 *
 * Takes `Db | DbTx` because Task 7's locked write path calls it INSIDE the transaction that
 * holds the draft's row lock, where using the outer `db` would read outside the lock.
 */
export async function latestActionSequence(db: Db | DbTx, draftId: string): Promise<number> {
  const [row] = await db
    .select({ latest: sql<number | null>`max(${draftActions.sequence})` })
    .from(draftActions)
    .where(eq(draftActions.draftId, draftId));
  return row?.latest ?? 0;
}

/**
 * The durable draft session store.
 *
 * The `draft_actions` log is the source of truth; `cache` is only a materialization of it,
 * so losing the process loses nothing. Every accepted action is persisted BEFORE it reaches
 * the cache or the wire, and publishing is best-effort after the write — a Redis outage must
 * never make a committed pick look rejected.
 *
 * The mutex below is per-draft and NOT reentrant: `getDraftState` and `applyAction` each
 * acquire it once. Any method added to this store must never call the store's own public
 * methods while already holding the mutex — do reads before acquiring it (or after releasing
 * it), and drive same-transaction side effects through `alsoInTransaction` / the internal
 * helpers (`load`, `commitDraftState`) instead of recursing into `applyAction` or
 * `commitDraftResults`.
 */
export function createDraftStore({ db, publish, clock, onPublishError }: DraftStoreDeps): DraftStore {
  const cache = new Map<string, DraftState>();
  const mutex = createKeyedMutex();

  async function load(draftId: string, tx?: DbTx): Promise<DraftState | null> {
    const source = tx ?? db;
    const cached = cache.get(draftId);
    if (cached !== undefined) {
      // A cache built by THIS process can still be behind: another instance may have appended
      // to the same log. Verified, not assumed — see `latestActionSequence`.
      if ((await latestActionSequence(source, draftId)) === cached.sequence) return cached;
      cache.delete(draftId);
    }
    const config = await loadDraftConfig(source, draftId);
    if (config === null) return null;
    const rows = await source
      .select()
      .from(draftActions)
      .where(eq(draftActions.draftId, draftId))
      .orderBy(asc(draftActions.sequence));
    const state = replayDraft(config, rows.map((row) => draftActionSchema.parse(row.action)));
    cache.set(draftId, state);
    return state;
  }

  async function broadcast(previous: DraftState, next: DraftState, action: DraftAction): Promise<void> {
    for (const event of draftEventsFor(previous, next, action)) {
      try {
        await publish({ leagueId: next.config.leagueId, type: event.type, payload: event.payload });
      } catch (error: unknown) {
        // Best-effort by contract: the write is already committed and clients can refetch.
        onPublishError?.(error, { type: event.type, leagueId: next.config.leagueId });
      }
    }
  }

  const store: DraftStore = {
    async getDraftState(draftId) {
      return mutex.run(draftId, () => load(draftId));
    },

    invalidate(draftId) {
      cache.delete(draftId);
    },

    async applyAction(draftId, action, options?: ApplyOptions) {
      return mutex.run(draftId, async (): Promise<ApplyResult> => {
        const state = await load(draftId);
        if (state === null) return { ok: false, reason: "That draft doesn't exist." };

        // Command-time preconditions — the tunable-reading guards the reducer must not own,
        // because it also runs on replay. Inside the mutex, against the state we just loaded,
        // so this is strictly stronger than checking them in the reducer was.
        const admitted = admitCommand(state, action);
        if (!admitted.ok) return admitted;

        const result = reduceDraft(state, action);
        if (!result.ok) return result;

        try {
          await db.transaction(async (tx) => {
            await tx.insert(draftActions).values({
              draftId,
              sequence: result.state.sequence,
              action,
              timestamp: new Date(action.timestamp),
            });
            if (options?.alsoInTransaction !== undefined) await options.alsoInTransaction(tx);
            // A completed draft becomes a season in the same transaction that completed it.
            if (result.state.phase === "complete" && state.phase !== "complete") {
              await commitDraftState(tx, result.state);
            }
          });
        } catch (error: unknown) {
          // Our view of the log is provably stale — drop it so the next read replays.
          cache.delete(draftId);
          if (isSequenceConflict(error)) return { ok: false, reason: "Someone else acted first. Try again." };
          throw error;
        }

        cache.set(draftId, result.state);
        await broadcast(state, result.state, action);
        return { ok: true, state: result.state };
      });
    },

    async startDraft(draftId) {
      // Reads happen OUTSIDE the mutex — applyAction (below) takes it once. Acquiring it
      // here too would deadlock, since the mutex is not reentrant.
      const config = await loadDraftConfig(db, draftId);
      if (config === null) return { ok: false, reason: "That draft doesn't exist." };

      // Guards against a draft the reducer's own "already started"/"already finished" checks
      // cannot see: one whose `drafts.status` was written straight to "complete" (e.g. the
      // season-league seed, which deals rosters directly) without ever writing a single
      // action. Replaying that empty log yields phase "scheduled" — indistinguishable, to the
      // reducer, from a draft that has never run — so without this check START_DRAFT would be
      // admitted and would draft a second time over rosters that already exist.
      const [row] = await db.select({ status: drafts.status }).from(drafts).where(eq(drafts.id, draftId));
      if (row?.status === "complete") {
        const existingActions = await db.select({ id: draftActions.draftId }).from(draftActions).where(eq(draftActions.draftId, draftId)).limit(1);
        if (existingActions.length === 0) return { ok: false, reason: "This draft has already finished." };
      }

      const teamRows = await db.select({ id: teams.id }).from(teams).where(eq(teams.leagueId, config.leagueId));
      const pool = await buildDraftPool(db, config.leagueId);
      if (pool.length === 0) return { ok: false, reason: "There are no players to draft yet." };
      return store.applyAction(
        draftId,
        {
          v: DRAFT_ACTION_VERSION,
          type: "START_DRAFT",
          timestamp: clock.now(),
          draftOrder: draftOrderFor(draftId, teamRows.map((t) => t.id)),
          pool,
          // Command time is the ONE place the tunable is read — it rides the persisted
          // action from here on, so replay never consults AUCTION_CONFIG.
          minBid: AUCTION_CONFIG.minBid,
        },
        {
          alsoInTransaction: async (tx) => {
            await tx.update(drafts).set({ status: "in_progress" }).where(eq(drafts.id, draftId));
          },
        },
      );
    },

    async commitDraftResults(draftId) {
      return mutex.run(draftId, async (): Promise<CommitResult> => {
        // `load` (not `getDraftState`) — we already hold the mutex here.
        const state = await load(draftId);
        if (state === null) return { ok: false, reason: "That draft doesn't exist." };
        if (state.phase !== "complete") return { ok: false, reason: "This draft isn't finished yet." };
        const [row] = await db.select({ status: drafts.status }).from(drafts).where(eq(drafts.id, draftId));
        if (row?.status === "complete") {
          return { ok: true, picks: state.picks.length, teams: Object.keys(state.rosters).length, alreadyCommitted: true };
        }
        const counts = await db.transaction((tx) => commitDraftState(tx, state));
        return { ok: true, ...counts, alreadyCommitted: false };
      });
    },
  };

  return store;
}
