// THE DRAFT SWEEP — driver 3 of the draft-driver design (2026-09-03): the minute-cron backstop
// that keeps an ABANDONED room moving on Vercel, where no long-lived ticker exists. Drivers 1
// and 2 (advance-on-read, the SSE watcher loop) cover every room somebody opens; this job covers
// the rooms nobody is watching — a tab closed mid-draft still completes on minute granularity
// instead of freezing.
//
// ONE bounded step, deliberately not checkpointed work (contrast `season-week-job.ts`): the
// sweep is LEVEL-TRIGGERED — `drafts.status` never lies, so unfinished work is always findable —
// and reruns every minute, which makes checkpoint resume within one run worthless. Everything
// here funnels into the SAME seams the dev ticker uses: `autoStartDueDrafts` (real due starts
// AND kickoff rolls), `startDueMockRooms` (due mock rooms, the deferred-solo-start retry), and
// the shared advance routine per live draft (`liveDraftsQuery`, the ticker's own bounded scan).
//
// TERMINAL-VS-RETRYABLE: nothing in a sweep is a refusal worth dead-lettering — the advance
// routine and both due scans already absorb per-draft failures — so any error that escapes is
// transient weather (a dropped connection) and stays retryable. `maxAttempts: 2` with a short
// backoff: a third attempt would only race the next minute's own fire.
import type { Db } from "@/db/client";
import type { Clock } from "@/domain/timing";
import { getDraftAdvancer, getDraftStore } from "@/draft-service";
import { autoStartDueDrafts } from "@/draft-service/auto-start";
import { DRAFT_ADVANCE_CONFIG } from "@/draft-service/config";
import type { DraftAdvancer } from "@/draft-service/advance";
import type { DraftStore } from "@/draft-service/store";
import { liveDraftsQuery } from "@/draft-service/ticker";
import { startDueMockRooms } from "@/mock-draft-service/driver";
import { defineJob, type AnyJobDefinition, type StepOutcome } from "../contract";

export const DRAFT_SWEEP_JOB_NAME = "draft-sweep";

/** The sweep's collaborators, explicit so the test drives it against a test store and a frozen
 *  clock — the same dependency-injection seam `SeasonWeekDeps` draws. */
export interface DraftSweepContext {
  readonly db: Db;
  readonly clock: Clock;
  readonly store: DraftStore;
  readonly advance: DraftAdvancer["advance"];
  readonly newId: () => string;
  /** Sweep-wide action budget; defaults to `DRAFT_ADVANCE_CONFIG.sweepMaxActions`. */
  readonly maxActions?: number;
}

/**
 * One sweep: due starts first (so a draft started this sweep gets its clock advanced this same
 * sweep), then one bounded advance per live draft. The budget is spent by APPLIED ACTIONS and
 * threaded into each advance call, so a deep backlog on one draft cannot starve the runner's
 * tick budget — drafts left over are found by the next minute's fire.
 */
export async function sweepDrafts(ctx: DraftSweepContext): Promise<StepOutcome> {
  const budget = ctx.maxActions ?? DRAFT_ADVANCE_CONFIG.sweepMaxActions;
  const now = ctx.clock.now();

  const started = await autoStartDueDrafts(ctx.db, { store: ctx.store, clock: ctx.clock });
  const mocks = await startDueMockRooms(ctx.db, { store: ctx.store, clock: ctx.clock, newId: ctx.newId });

  const rows = await liveDraftsQuery(ctx.db);
  let actions = 0;
  let advanced = 0;
  let exhausted = false;
  for (const row of rows) {
    const remaining = budget - actions;
    if (remaining <= 0) {
      exhausted = true;
      break;
    }
    const outcome = await ctx.advance(row.id, now, { maxActions: remaining });
    actions += outcome.applied;
    if (outcome.applied > 0) advanced += 1;
    if (outcome.exhausted) exhausted = true;
  }

  return {
    summary: `sweep: ${started.filter((s) => s.started).length} auto-starts, ${mocks.filter((m) => m.started).length} mock starts, ${actions} actions across ${advanced} of ${rows.length} live drafts${exhausted ? " (budget hit — the next fire resumes)" : ""}`,
    detail: [
      ...started.filter((s) => !s.started && s.rolled !== true && s.reason !== undefined).map((s) => `auto-start ${s.draftId}: ${s.reason}`),
      ...mocks.filter((m) => !m.started && !m.benignRace).map((m) => `mock ${m.leagueId}: ${m.reason}`),
    ],
  };
}

export const draftSweepJob: AnyJobDefinition = defineJob<Record<string, never>>({
  name: DRAFT_SWEEP_JOB_NAME,
  maxAttempts: 2,
  /** Comfortably under the Vercel tick's own ~50s budget (`JOBS_CONFIG.vercelTickBudgetMsDefault`),
   *  which caps it further when the tick is nearly spent. */
  timeoutMs: 45_000,
  backoff: { baseMs: 30_000, maxMs: 60_000 },
  parsePayload: () => ({}),
  steps: [
    {
      name: "sweep",
      run: (ctx) =>
        sweepDrafts({
          db: ctx.db,
          clock: ctx.clock,
          // The process-wide store/advancer — the identical instances the routes and (in dev)
          // the ticker drive, so one meta cache and one materialization per process.
          store: getDraftStore(),
          advance: (draftId, now, opts) => getDraftAdvancer().advance(draftId, now, opts),
          newId: () => crypto.randomUUID(),
        }),
    },
  ],
});
