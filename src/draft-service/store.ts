import { asc, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { draftActions } from "@/db/schema";
import type { DraftAction } from "@/domain/draft";
import type { Clock } from "@/domain/timing";
import {
  draftActionSchema,
  draftEventsFor,
  reduceDraft,
  replayDraft,
  type DraftState,
} from "@/draft-engine";
import type { RealtimeEventType } from "@/lib/realtime/events";
import { createKeyedMutex } from "./mutex";
import { loadDraftConfig } from "./setup";

export type PublishFn = (input: {
  readonly leagueId: string;
  readonly type: RealtimeEventType;
  readonly payload: unknown;
}) => Promise<string | null>;

export interface DraftStoreDeps {
  readonly db: Db;
  readonly publish: PublishFn;
  readonly clock: Clock;
}

export type ApplyResult =
  | { readonly ok: true; readonly state: DraftState }
  | { readonly ok: false; readonly reason: string };

export interface DraftStore {
  getDraftState(draftId: string): Promise<DraftState | null>;
  applyAction(draftId: string, action: DraftAction): Promise<ApplyResult>;
  invalidate(draftId: string): void;
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
 */
export function createDraftStore({ db, publish }: DraftStoreDeps): DraftStore {
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
      } catch {
        // Best-effort by contract: the write is already committed and clients can refetch.
      }
    }
  }

  return {
    async getDraftState(draftId) {
      return mutex.run(draftId, () => load(draftId));
    },

    invalidate(draftId) {
      cache.delete(draftId);
    },

    async applyAction(draftId, action) {
      return mutex.run(draftId, async (): Promise<ApplyResult> => {
        const state = await load(draftId);
        if (state === null) return { ok: false, reason: "That draft doesn't exist." };

        const result = reduceDraft(state, action);
        if (!result.ok) return result;

        try {
          await db.insert(draftActions).values({
            draftId,
            sequence: result.state.sequence,
            action,
            timestamp: new Date(action.timestamp),
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
  };
}
