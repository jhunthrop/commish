import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { drafts, mockRooms } from "@/db/schema";
import { DRAFT_ACTION_VERSION } from "@/domain/draft";
import { currentDeadline, type DraftState } from "@/draft-engine";
import { settleMockDraftCompletion, type MockBotDriver } from "@/mock-draft-service/driver";
import { startMockDraft } from "@/mock-draft-service/start";
import { dueDraftsQuery } from "./auto-start";
import { DRAFT_ADVANCE_CONFIG } from "./config";
import { NO_OP_NUDGE_SCHEDULER, type NudgeScheduler } from "./nudge";
import type { ApplyResult, DraftStore } from "./store";

/**
 * THE SERVERLESS ADVANCE FUNNEL (draft-driver design, 2026-09-03). No process lives long
 * enough on Vercel to hold a clock, so drafts advance through two cooperating drivers — any
 * authenticated read of a draft, and the minute-cron `draft-sweep` job — and both call THIS
 * routine. It applies ALL due work for one draft through the identical store entry points
 * (`applyAction` for `TIMER_EXPIRE`, `startDraft`/`startMockDraft` for a deferred start,
 * `resolveBots` for a mock whose committed state still has a bot on the clock), so there is
 * exactly one advancement implementation whichever driver fires first.
 *
 * BOT PICKS ARE NOT DUE WORK (the batched bots round, 2026-09-25). The store appends every
 * consecutive bot seat's pick to the SAME commit as the human action in front of it
 * (`DraftStoreDeps.botTurn`), each stamped at its own reveal instant, so a committed mock state
 * almost never has a bot on the clock. The one lane left here is `resolveBots`: a room started
 * before the batch shipped, or one whose batch stopped at a roster that could take nothing,
 * still catches up here, stamped identically to what the batch would have stamped.
 *
 * TIMESTAMP SEMANTICS — CHAINED DUE INSTANTS (decided, with the proof tests in `advance.test.ts`):
 * every reducer sets `turnStartedAt` to the applied action's own timestamp, and both
 * `currentDeadline` and `clockTierFor` read only `turnStartedAt` — so a catch-up that stamped
 * "now" for a pick that was due 40 seconds ago would push every later deadline 40 seconds late
 * AND judge later turns against the wrong clock tier. Catch-up therefore stamps each action at
 * its COMPUTED DUE INSTANT: a `TIMER_EXPIRE` at exactly `currentDeadline(state)`
 * (`admitTimerExpire`'s guard is a strict `<`, so the exact deadline is admitted), each stamp
 * becoming the next turn's `turnStartedAt`. A draft abandoned ten minutes on 60-second clocks
 * catches up ~10 actions whose timestamps march in clock-sized steps — never a pile stamped at
 * read time — and because the bot RNG is cursored off the log, any two drivers can only ever
 * compute the same actions.
 *
 * CONCURRENCY: two simultaneous advancers serialize through the store's existing guards — the
 * per-draft `drafts FOR UPDATE` row lock, the in-lock replay against `MAX(sequence)`,
 * `admitCommand`'s deadline re-check, and the `(draft_id, sequence)` unique index as backstop.
 * A losing racer's duplicate action is refused harmlessly; the loop treats any refusal as "the
 * other driver got there first", reloads fresh state, and stops after two consecutive refusals
 * rather than ever spinning.
 *
 * NEXT DUE INSTANT (Neon cost audit 2026-09-07, findings 1 and 2): every outcome names the next
 * instant this draft owes work — the running clock's deadline, or a scheduled draft's kickoff —
 * so the sweep registers it in the wake set and touches Postgres again only once it passes.
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
  /** ISO instant of the next work this draft owes, or null when none is known (terminal, errored,
   *  exhausted with work still due — which is "now" — or a draft with no running clock). */
  readonly nextDueAt: string | null;
  /** The log sequence the draft stood at when this call ended, or null when it had no state to
   *  report. The watcher loop compares it against the sequence a stream frame carries, so a frame
   *  announcing its own action never wakes it. */
  readonly sequence: number | null;
}

export interface AdvanceOptions {
  /** A caller with its own budget (the sweep job) caps this call under the advancer's ceiling. */
  readonly maxActions?: number;
}

export interface DraftAdvancer {
  /** Apply all due work for one draft as of `now`. NEVER throws — a broken advance must not
   *  fail the read (or the stream, or the sweep) that triggered it. */
  advance(draftId: string, now: string, opts?: AdvanceOptions): Promise<AdvanceOutcome>;
}

export interface DraftAdvancerDeps {
  readonly db: Db;
  readonly store: DraftStore;
  /** The process-wide bot driver (`@/draft-service`'s singleton in production): its `botTurn`
   *  is the one read of "does a bot hold this clock", so a read of a room with a human on the
   *  clock never opens the store's locking transaction for nothing. */
  readonly mockDriver: MockBotDriver;
  /** The moderator. Defaults to a no-op, exactly like `TickerDeps.nudger`; the production
   *  advancer wires the real scheduler so a watched room on Vercel still gets its nudge. */
  readonly nudger?: NudgeScheduler;
  /** `crypto.randomUUID` at the edge — a deferred mock start seats bots, which needs ids. */
  readonly newId?: () => string;
  /** Test seam over `DRAFT_ADVANCE_CONFIG.maxActionsPerAdvance`. */
  readonly maxActionsPerAdvance?: number;
}

type DeferredStart = "started" | "raced" | { readonly notDueUntilMs: number | null };

type NextDue =
  | { readonly kind: "applied"; readonly dueWork: string; readonly result: ApplyResult; readonly count: number }
  | { readonly kind: "waiting"; readonly dueAtMs: number | null }
  /** The bots' resolve lost a commit to another writer: reload and go on, never a refusal counted. */
  | { readonly kind: "raced" };

interface DueLoopResult {
  readonly state: DraftState;
  readonly applied: number;
  readonly exhausted: boolean;
  readonly wedged: boolean;
  readonly nextDueAt: string | null;
}

const isoOrNull = (ms: number | null): string | null => (ms === null ? null : new Date(ms).toISOString());

function report(draftId: string, applied: number, partial: Partial<AdvanceOutcome>): AdvanceOutcome {
  return { draftId, applied, exhausted: false, phase: null, outcome: "ok", wedged: false, nextDueAt: null, sequence: null, ...partial };
}

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
   * A not-due answer carries the instant the room becomes due, for the drivers' timers.
   */
  async function startIfDue(state: DraftState, now: string, kickoffAt: Date): Promise<DeferredStart> {
    if (state.config.isMock === true) {
      const [room] = await db.select({ startsAt: mockRooms.startsAt }).from(mockRooms).where(eq(mockRooms.leagueId, state.config.leagueId));
      if (room === undefined) return { notDueUntilMs: null };
      if (room.startsAt.getTime() > Date.parse(now)) return { notDueUntilMs: room.startsAt.getTime() };
      const outcome = await startMockDraft(db, state.config.leagueId, { store, newId });
      if (outcome.ok) return "started";
      // A mapped 409 is the benign lost race (the T5 carry): another driver already produced
      // the state this one wanted — an answer, not an error. Anything else is a real refusal,
      // logged here the way the ticker's due-scan lane reports its own non-benign failures.
      if (outcome.status === 409) return "raced";
      console.error("[draft] deferred mock start refused", { leagueId: state.config.leagueId, reason: outcome.reason });
      return { notDueUntilMs: null };
    }
    const due = await dueDraftsQuery(db, now, state.config.draftId);
    if (due.length === 0) return { notDueUntilMs: kickoffAt.getTime() > Date.parse(now) ? kickoffAt.getTime() : null };
    const started = await store.startDraft(state.config.draftId, { auto: true });
    // `claimAutoStart` already lost to another instance, or the room emptied under the query —
    // either way the fresh state read below is the honest answer.
    return started.ok ? "started" : "raced";
  }

  /** One due step: a mock whose committed state has a bot on the clock resolves its bots
   *  (`store.resolveBots`, the whole run of consecutive bot seats in one commit, whatever the
   *  hour: their stamps are the seeded reveal instants, never now); otherwise the clock's own
   *  expiry once it has run out. `waiting` when nothing is due yet, carrying the deadline;
   *  `dueWork` names what was attempted so a wedged trip can say what the draft is stuck on
   *  (fix round MEDIUM 3). A bot whose roster can take nothing resolves to no pick, and its turn
   *  falls to the expiry below. */
  async function applyNextDue(state: DraftState, nowMs: number): Promise<NextDue> {
    if (state.config.isMock === true) {
      // The lock opens only for a bot that has something legal to take (review M4): a bot whose
      // roster can take nothing keeps the clock until it expires, and every read of the room in
      // between would otherwise replay the log under the row lock for nothing.
      const turn = await mockDriver.botTurn(state);
      if (turn !== null && turn.choosePick() !== null) {
        const result = await store.resolveBots(state.config.draftId);
        if (!result.ok) return { kind: "raced" };
        if (result.batched > 0) return { kind: "applied", dueWork: `bot picks from sequence ${state.sequence}`, result, count: result.batched };
      }
    }
    const deadline = currentDeadline(state);
    const deadlineMs = deadline === null ? null : Date.parse(deadline);
    if (deadlineMs === null || deadlineMs > nowMs) return { kind: "waiting", dueAtMs: deadlineMs };
    const result = await store.applyAction(state.config.draftId, { v: DRAFT_ACTION_VERSION, type: "TIMER_EXPIRE", timestamp: deadline! });
    return { kind: "applied", dueWork: `expire due ${deadline}`, result, count: result.ok ? 1 + result.batched : 0 };
  }

  /** The in-progress loop: apply due work until nothing is due, the ceiling is hit, or the
   *  refusal breaker trips. Returns the state it ended on and what the drivers need next. */
  async function applyDueWork(initial: DraftState, now: string, maxActions: number, alreadyApplied: number): Promise<DueLoopResult | null> {
    const nowMs = Date.parse(now);
    let state = initial;
    let applied = alreadyApplied;
    let refusals = 0;
    while (state.phase === "in_progress") {
      if (applied >= maxActions) return { state, applied, exhausted: true, wedged: false, nextDueAt: now };
      const attempt = await applyNextDue(state, nowMs);
      if (attempt.kind === "raced") {
        // Another writer committed under this call's feet (a human's pick, another driver's
        // resolve): the log moved, so this is progress, not a refusal, and the breaker is not
        // touched. A log that did NOT move is the one case that would spin, so it counts.
        const fresh = await store.getDraftState(state.config.draftId);
        if (fresh === null) return null;
        if (fresh.sequence === state.sequence) refusals += 1;
        if (refusals >= 2) {
          console.error("[draft] advance wedged", { draftId: state.config.draftId, reason: "the bots' resolve was refused against an unmoved log", dueWork: `bot picks from sequence ${state.sequence}` });
          return { state, applied, exhausted: false, wedged: true, nextDueAt: null };
        }
        state = fresh;
        continue;
      }
      if (attempt.kind === "waiting") {
        // Nothing due — the clock is still running: the moderator's window, exactly where
        // `tickOne` gives it. It never applies an action, so it can never change what this
        // call would otherwise have done.
        await nudger.nudge(state, now);
        return { state, applied, exhausted: false, wedged: false, nextDueAt: isoOrNull(attempt.dueAtMs) };
      }
      if (attempt.result.ok) {
        state = attempt.result.state;
        applied += attempt.count;
        refusals = 0;
        continue;
      }
      // A refusal means a concurrent driver got there first (or this draft genuinely cannot
      // advance — e.g. no eligible autopick). Reload once and re-derive; two consecutive
      // refusals AGAINST AN UNMOVED LOG end the call rather than spin. A reload that finds the
      // log moved is the other driver making progress (draft-room performance round, item 4:
      // the Phase 1 "advance wedged" pairs were two sweeps racing one room pick by pick, each
      // refused twice while the other landed the work), so the count starts over.
      refusals += 1;
      if (refusals >= 2) {
        // THE WEDGED LINE (fix round MEDIUM 3): due work is still pending and the store
        // refused it twice against fresh state — this draft will not advance on its own.
        // Deliberately distinct text from every benign path so an alert can grep it; full
        // dead-lettering stays out of scope (spec).
        console.error("[draft] advance wedged", { draftId: state.config.draftId, reason: attempt.result.reason, dueWork: attempt.dueWork });
        return { state, applied, exhausted: false, wedged: true, nextDueAt: null };
      }
      const fresh = await store.getDraftState(state.config.draftId);
      if (fresh === null) return null;
      if (fresh.sequence !== state.sequence) refusals = 0;
      state = fresh;
    }
    return { state, applied, exhausted: false, wedged: false, nextDueAt: null };
  }

  async function advanceOrThrow(draftId: string, now: string, maxActions: number): Promise<AdvanceOutcome> {
    // Terminal statuses first (fix round MEDIUM 2): a DISSOLVED draft still carries an
    // action log — replaying it looks in_progress — but nothing may ever advance it again,
    // so it classifies with not_found (a loop stops, a read just renders what it has). One
    // primary-key read; the row's absence is the same answer the state load would give.
    const [row] = await db.select({ status: drafts.status, kickoffAt: drafts.kickoffAt }).from(drafts).where(eq(drafts.id, draftId));
    if (row === undefined || row.status === "dissolved") return report(draftId, 0, { outcome: "not_found" });
    let state = await store.getDraftState(draftId);
    if (state === null) return report(draftId, 0, { outcome: "not_found" });

    let applied = 0;
    if (state.phase === "scheduled") {
      const start = await startIfDue(state, now, row.kickoffAt);
      if (start === "started") applied += 1;
      if (typeof start === "object") return report(draftId, applied, { phase: state.phase, nextDueAt: isoOrNull(start.notDueUntilMs), sequence: state.sequence });
      const fresh = await store.getDraftState(draftId);
      if (fresh === null) return report(draftId, applied, { outcome: "not_found" });
      state = fresh;
    }

    const loop = await applyDueWork(state, now, maxActions, applied);
    if (loop === null) return report(draftId, applied, { outcome: "not_found" });
    // A finished mock settles its status row in the same call (`settleMockDraftCompletion`
    // is guarded and idempotent), so its `liveDraftsQuery` slot frees immediately — the same
    // promptness the driver's own settle lane keeps.
    if (loop.state.phase === "complete" && loop.state.config.isMock === true) await settleMockDraftCompletion(db, draftId);
    return report(draftId, loop.applied, {
      exhausted: loop.exhausted,
      phase: loop.state.phase,
      wedged: loop.wedged,
      nextDueAt: loop.nextDueAt,
      sequence: loop.state.sequence,
    });
  }

  return {
    async advance(draftId, now, opts) {
      const maxActions = Math.min(maxActionsPerAdvance, opts?.maxActions ?? maxActionsPerAdvance);
      try {
        return await advanceOrThrow(draftId, now, maxActions);
      } catch (error: unknown) {
        // The ticker's own discipline, held per call: one draft's DB error must not fail the
        // read (or stream, or sweep) that triggered the advance.
        console.error("[draft] advance failed", { draftId }, error);
        return report(draftId, 0, { outcome: "error" });
      }
    },
  };
}
