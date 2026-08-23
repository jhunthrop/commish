import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { drafts } from "@/db/schema";
import { DRAFT_ACTION_VERSION } from "@/domain/draft";
import type { Clock } from "@/domain/timing";
import { currentDeadline } from "@/draft-engine";
import { ensureHouseCatalog, type HouseFactoryDeps, type HouseFactoryOutcome } from "@/league-service/house-factory";
import { autoStartDueDrafts, type AutoStartDeps, type AutoStartOutcome } from "./auto-start";
import { DRAFT_SERVICE_CONFIG } from "./config";
import { NO_OP_NUDGE_SCHEDULER, type NudgeScheduler } from "./nudge";
import type { DraftStore } from "./store";

export interface TickOutcome {
  readonly draftId: string;
  readonly applied: boolean;
  readonly reason?: string;
}

/**
 * The expiry scan: every live draft whose clock this tick has to check. `drafts_status_idx`'s
 * FIRST reader, and the one whose plan `dueDraftsQuery`'s own widening to `(status, kickoff_at)`
 * had to leave undisturbed (migration 0029).
 *
 * Exported as the query BUILDER (not yet awaited), the shape `dueDraftsQuery`/`browseQuery`/
 * `openQuestionsQuery` already use, for the reason final review F16 named: the schema comment and
 * the decision doc both said "TWO READERS, MEASURED" while only ONE of the two had an EXPLAIN
 * assertion behind it. This is the seam that lets the second one be measured rather than argued
 * (`src/db/index-plans.test.ts`, "the ticker's expiry scan"), against the real query rather than a
 * hand copy (F9's lesson).
 *
 * Equality on the index's leading column, bounded by `maxDraftsPerTick` and ordered by `id` for
 * the same determinism the due-kickoff scan keeps.
 */
export function liveDraftsQuery(db: Db) {
  return db
    .select({ id: drafts.id })
    .from(drafts)
    .where(eq(drafts.status, "in_progress"))
    .orderBy(drafts.id)
    .limit(DRAFT_SERVICE_CONFIG.maxDraftsPerTick);
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
   * Task 7's scan for a public matchmade league's draft whose scheduled kickoff has passed.
   * Defaults to the real `autoStartDueDrafts` (`./auto-start`); injectable so a test can stub it
   * without seeding a public league for every ticker test that has nothing to do with scheduling.
   */
  readonly autoStart?: (db: Db, deps: AutoStartDeps) => Promise<readonly AutoStartOutcome[]>;
  /**
   * Phase 3.5 addendum, Task 13's reconciler: keeps `HOUSE_CATALOG`'s shelf stocked. Defaults to
   * the real `ensureHouseCatalog` (`@/league-service/house-factory`); injectable so a test can
   * stub it without seeding a house-catalog fixture for every ticker test that has nothing to do
   * with the shelf. Gated by `DRAFT_SERVICE_CONFIG.houseReconcileIntervalMs` (below) rather than
   * run every tick — a shelf of house leagues does not change once a second.
   */
  readonly reconcileHouse?: (db: Db, deps: HouseFactoryDeps) => Promise<HouseFactoryOutcome>;
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
  autoStart = autoStartDueDrafts,
  reconcileHouse = ensureHouseCatalog,
  onOutcome = defaultOnOutcome,
}: TickerDeps): DraftTicker {
  let timer: ReturnType<typeof setInterval> | undefined;
  let running = false;
  // Last time (ms since epoch, per the injected clock) a given draft's failure was logged —
  // the first failure always logs; a rejection or thrown error may recur every tick, and
  // without this a stuck draft would log once per tick forever.
  const lastWarnedAtMs = new Map<string, number>();
  // `undefined` until the first reconcile ever runs, so a fresh ticker restocks the shelf on
  // its very first tick rather than waiting a full `houseReconcileIntervalMs` for a shelf that
  // may have sat empty since the last deploy.
  let lastHouseReconcileAtMs: number | undefined;

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
    const now = clock.now();
    const nowMs = Date.parse(now);
    const outcomes: TickOutcome[] = [];

    // Auto-start FIRST, then the expiry scan below, so a draft this tick starts gets its first
    // clock checked on the NEXT tick rather than being expired a millisecond after it began. Its
    // own outcomes are reported through the identical rate-limited `reportIfDue` every expiry
    // failure already goes through; `autoStartDueDrafts` itself never throws past a single due
    // draft's own failure (see its own docblock, `./auto-start.ts`), but the SCAN query it opens
    // with can — a dropped connection here must not skip the expiry scan below any more than one
    // in-progress draft's own DB error is allowed to skip the rest of that scan.
    try {
      const started = await autoStart(db, { store, clock });
      for (const outcome of started) {
        const mapped: TickOutcome = { draftId: outcome.draftId, applied: outcome.started, reason: outcome.reason };
        outcomes.push(mapped);
        reportIfDue(mapped, nowMs);
      }
    } catch (error: unknown) {
      console.error("[draft] auto-start scan failed", error);
    }

    // House reconcile SECOND, still before the expiry scan below: a house league whose draft
    // this very tick auto-started (just above) is already off the shelf by the time this count
    // runs, so its replacement opens on the SAME tick that emptied it rather than waiting a
    // full reconcile interval. Gated by `houseReconcileIntervalMs` — most ticks skip this
    // entirely, and both sides of that gate are real: a tick before the interval elapses never
    // calls `reconcileHouse` at all, a tick at or after it always does.
    if (lastHouseReconcileAtMs === undefined || nowMs - lastHouseReconcileAtMs >= DRAFT_SERVICE_CONFIG.houseReconcileIntervalMs) {
      lastHouseReconcileAtMs = nowMs;
      try {
        const outcome = await reconcileHouse(db, { clock, newId: () => crypto.randomUUID() });
        for (const refusal of outcome.refused) {
          reportIfDue({ draftId: `house:${refusal.rung}`, applied: false, reason: refusal.reason }, nowMs);
        }
      } catch (error: unknown) {
        console.error("[draft] house reconcile failed", error);
      }
    }

    const rows = await liveDraftsQuery(db);

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
