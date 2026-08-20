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
import { getAuditLogger, type AuditLogger } from "@/integrity-service/audit-logger";
import type { RealtimeEventType } from "@/lib/realtime/events";
import type { PublishFn } from "@/lib/realtime/publish";
import { auditEventsForPicks } from "./audit";
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
  /** Defaults to the process-wide logger (`getAuditLogger()`). */
  readonly audit?: AuditLogger;
}

export type ApplyResult =
  | { readonly ok: true; readonly state: DraftState }
  | { readonly ok: false; readonly reason: string };

export interface ApplyOptions {
  /** Extra work to commit atomically with the action row (e.g. flipping `drafts.status`). */
  readonly alsoInTransaction?: (tx: DbTx) => Promise<void>;
  /** Who submitted this action. Absent means the clock acted (a `TIMER_EXPIRE`, never a person). */
  readonly actor?: { readonly id: string };
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
export function createDraftStore({ db, publish, clock, onPublishError, audit = getAuditLogger() }: DraftStoreDeps): DraftStore {
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
        // `previous` is captured out of the transaction so `broadcast` (which must run AFTER
        // the commit, because publishing is best-effort and must never fail a committed write)
        // still has the before-state to diff against.
        let previous: DraftState | null = null;

        try {
          const outcome = await db.transaction(async (tx): Promise<ApplyResult> => {
            /**
             * THE CROSS-INSTANCE LOCK. Every accepted action for this draft passes through this
             * one row, so "replay the action log" becomes the single-writer path across any
             * number of app instances rather than only across restarts.
             *
             * `SELECT ... FOR UPDATE` and not `pg_advisory_lock`: this connection reaches
             * Postgres through PgBouncer in transaction pooling mode, where session-scoped state
             * does not survive statement boundaries. A row lock is transaction-scoped by
             * construction, so it is taken and released entirely inside this block — which is
             * exactly the property transaction pooling requires and exactly the trap the spec
             * warns about. See docs/decisions/data-layer-hardening.md.
             *
             * Lock order: this is a leaf. `joinLeagueInTx` takes `league_invites` then `leagues`;
             * nothing takes `drafts` before either of those, and this function takes nothing
             * after `drafts`, so no cycle exists.
             */
            const [locked] = await tx.select({ id: drafts.id }).from(drafts).where(eq(drafts.id, draftId)).for("update");
            if (locked === undefined) return { ok: false, reason: "That draft doesn't exist." };

            // Loaded INSIDE the lock and validated against the log, so a state another instance
            // has already advanced can never be the state this action is admitted against.
            const state = await load(draftId, tx);
            if (state === null) return { ok: false, reason: "That draft doesn't exist." };
            previous = state;

            // Command-time preconditions — the tunable-reading guards the reducer must not own,
            // because it also runs on replay.
            const admitted = admitCommand(state, action);
            if (!admitted.ok) return admitted;

            const result = reduceDraft(state, action);
            if (!result.ok) return result;

            await tx.insert(draftActions).values({
              draftId,
              sequence: result.state.sequence,
              action,
              timestamp: new Date(action.timestamp),
            });
            // The audit append rides the draft's existing FOR UPDATE on `drafts`, and the chain
            // anchor is taken after it — the fixed lock order (ruling 3). Both this and the
            // action row commit together or neither does.
            const picked = auditEventsForPicks(state, result.state, options?.actor?.id ?? null);
            await audit.recordAll(tx, picked);
            if (options?.alsoInTransaction !== undefined) await options.alsoInTransaction(tx);
            // A completed draft becomes a season in the same transaction that completed it.
            if (result.state.phase === "complete" && state.phase !== "complete") {
              const counts = await commitDraftState(tx, result.state);
              await audit.record(tx, {
                eventType: "draft_completed",
                actorId: null,
                actorType: "system",
                leagueId: result.state.config.leagueId,
                payload: { draftId, picks: counts.picks, teams: counts.teams },
                occurredAt: action.timestamp,
              });
            }
            return { ok: true, state: result.state };
          });

          if (!outcome.ok) {
            // A rejection may have been decided against a state we loaded inside the lock and
            // then rolled back with it. Drop the materialization rather than keep one whose
            // provenance is a rolled-back transaction.
            cache.delete(draftId);
            return outcome;
          }

          cache.set(draftId, outcome.state);
          if (previous !== null) await broadcast(previous, outcome.state, action);
          return outcome;
        } catch (error: unknown) {
          // Our view of the log is provably stale — drop it so the next read replays.
          cache.delete(draftId);
          // The unique index remains the backstop. With the row lock in place this should be
          // unreachable; if it fires, that is a real signal that something wrote outside the
          // lock, so it keeps its user-facing retry message rather than being swallowed.
          if (isSequenceConflict(error)) return { ok: false, reason: "Someone else acted first. Try again." };
          throw error;
        }
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
