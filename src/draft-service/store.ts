import { asc, eq } from "drizzle-orm";
import type { Db, DbTx } from "@/db/client";
import { draftActions, drafts, teams } from "@/db/schema";
import { DRAFT_ACTION_VERSION, type DraftAction } from "@/domain/draft";
import type { Clock } from "@/domain/timing";
import {
  draftActionSchema,
  draftEventsFor,
  reduceDraft,
  replayDraft,
  type DraftState,
} from "@/draft-engine";
import type { RealtimeEventType } from "@/lib/realtime/events";
import { commitDraftState } from "./commit";
import { createKeyedMutex } from "./mutex";
import { draftOrderFor } from "./order";
import { buildDraftPool } from "./pool";
import { loadDraftConfig } from "./setup";

export type PublishFn = (input: {
  readonly leagueId: string;
  readonly type: RealtimeEventType;
  readonly payload: unknown;
}) => Promise<string | null>;

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

/** Postgres unique-violation SQLSTATE. */
const UNIQUE_VIOLATION_SQLSTATE = "23505";

/** The driver's `code`, unwrapping the `DrizzleQueryError` that carries it as `.cause`. */
function sqlState(error: unknown): unknown {
  if (typeof error !== "object" || error === null) return undefined;
  if ("code" in error) return (error as { code?: unknown }).code;
  if ("cause" in error) return sqlState((error as { cause?: unknown }).cause);
  return undefined;
}

/** Postgres unique-violation SQLSTATE, as surfaced by the `postgres` driver (possibly wrapped by drizzle-orm). */
function isUniqueViolation(error: unknown): boolean {
  return sqlState(error) === UNIQUE_VIOLATION_SQLSTATE;
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

  async function load(draftId: string): Promise<DraftState | null> {
    const cached = cache.get(draftId);
    if (cached !== undefined) return cached;
    const config = await loadDraftConfig(db, draftId);
    if (config === null) return null;
    const rows = await db
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
          if (isUniqueViolation(error)) return { ok: false, reason: "Someone else acted first. Try again." };
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
