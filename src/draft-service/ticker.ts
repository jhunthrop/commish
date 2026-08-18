import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { drafts } from "@/db/schema";
import { DRAFT_ACTION_VERSION } from "@/domain/draft";
import type { Clock } from "@/domain/timing";
import { currentDeadline } from "@/draft-engine";
import { DRAFT_SERVICE_CONFIG } from "./config";
import { NO_OP_NUDGE_SCHEDULER, type NudgeScheduler } from "./nudge";
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
  /** The AI moderator. Defaults to a no-op so a ticker can run without one. */
  readonly nudger?: NudgeScheduler;
  /**
   * Called for every `applied: false` outcome, rate-limited per draft id (see
   * `DRAFT_SERVICE_CONFIG.tickWarnIntervalMs`) so a stuck draft is visible in logs without
   * spamming them. Defaults to `console.warn`.
   */
  readonly onOutcome?: (outcome: TickOutcome) => void;
}

const defaultOnOutcome = (outcome: TickOutcome): void => {
  console.warn("[draft] tick not applied", outcome);
};

/**
 * The only producer of TIMER_EXPIRE actions. Built around an injected `Clock` and an explicit
 * `tick()` so tests drive expiry deterministically instead of sleeping; `start()` is just a
 * setInterval around the same function for the running server.
 */
export function createDraftTicker({
  db,
  store,
  clock,
  intervalMs = DRAFT_SERVICE_CONFIG.tickIntervalMs,
  nudger = NO_OP_NUDGE_SCHEDULER,
  onOutcome = defaultOnOutcome,
}: TickerDeps): DraftTicker {
  let timer: ReturnType<typeof setInterval> | undefined;
  let running = false;
  // Last time (ms since epoch, per the injected clock) a given draft's failure was logged —
  // the first failure always logs; a rejection or thrown error may recur every tick, and
  // without this a stuck draft would log once per tick forever.
  const lastWarnedAtMs = new Map<string, number>();

  function reportIfDue(outcome: TickOutcome, nowMs: number): void {
    if (outcome.applied) return;
    const lastWarnedAt = lastWarnedAtMs.get(outcome.draftId);
    if (lastWarnedAt !== undefined && nowMs - lastWarnedAt < DRAFT_SERVICE_CONFIG.tickWarnIntervalMs) return;
    lastWarnedAtMs.set(outcome.draftId, nowMs);
    onOutcome(outcome);
  }

  async function tickOne(draftId: string, now: string): Promise<TickOutcome | null> {
    const state = await store.getDraftState(draftId);
    if (state === null) return null;
    const deadline = currentDeadline(state);
    if (deadline === null || Date.parse(now) < Date.parse(deadline)) {
      // The clock is still running — this is the window the moderator speaks in. It never
      // applies an action, so it can never change what this tick would otherwise have done.
      await nudger.nudge(state, now);
      return null;
    }
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
    const nowMs = Date.parse(now);
    const outcomes: TickOutcome[] = [];
    for (const row of rows) {
      try {
        const outcome = await tickOne(row.id, now);
        if (outcome !== null) {
          outcomes.push(outcome);
          reportIfDue(outcome, nowMs);
        }
      } catch (error: unknown) {
        // One draft's DB error (a dropped connection, a transient failure) must not stop
        // the scan — every other in-progress draft still needs its clock checked this tick.
        console.error("[draft] ticker failed for draft", row.id, error);
        const outcome: TickOutcome = { draftId: row.id, applied: false, reason: "Something went wrong checking this draft's clock." };
        outcomes.push(outcome);
        reportIfDue(outcome, nowMs);
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
