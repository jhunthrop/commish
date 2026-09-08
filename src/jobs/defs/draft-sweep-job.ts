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
// GATED, AND SELF-SCHEDULING (Neon cost audit 2026-09-07, finding 1). The schedule that fires
// this job sits behind the wake gate (`ScheduleDefinition.gate`), so the minute cron only
// enqueues a sweep when a draft registered a due instant. Every sweep therefore ends by writing
// the truth it just read back into the wake set: each live draft's next due instant, the
// earliest future kickoff among scheduled drafts, and the safety marker that runs it again
// within `JOBS_CONFIG.sweepMaxQuietMs` no matter what. A wedged draft registers nothing — the
// safety cadence retries it rather than a minute-by-minute wake that cannot help.
//
// TERMINAL-VS-RETRYABLE: nothing in a sweep is a refusal worth dead-lettering — the advance
// routine and both due scans already absorb per-draft failures — so any error that escapes is
// transient weather (a dropped connection) and stays retryable. `maxAttempts: 2` with a short
// backoff: a third attempt would only race the next minute's own fire.
import { and, eq, gt, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { drafts, mockRooms } from "@/db/schema";
import type { Clock } from "@/domain/timing";
import { getDraftAdvancer, getDraftStore } from "@/draft-service";
import { autoStartDueDrafts } from "@/draft-service/auto-start";
import { DRAFT_ADVANCE_CONFIG } from "@/draft-service/config";
import type { AdvanceOutcome, DraftAdvancer } from "@/draft-service/advance";
import type { DraftStore } from "@/draft-service/store";
import { liveDraftsQuery } from "@/draft-service/ticker";
import { startDueMockRooms } from "@/mock-draft-service/driver";
import { JOBS_CONFIG } from "../config";
import { defineJob, type AnyJobDefinition, type StepOutcome } from "../contract";
import { WAKE_MEMBERS, wakeMember, wakeSet, type WakeSet } from "../wake";

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
  /** Where the sweep writes what it learned. Defaults to the installed set (`wakeSet()`). */
  readonly wake?: WakeSet;
}

interface SweepTally {
  readonly actions: number;
  readonly advanced: number;
  readonly exhausted: boolean;
  readonly wedged: readonly string[];
}

/**
 * One sweep: due starts first (so a draft started this sweep gets its clock advanced this same
 * sweep), then one bounded advance per live draft. The budget is spent by APPLIED ACTIONS and
 * threaded into each advance call, so a deep backlog on one draft cannot starve the runner's
 * tick budget — drafts left over are found by the next minute's fire.
 */
export async function sweepDrafts(ctx: DraftSweepContext): Promise<StepOutcome> {
  const budget = ctx.maxActions ?? DRAFT_ADVANCE_CONFIG.sweepMaxActions;
  const wake = ctx.wake ?? wakeSet();
  const now = ctx.clock.now();
  const nowMs = Date.parse(now);

  const started = await autoStartDueDrafts(ctx.db, { store: ctx.store, clock: ctx.clock });
  const mocks = await startDueMockRooms(ctx.db, { store: ctx.store, clock: ctx.clock, newId: ctx.newId });

  const rows = await liveDraftsQuery(ctx.db);
  let tally: SweepTally = { actions: 0, advanced: 0, exhausted: false, wedged: [] };
  for (const row of rows) {
    const remaining = budget - tally.actions;
    if (remaining <= 0) {
      // Budget spent before this draft was reached: it owes work now, the next fire finds it.
      tally = { ...tally, exhausted: true };
      await wake.add(wakeMember.draft(row.id), nowMs);
      continue;
    }
    const outcome = await ctx.advance(row.id, now, { maxActions: remaining });
    tally = fold(tally, outcome);
    await noteDraftWake(wake, outcome);
  }
  await noteScheduledWake(ctx.db, wake, new Date(nowMs));
  await wake.add(WAKE_MEMBERS.sweepSafety, nowMs + JOBS_CONFIG.sweepMaxQuietMs);

  return {
    summary: `sweep: ${started.filter((s) => s.started).length} auto-starts, ${mocks.filter((m) => m.started).length} mock starts, ${tally.actions} actions across ${tally.advanced} of ${rows.length} live drafts${tally.wedged.length > 0 ? `, ${tally.wedged.length} WEDGED` : ""}${tally.exhausted ? " (budget hit — the next fire resumes)" : ""}`,
    detail: [
      ...started.filter((s) => !s.started && s.rolled !== true && s.reason !== undefined).map((s) => `auto-start ${s.draftId}: ${s.reason}`),
      ...mocks.flatMap((m) => (!m.started && !m.benignRace ? [`mock ${m.leagueId}: ${m.reason}`] : [])),
      // Fix round MEDIUM 3: the admin jobs page shows a stuck draft instead of it being
      // invisible; the per-draft "[draft] advance wedged" log carries the refusal reason.
      ...tally.wedged.map((draftId) => `wedged: ${draftId} cannot advance (see "[draft] advance wedged" logs)`),
    ],
  };
}

function fold(tally: SweepTally, outcome: AdvanceOutcome): SweepTally {
  return {
    actions: tally.actions + outcome.applied,
    advanced: tally.advanced + (outcome.applied > 0 ? 1 : 0),
    exhausted: tally.exhausted || outcome.exhausted,
    wedged: outcome.wedged ? [...tally.wedged, outcome.draftId] : tally.wedged,
  };
}

/** What one advanced draft leaves in the wake set: its next due instant, or nothing. */
async function noteDraftWake(wake: WakeSet, outcome: AdvanceOutcome): Promise<void> {
  const member = wakeMember.draft(outcome.draftId);
  if (outcome.wedged || outcome.nextDueAt === null) await wake.remove([member]);
  else await wake.add(member, Date.parse(outcome.nextDueAt));
}

/**
 * The earliest FUTURE start among scheduled drafts — a real draft's kickoff or a mock room's
 * start. Past instants are excluded on purpose: a scheduled draft whose kickoff has passed and
 * that this very sweep did not start (a private league nobody started, a room short a seat whose
 * roll has not landed) would otherwise wake the sweep every minute forever; the safety marker
 * retries those instead.
 */
async function noteScheduledWake(db: Db, wake: WakeSet, now: Date): Promise<void> {
  const [real] = await db
    .select({ at: sql<Date | string | null>`min(${drafts.kickoffAt})` })
    .from(drafts)
    .where(and(eq(drafts.status, "scheduled"), gt(drafts.kickoffAt, now)));
  const [mock] = await db
    .select({ at: sql<Date | string | null>`min(${mockRooms.startsAt})` })
    .from(mockRooms)
    .innerJoin(drafts, eq(drafts.leagueId, mockRooms.leagueId))
    .where(and(eq(drafts.status, "scheduled"), gt(mockRooms.startsAt, now)));
  const instants = [real?.at, mock?.at].filter((at): at is Date | string => at !== null && at !== undefined).map((at) => new Date(at).getTime());
  if (instants.length === 0) await wake.remove([WAKE_MEMBERS.scheduledDrafts]);
  else await wake.add(WAKE_MEMBERS.scheduledDrafts, Math.min(...instants));
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
