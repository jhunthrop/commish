import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { drafts } from "@/db/schema";
import { DRAFT_ACTION_VERSION } from "@/domain/draft";
import type { Clock } from "@/domain/timing";
import { currentDeadline } from "@/draft-engine";
import { DRAFT_SERVICE_CONFIG } from "./config";
import type { DraftStore } from "./store";

export interface TickOutcome {
  readonly draftId: string;
  readonly applied: boolean;
  readonly reason?: string;
}

export interface DraftTicker {
  /** Expire every clock that has run out, once. Tests drive this directly. */
  tick(): Promise<readonly TickOutcome[]>;
  start(): void;
  stop(): void;
}

interface TickerDeps {
  readonly db: Db;
  readonly store: DraftStore;
  readonly clock: Clock;
  readonly intervalMs?: number;
}

/**
 * The only producer of TIMER_EXPIRE actions. Built around an injected `Clock` and an explicit
 * `tick()` so tests drive expiry deterministically instead of sleeping; `start()` is just a
 * setInterval around the same function for the running server.
 */
export function createDraftTicker({ db, store, clock, intervalMs = DRAFT_SERVICE_CONFIG.tickIntervalMs }: TickerDeps): DraftTicker {
  let timer: ReturnType<typeof setInterval> | undefined;
  let running = false;

  async function tickOne(draftId: string, now: string): Promise<TickOutcome | null> {
    const state = await store.getDraftState(draftId);
    if (state === null) return null;
    const deadline = currentDeadline(state);
    if (deadline === null || Date.parse(now) < Date.parse(deadline)) return null;
    const result = await store.applyAction(draftId, { v: DRAFT_ACTION_VERSION, type: "TIMER_EXPIRE", timestamp: now });
    return result.ok ? { draftId, applied: true } : { draftId, applied: false, reason: result.reason };
  }

  async function tick(): Promise<readonly TickOutcome[]> {
    const rows = await db
      .select({ id: drafts.id })
      .from(drafts)
      .where(eq(drafts.status, "in_progress"))
      .orderBy(drafts.id)
      .limit(DRAFT_SERVICE_CONFIG.maxDraftsPerTick);

    const now = clock.now();
    const outcomes: TickOutcome[] = [];
    for (const row of rows) {
      try {
        const outcome = await tickOne(row.id, now);
        if (outcome !== null) outcomes.push(outcome);
      } catch (error: unknown) {
        // One draft's DB error (a dropped connection, a transient failure) must not stop
        // the scan — every other in-progress draft still needs its clock checked this tick.
        console.error("[draft] ticker failed for draft", row.id, error);
        outcomes.push({ draftId: row.id, applied: false, reason: "Something went wrong checking this draft's clock." });
      }
    }
    return outcomes;
  }

  return {
    tick,
    start() {
      if (timer !== undefined) return;
      timer = setInterval(() => {
        // Never overlap ticks: a slow tick must not stack another on top of it.
        if (running) return;
        running = true;
        void tick()
          .catch((error: unknown) => {
            console.error("[draft] ticker failed", error);
          })
          .finally(() => {
            running = false;
          });
      }, intervalMs);
    },
    stop() {
      if (timer === undefined) return;
      clearInterval(timer);
      timer = undefined;
    },
  };
}
