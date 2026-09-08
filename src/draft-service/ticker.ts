import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { drafts } from "@/db/schema";
import { DRAFT_ACTION_VERSION } from "@/domain/draft";
import type { Clock } from "@/domain/timing";
import { currentDeadline } from "@/draft-engine";
import { ensureHouseCatalog, rungOfHouseLeagueId, type HouseFactoryDeps, type HouseFactoryOutcome } from "@/league-service/house-factory";
import { MOCK_CONFIG } from "@/mock-draft/config";
import { createMockBotDriver, startDueMockRooms, type MockBotDriveFn, type MockBotDriver, type MockStartOutcome } from "@/mock-draft-service/driver";
import type { MockLifecycleDeps } from "@/mock-draft-service/claim";
import { sweepExpiredMocks, type MockSweepDeps, type SweptMockRoom } from "@/mock-draft-service/sweep";
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
  /**
   * Phase 4.5, Task 6's due scan: starts every mock room whose fill window (or early-start
   * grace, or failed solo self-start) has fired. Defaults to the real `startDueMockRooms`
   * (`@/mock-draft-service/driver`); injectable for the same fixture-free-stubbing reason
   * `autoStart`/`reconcileHouse` are.
   */
  readonly startDueMocks?: (db: Db, deps: Pick<MockLifecycleDeps, "store" | "clock" | "newId">) => Promise<readonly MockStartOutcome[]>;
  /**
   * Task 6's bot driver: one PACED bot pick per live MOCK draft per tick, invoked from `tickOne`
   * against the very rows the expiry scan already fetched — no second scan. Defaults to
   * `mockDriver`'s own `driveBotPick` (the shared instance below).
   */
  readonly driveMockPick?: MockBotDriveFn;
  /**
   * The ONE `MockBotDriver` this process drives mocks through. `@/draft-service`'s
   * `getDraftTicker` injects its process-wide instance — the same one the advance funnel
   * prices bot turns through — so there is a single per-draft meta cache, and the sweep's
   * `invalidateDraft` wiring below empties it for BOTH callers. Defaults to a fresh instance
   * for tests that construct tickers directly.
   */
  readonly mockDriver?: MockBotDriver;
  /**
   * Task 6's retention sweep, gated by `MOCK_CONFIG.sweepIntervalMs` exactly the way
   * `reconcileHouse` is gated by `houseReconcileIntervalMs`. Defaults to the real
   * `sweepExpiredMocks` (`@/mock-draft-service/sweep`).
   */
  readonly sweepMocks?: (db: Db, deps: MockSweepDeps) => Promise<readonly SweptMockRoom[]>;
  /**
   * Tick-wide ceiling on bot picks across ALL mock drafts, defaulting to
   * `MOCK_CONFIG.maxBotPicksPerTick`; a drive lands at most one pick, so this is spent one per
   * landed pick. Once spent, the un-driven rooms' own state is untouched, and the next tick (or
   * each room's own SSE advance loop) resumes them from the log. That is the ceiling working,
   * not failing. Injectable so the exhausted-budget branch is a test's to reach rather than
   * dead configuration.
   */
  readonly maxBotPicksPerTick?: number;
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
  startDueMocks = startDueMockRooms,
  driveMockPick,
  mockDriver: injectedMockDriver,
  sweepMocks = sweepExpiredMocks,
  maxBotPicksPerTick = MOCK_CONFIG.maxBotPicksPerTick,
}: TickerDeps): DraftTicker {
  // The default driver closes over THIS ticker's db/store so its per-draft meta cache lives
  // exactly as long as the ticker does — built here rather than as a parameter default because
  // it needs both sibling parameters. Built even when `driveMockPick` is injected: the sweep
  // lane below always hands the sweep THIS driver's `invalidateDraft` (fix round, review
  // MEDIUM), and against an instance whose cache never filled that call is a free no-op.
  // When `mockDriver` IS injected (the process singleton, see `TickerDeps.mockDriver`), that
  // one instance serves both roles instead.
  const mockDriver = injectedMockDriver ?? createMockBotDriver({ db, store });
  const driveMock = driveMockPick ?? mockDriver.driveBotPick;
  let timer: ReturnType<typeof setInterval> | undefined;
  let running = false;
  // Per-tick bot-pick budget (see `maxBotPicksPerTick` above). Reset at the top of every tick;
  // decremented inside `tickOne`, which is safe because ticks never overlap (the `running`
  // guard below, and tests drive `tick()` sequentially).
  let botPickBudget = 0;
  // Last time (ms since epoch, per the injected clock) a given draft's failure was logged —
  // the first failure always logs; a rejection or thrown error may recur every tick, and
  // without this a stuck draft would log once per tick forever.
  const lastWarnedAtMs = new Map<string, number>();
  // `undefined` until the first reconcile ever runs, so a fresh ticker restocks the shelf on
  // its very first tick rather than waiting a full `houseReconcileIntervalMs` for a shelf that
  // may have sat empty since the last deploy.
  let lastHouseReconcileAtMs: number | undefined;
  // The sweep's own gate, the identical undefined-means-run-first-tick shape: a room whose
  // retention expired while the server was down is cleared on the first tick after a deploy.
  let lastMockSweepAtMs: number | undefined;

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
    // THE BOT DRIVER LANE (Phase 4.5, Task 6), on the very row the expiry scan fetched — no
    // second scan. It runs BEFORE the deadline check because a bot's think-delay always elapses
    // inside the room's clock (`MOCK_CONFIG.botDelay`'s cap — the T1 guarantee), so on any tick
    // where both could apply the bot's own MAKE_PICK is the correct event, not a TIMER_EXPIRE.
    // A driver failure falls through rather than returning: this draft's clock still needs
    // checking this tick, exactly like every other live draft's.
    if (state.config.isMock === true && botPickBudget > 0) {
      try {
        const driven = await driveMock(state, now);
        if (driven !== null) {
          if (driven.picked) {
            botPickBudget -= 1;
            return { draftId, applied: true };
          }
          return { draftId, applied: false, reason: driven.reason };
        }
      } catch (error: unknown) {
        console.error("[draft] mock bot driver failed for draft", draftId, error);
      }
    }
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
        // Wave-1 review Q3: `dissolveLeague`'s retirement path is the only headless writer in
        // this codebase that closes a league nobody asked it to close — an operator pressing the
        // same button leaves a trail on the admin console; this call leaves one here instead, one
        // line per retired league, so a retirement is never silent just because nobody watched it
        // happen.
        for (const leagueId of outcome.retired) {
          console.log("[house] retired", leagueId, rungOfHouseLeagueId(leagueId) ?? "unknown-rung");
        }
      } catch (error: unknown) {
        console.error("[draft] house reconcile failed", error);
      }
    }

    // Mock due-start THIRD (Phase 4.5, Task 6), still before the expiry scan below, for the
    // identical ordering argument auto-start records above: a mock started this tick gets its
    // first clock checked on the NEXT tick rather than being judged a millisecond after it
    // began. Outcomes ride the same rate-limited reporter; the mapped-409 race (`benignRace`)
    // maps to NOTHING at all — another instance already produced the state this scan wanted,
    // which is an answer, not an error (the T5 carry).
    try {
      const dueMocks = await startDueMocks(db, { store, clock, newId: () => crypto.randomUUID() });
      for (const outcome of dueMocks) {
        if (outcome.started) {
          outcomes.push({ draftId: outcome.draftId, applied: true });
          continue;
        }
        if (outcome.benignRace) continue;
        const mapped: TickOutcome = { draftId: `mock:${outcome.leagueId}`, applied: false, reason: outcome.reason };
        outcomes.push(mapped);
        reportIfDue(mapped, nowMs);
      }
    } catch (error: unknown) {
      console.error("[draft] mock due-start scan failed", error);
    }

    // Retention sweep FOURTH, gated by `sweepIntervalMs` (the `houseReconcileIntervalMs`
    // shape) — retention windows are hours long, so most ticks skip this entirely, and the
    // undefined-first-run arm clears any room whose window expired while the server was down.
    if (lastMockSweepAtMs === undefined || nowMs - lastMockSweepAtMs >= MOCK_CONFIG.sweepIntervalMs) {
      lastMockSweepAtMs = nowMs;
      try {
        // `invalidateDriverMeta` completes the swept room's cache story: the sweep already
        // drops the ranking cache and the store's materialization itself; the driver's own
        // per-draft meta is the third in-memory hold, and this ticker's driver is where it lives.
        await sweepMocks(db, { store, clock, invalidateDriverMeta: mockDriver.invalidateDraft });
      } catch (error: unknown) {
        console.error("[draft] mock sweep failed", error);
      }
    }

    // Reset the tick-wide bot budget before the scan whose `tickOne` calls spend it.
    botPickBudget = maxBotPicksPerTick;
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
