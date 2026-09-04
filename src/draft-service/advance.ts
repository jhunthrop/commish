import { and, eq, lte } from "drizzle-orm";
import type { Db } from "@/db/client";
import { drafts, mockRooms } from "@/db/schema";
import { DRAFT_ACTION_VERSION } from "@/domain/draft";
import type { Clock } from "@/domain/timing";
import { currentDeadline, type DraftState } from "@/draft-engine";
import { settleMockDraftCompletion, type MockBotDriver } from "@/mock-draft-service/driver";
import { startMockDraft } from "@/mock-draft-service/start";
import { dueDraftsQuery } from "./auto-start";
import { DRAFT_ADVANCE_CONFIG } from "./config";
import { NO_OP_NUDGE_SCHEDULER, type NudgeScheduler } from "./nudge";
import type { ApplyResult, DraftStore } from "./store";

/**
 * THE SERVERLESS ADVANCE FUNNEL (draft-driver design, 2026-09-03). On Vercel no process lives
 * long enough to host the dev ticker, so drafts advance through three cooperating drivers —
 * any authenticated read of a draft, the SSE stream's own loop while somebody watches, and the
 * minute-cron `draft-sweep` job — and every one of them calls THIS routine. It applies ALL due
 * work for one draft, through the identical store entry points the ticker uses (`applyAction`
 * for `TIMER_EXPIRE` and the bot's `MAKE_PICK`, `startDraft`/`startMockDraft` for a deferred
 * start), so there is exactly one advancement implementation whichever driver fires first.
 *
 * TIMESTAMP SEMANTICS — CHAINED DUE INSTANTS (decided, with the proof tests in `advance.test.ts`):
 * every reducer sets `turnStartedAt` to the applied action's own timestamp, and both
 * `currentDeadline` and `clockTierFor` read only `turnStartedAt` — so a catch-up that stamped
 * "now" for a pick that was due 40 seconds ago would push every later deadline 40 seconds late
 * AND judge later turns against the wrong clock tier. Catch-up therefore stamps each action at
 * its COMPUTED DUE INSTANT: a `TIMER_EXPIRE` at exactly `currentDeadline(state)`
 * (`admitTimerExpire`'s guard is a strict `<`, so the exact deadline is admitted), a bot's
 * `MAKE_PICK` at `turnStartedAt + its seeded think-delay` (`dueBotPick`), each stamp becoming
 * the next turn's `turnStartedAt`. A draft abandoned ten minutes on 60-second clocks catches up
 * ~10 actions whose timestamps march in clock-sized steps — never a pile stamped at read time —
 * and because the bot RNG is cursored off the log, any two drivers can only ever compute the
 * same actions: catch-up is byte-identical to the stepped schedule a live per-second driver
 * would have written.
 *
 * CONCURRENCY: two simultaneous advancers serialize through the store's existing guards — the
 * per-draft `drafts FOR UPDATE` row lock, the in-lock replay against `MAX(sequence)`,
 * `admitCommand`'s deadline re-check, and the `(draft_id, sequence)` unique index as backstop.
 * A losing racer's duplicate action is refused harmlessly; the loop treats any refusal as "the
 * other driver got there first", reloads fresh state, and stops after two consecutive refusals
 * rather than ever spinning.
 */
/**
 * The tri-state a caller steers by (fix round HIGH 1): `"ok"` — the call ran to a quiet end
 * (work applied, or nothing due); `"not_found"` — this draft is terminally gone (never existed,
 * swept away mid-call, or dissolved), so a loop should stop; `"error"` — transient weather (a
 * dropped connection, a store throw), which a loop must TICK THROUGH: collapsing it into
 * `not_found` is exactly the bug that let one failed query kill a watcher's loop for the rest
 * of its connection.
 */
export type AdvanceResultKind = "ok" | "not_found" | "error";

export interface AdvanceOutcome {
  readonly draftId: string;
  /** Actions this call applied (a deferred start counts as one). */
  readonly applied: number;
  /** True when the loop stopped at `maxActionsPerAdvance` with due work possibly remaining. */
  readonly exhausted: boolean;
  /** The draft's phase after this call, or null when it has none to report (`not_found`/`error`). */
  readonly phase: DraftState["phase"] | null;
  readonly outcome: AdvanceResultKind;
  /** True when the refusal breaker tripped WITH due work still pending (fix round MEDIUM 3) —
   *  a draft that cannot advance and will not on its own. The call also emits one structured
   *  `[draft] advance wedged` line, distinct from every benign path, for alerting to grep; the
   *  sweep job counts these in its step detail. Full dead-lettering is out of scope (spec). */
  readonly wedged: boolean;
}

export interface DraftAdvancer {
  /** Apply all due work for one draft as of `now`. NEVER throws — a broken advance must not
   *  fail the read (or the stream, or the sweep) that triggered it. `opts.maxActions` lets a
   *  caller with its own budget (the sweep job) cap this call under the advancer's ceiling. */
  advance(draftId: string, now: string, opts?: { readonly maxActions?: number }): Promise<AdvanceOutcome>;
}

export interface DraftAdvancerDeps {
  readonly db: Db;
  readonly store: DraftStore;
  /** The process-wide bot driver (`@/draft-service`'s singleton in production) — its
   *  `dueBotPick` prices every bot turn, so catch-up and the live lanes share one computation. */
  readonly mockDriver: MockBotDriver;
  /** The moderator. Defaults to a no-op, exactly like `TickerDeps.nudger`; the production
   *  advancer wires the real scheduler so a watched room on Vercel still gets its nudge. */
  readonly nudger?: NudgeScheduler;
  /** `crypto.randomUUID` at the edge — a deferred mock start seats bots, which needs ids. */
  readonly newId?: () => string;
  /** Test seam over `DRAFT_ADVANCE_CONFIG.maxActionsPerAdvance`. */
  readonly maxActionsPerAdvance?: number;
}

type DeferredStart = "started" | "raced" | "not-due";

export function createDraftAdvancer({
  db,
  store,
  mockDriver,
  nudger = NO_OP_NUDGE_SCHEDULER,
  newId = () => crypto.randomUUID(),
  maxActionsPerAdvance = DRAFT_ADVANCE_CONFIG.maxActionsPerAdvance,
}: DraftAdvancerDeps): DraftAdvancer {
  /**
   * The deferred-start lane. A mock room whose `starts_at` has passed goes through
   * `startMockDraft` — the ONE callable every mock start path shares, so the production
   * incident's "solo start deferred to the ticker" is retried by whichever driver reads the
   * room first. A real draft goes through `dueDraftsQuery` narrowed to this one id — the same
   * builder with the same predicates (public matchmade, enforcement switch, kickoff passed,
   * seats full), so a private league is never touched and a short public room is never started
   * — and then the identical `startDraft({ auto: true })` seam the platform's own scan uses.
   * Kickoff ROLLS stay with the sweep's `autoStartDueDrafts`: a read must not move a kickoff.
   */
  async function startIfDue(state: DraftState, now: string): Promise<DeferredStart> {
    if (state.config.isMock === true) {
      const [room] = await db
        .select({ leagueId: mockRooms.leagueId })
        .from(mockRooms)
        .where(and(eq(mockRooms.leagueId, state.config.leagueId), lte(mockRooms.startsAt, new Date(Date.parse(now)))));
      if (room === undefined) return "not-due";
      const outcome = await startMockDraft(db, state.config.leagueId, { store, newId });
      if (outcome.ok) return "started";
      // A mapped 409 is the benign lost race (the T5 carry): another driver already produced
      // the state this one wanted — an answer, not an error. Anything else is a real refusal,
      // logged here the way the ticker's due-scan lane reports its own non-benign failures.
      if (outcome.status === 409) return "raced";
      console.error("[draft] deferred mock start refused", { leagueId: state.config.leagueId, reason: outcome.reason });
      return "not-due";
    }
    const due = await dueDraftsQuery(db, now, state.config.draftId);
    if (due.length === 0) return "not-due";
    const started = await store.startDraft(state.config.draftId, { auto: true });
    // `claimAutoStart` already lost to another instance, or the room emptied under the query —
    // either way the fresh state read below is the honest answer.
    return started.ok ? "started" : "raced";
  }

  /** One due action: the bot's pick when a bot holds a due clock (its think-delay always
   *  elapses inside the turn's clock — the T1 guarantee, the same ordering `tickOne` keeps),
   *  otherwise the clock's own expiry. Null when nothing is due yet; `dueWork` names what was
   *  attempted so a wedged trip can say what the draft is stuck on (fix round MEDIUM 3). */
  async function applyNextDue(state: DraftState, nowMs: number): Promise<{ readonly dueWork: string; readonly result: ApplyResult } | null> {
    if (state.config.isMock === true) {
      const due = await mockDriver.dueBotPick(state);
      if (due !== null && due.dueAtMs <= nowMs) {
        // The selection runs only past the due check (fix round LOW 5); a null choice means the
        // roster can take nothing, so the turn falls through to the clock's own expiry below.
        const playerId = due.choosePick();
        if (playerId !== null) {
          // `Math.ceil`: the seeded delay is fractional-millisecond arithmetic; the stamp is
          // the first whole millisecond at-or-after it, so the recorded instant never precedes
          // the true due instant and two advancers stamp identically.
          const timestamp = new Date(Math.ceil(due.dueAtMs)).toISOString();
          const result = await store.applyAction(state.config.draftId, {
            v: DRAFT_ACTION_VERSION,
            type: "MAKE_PICK",
            timestamp,
            teamId: due.teamId,
            playerId,
          });
          return { dueWork: `bot-pick due ${timestamp}`, result };
        }
      }
    }
    const deadline = currentDeadline(state);
    if (deadline === null || Date.parse(deadline) > nowMs) return null;
    const result = await store.applyAction(state.config.draftId, { v: DRAFT_ACTION_VERSION, type: "TIMER_EXPIRE", timestamp: deadline });
    return { dueWork: `expire due ${deadline}`, result };
  }

  return {
    async advance(draftId, now, opts) {
      const maxActions = Math.min(maxActionsPerAdvance, opts?.maxActions ?? maxActionsPerAdvance);
      let applied = 0;
      try {
        // Terminal statuses first (fix round MEDIUM 2): a DISSOLVED draft still carries an
        // action log — replaying it looks in_progress — but nothing may ever advance it again,
        // so it classifies with not_found (a loop stops, a read just renders what it has). One
        // primary-key read; the row's absence is the same answer the state load would give.
        const [row] = await db.select({ status: drafts.status }).from(drafts).where(eq(drafts.id, draftId));
        if (row === undefined || row.status === "dissolved") {
          return { draftId, applied, exhausted: false, phase: null, outcome: "not_found", wedged: false };
        }
        let state = await store.getDraftState(draftId);
        if (state === null) return { draftId, applied, exhausted: false, phase: null, outcome: "not_found", wedged: false };

        if (state.phase === "scheduled") {
          const start = await startIfDue(state, now);
          if (start === "started") applied += 1;
          if (start === "not-due") return { draftId, applied, exhausted: false, phase: state.phase, outcome: "ok", wedged: false };
          const fresh = await store.getDraftState(draftId);
          if (fresh === null) return { draftId, applied, exhausted: false, phase: null, outcome: "not_found", wedged: false };
          state = fresh;
        }

        const nowMs = Date.parse(now);
        let refusals = 0;
        let wedged = false;
        while (state.phase === "in_progress") {
          if (applied >= maxActions) return { draftId, applied, exhausted: true, phase: state.phase, outcome: "ok", wedged };
          const attempt = await applyNextDue(state, nowMs);
          if (attempt === null) {
            // Nothing due — the clock is still running: the moderator's window, exactly where
            // `tickOne` gives it. It never applies an action, so it can never change what this
            // call would otherwise have done.
            await nudger.nudge(state, now);
            break;
          }
          if (attempt.result.ok) {
            state = attempt.result.state;
            applied += 1;
            refusals = 0;
            continue;
          }
          // A refusal means a concurrent driver got there first (or this draft genuinely cannot
          // advance — e.g. no eligible autopick). Reload once and re-derive; two consecutive
          // refusals end the call rather than spin.
          refusals += 1;
          if (refusals >= 2) {
            // THE WEDGED LINE (fix round MEDIUM 3): due work is still pending and the store
            // refused it twice against fresh state — this draft will not advance on its own.
            // Deliberately distinct text from every benign path so an alert can grep it; full
            // dead-lettering stays out of scope (spec).
            wedged = true;
            console.error("[draft] advance wedged", { draftId, reason: attempt.result.reason, dueWork: attempt.dueWork });
            break;
          }
          const fresh = await store.getDraftState(draftId);
          if (fresh === null) return { draftId, applied, exhausted: false, phase: null, outcome: "not_found", wedged: false };
          state = fresh;
        }

        // A finished mock settles its status row in the same call (`settleMockDraftCompletion`
        // is guarded and idempotent), so its `liveDraftsQuery` slot frees immediately — the same
        // promptness the driver's own settle lane keeps.
        if (state.phase === "complete" && state.config.isMock === true) {
          await settleMockDraftCompletion(db, draftId);
        }
        return { draftId, applied, exhausted: false, phase: state.phase, outcome: "ok", wedged };
      } catch (error: unknown) {
        // The ticker's own discipline, held per call: one draft's DB error must not fail the
        // read (or stream, or sweep) that triggered the advance.
        console.error("[draft] advance failed", { draftId }, error);
        return { draftId, applied, exhausted: false, phase: null, outcome: "error", wedged: false };
      }
    },
  };
}

/**
 * Which draft a league's SSE connection should tick, or null when there is nothing to ever tick
 * (no draft, or a terminal status — `complete` AND `dissolved`, fix round MEDIUM 2: a reopened
 * dissolved house league must not run a fruitless advance loop for every reconnect forever).
 */
export async function draftLoopTarget(db: Db, leagueId: string): Promise<string | null> {
  const [row] = await db.select({ id: drafts.id, status: drafts.status }).from(drafts).where(eq(drafts.leagueId, leagueId));
  if (row === undefined || row.status === "complete" || row.status === "dissolved") return null;
  return row.id;
}

export interface AdvanceLoopDeps {
  readonly advance: DraftAdvancer["advance"];
  readonly clock: Clock;
  /** Defaults to `DRAFT_ADVANCE_CONFIG.sseIntervalMs`. */
  readonly intervalMs?: number;
}

/**
 * THE SSE STREAM'S OWN TICK (driver 2): while a client is connected to a draft room's league
 * stream, this loop calls the advance routine on a short interval so bot picks and clock
 * expiries move in real time for whoever is watching. Fire-and-forget from the route: it
 * advances once immediately (the connection setup's own fast-forward), then on the interval;
 * never overlaps itself (a slow advance skips fires rather than stacking); exits cleanly the
 * moment the request aborts; and stops on its own once the draft completes or vanishes — a
 * finished room holds no timer open. No transaction is ever held across ticks: each applied
 * action is its own short transaction inside the store.
 */
export function runDraftAdvanceLoop(draftId: string, signal: AbortSignal, deps: AdvanceLoopDeps): void {
  const intervalMs = deps.intervalMs ?? DRAFT_ADVANCE_CONFIG.sseIntervalMs;
  let running = false;
  let stopped = false;
  // True while the last tick(s) errored — the log-once-per-streak latch (fix round HIGH 1): a
  // transient failure must neither kill the loop nor log once a second for the connection's life.
  let erroring = false;

  const stop = (): void => {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
  };

  const tick = async (): Promise<void> => {
    if (running || stopped) return;
    running = true;
    try {
      const outcome = await deps.advance(draftId, deps.clock.now());
      if (outcome.outcome === "error") {
        // Transient weather: KEEP TICKING — the next tick may succeed (and in the reviewer's
        // repro, does). Stopping here left a watched room frozen for the rest of its connection.
        if (!erroring) console.error("[draft] advance loop erroring; ticking on", { draftId });
        erroring = true;
        return;
      }
      erroring = false;
      // Terminal: a finished draft, or one that is gone (vanished or dissolved) — no timer left open.
      if (outcome.outcome === "not_found" || outcome.phase === "complete") stop();
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => {
    void tick();
  }, intervalMs);
  signal.addEventListener("abort", stop, { once: true });
  if (signal.aborted) stop();
  void tick();
}
