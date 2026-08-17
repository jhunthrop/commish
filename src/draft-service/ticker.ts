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

  async function tick(): Promise<readonly TickOutcome[]> {
    const rows = await db
      .select({ id: drafts.id })
      .from(drafts)
      .where(eq(drafts.status, "in_progress"))
      .limit(DRAFT_SERVICE_CONFIG.maxDraftsPerTick);

    const now = clock.now();
    const outcomes: TickOutcome[] = [];
    for (const row of rows) {
      const state = await store.getDraftState(row.id);
      if (state === null) continue;
      const deadline = currentDeadline(state);
      if (deadline === null || Date.parse(now) < Date.parse(deadline)) continue;
      const result = await store.applyAction(row.id, { v: DRAFT_ACTION_VERSION, type: "TIMER_EXPIRE", timestamp: now });
      outcomes.push(result.ok ? { draftId: row.id, applied: true } : { draftId: row.id, applied: false, reason: result.reason });
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
