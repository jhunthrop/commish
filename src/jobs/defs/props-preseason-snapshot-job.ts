// THE PRE-KICKOFF PROPS SNAPSHOT JOB — fires daily (`schedules.ts`'s own cron entry) and captures
// the current season's props archive (`@/projections/odds/snapshot`'s `runOddsSnapshot`, the same
// work `npm run projections:odds:snapshot` does) until `PRODUCT_SEASON`'s own first kickoff, then
// SELF-DISABLES: every fire after that instant is a no-op that never reaches the network.
//
// WHY THIS EXISTS SEPARATELY FROM THE SEASON-WEEK CADENCE. `season-week-job.ts`'s own
// `props-snapshot` step already runs the identical `runOddsSnapshot` three times a week
// (Tue/Wed/Thu, `schedules.ts`), but that cadence exists to keep the CURRENT week's lines fresh
// for whichever week is about to freeze — it is not aimed at growing the pre-kickoff archive
// `market/props-anchor.ts`'s leakage gate will read from for THIS season, once, forever. That
// archive only grows until `firstKickoffFor(PRODUCT_SEASON)`, and after that instant the gate
// (`props-anchor.ts`: "Season S's anchor may only read rows whose fetched_at is STRICTLY BEFORE
// season S's own first kickoff") makes any later capture for this season permanently unusable —
// the window closes and never reopens. A daily cadence in the run-up to kickoff (rather than
// three-times-weekly) buys more independent snapshots of a market that moves daily in the final
// week, at the cost of more API credits — an acceptable trade because this job SELF-DISABLES the
// instant the reason for running it is gone, rather than running indefinitely at that rate.
//
// SELF-DISABLING, MECHANICALLY. There is no per-schedule "disable" switch in this job system
// (`schedule.ts`'s `tickOne` fires every schedule unconditionally, forever) — so the STEP itself
// is what stops: once `now >= firstKickoffFor(PRODUCT_SEASON)`, it returns a skip outcome without
// ever calling `runOddsSnapshot`, spending zero credits and writing zero rows. The daily fire still
// lands in the queue harmlessly for the life of the product; only the actual network call and
// archive write are gated. `PRODUCT_SEASON` itself rolls forward exactly once a year
// (`preseason/current.ts`'s own docblock), at which point this job's gate re-opens for the new
// season's own pre-kickoff window automatically — no redeploy, no schedule edit.
//
// TERMINAL VS RETRYABLE: identical judgment to `adp-snapshot-job.ts`'s own — a missing
// `ODDS_API_KEY` or a network/HTTP failure inside `runOddsSnapshot` is worth retrying (the next
// scheduled fire, or a same-night redelivery, may simply find the key configured or the upstream
// recovered), so nothing here is classified terminal.
import type { Db } from "@/db/client";
import type { JsonObject } from "@/domain/audit";
import type { Clock } from "@/domain/timing";
import { PRODUCT_SEASON } from "@/projections/preseason/current";
import { requireEnv } from "@/projections/odds/http";
import { runOddsSnapshot, type SnapshotSummary } from "@/projections/odds/snapshot";
import { firstKickoffFor } from "@/projections/team-store";
import { defineJob, type AnyJobDefinition, type StepOutcome } from "../contract";

export const PROPS_PRESEASON_SNAPSHOT_JOB_NAME = "props-preseason-snapshot";

export interface PropsPreseasonSnapshotPayload {
  /** The schedule's own fire instant (`schedule.ts`'s `tickOne`) — read here so the gate check is
   *  against the FIRE'S own instant rather than whatever the wall clock reads when the attempt
   *  actually executes, the same `firedAt`-over-`Date.now()` discipline `adp-snapshot-job.ts`
   *  already keeps. Optional because a hand-enqueued run (an operator re-run) carries no schedule
   *  fire; that case falls back to the injected clock. */
  readonly firedAt?: string;
}

export function parsePropsPreseasonSnapshotPayload(raw: JsonObject): PropsPreseasonSnapshotPayload {
  const firedAt = raw.firedAt;
  if (firedAt === undefined) return {};
  if (typeof firedAt !== "string" || Number.isNaN(Date.parse(firedAt))) {
    throw new Error(`props-preseason-snapshot payload: firedAt must be an ISO instant string, got ${JSON.stringify(firedAt)}.`);
  }
  return { firedAt };
}

/** The network + gate seam, injectable so a test drives both "before kickoff" and "the gate has
 *  closed" without a socket or a real schedule row. Mirrors `SeasonWeekNetwork`'s own shape
 *  (`season-week-job.ts`). */
export interface PropsPreseasonSnapshotDeps {
  readonly firstKickoff: (db: Db, season: number) => Promise<Date | null>;
  readonly snapshot: (db: Db, apiKey: string) => Promise<SnapshotSummary>;
}

const REAL_DEPS: PropsPreseasonSnapshotDeps = { firstKickoff: firstKickoffFor, snapshot: runOddsSnapshot };

export async function runPropsPreseasonSnapshotStep(
  db: Db,
  clock: Clock,
  payload: PropsPreseasonSnapshotPayload,
  deps: PropsPreseasonSnapshotDeps = REAL_DEPS,
): Promise<StepOutcome> {
  const now = payload.firedAt !== undefined ? new Date(payload.firedAt) : new Date(clock.now());
  const kickoff = await deps.firstKickoff(db, PRODUCT_SEASON);

  if (kickoff === null) {
    return {
      summary: `props-preseason-snapshot: ${PRODUCT_SEASON} has no ingested schedule yet, so there is no kickoff to gate against; skipping (no network call made)`,
      detail: [],
    };
  }

  // THE SELF-DISABLE. Strictly before, never at: a snapshot fetched AT the instant of kickoff is
  // exactly the leakage `props-anchor.ts`'s own gate refuses to read, so a fire landing on or after
  // that instant does no work at all — never mind that its own line would be rejected downstream.
  if (now.getTime() >= kickoff.getTime()) {
    return {
      summary: `props-preseason-snapshot: ${PRODUCT_SEASON} kicked off at ${kickoff.toISOString()}; the pre-kickoff window is closed and this job no longer runs (no network call made)`,
      detail: [],
    };
  }

  const apiKey = requireEnv("ODDS_API_KEY");
  const summary = await deps.snapshot(db, apiKey);
  return {
    summary:
      `props-preseason-snapshot: fetched ${summary.totalEvents} event(s) (${summary.selectedEvents} snapshotted), wrote ` +
      `${summary.totalWritten} observation(s) (${summary.totalSkipped} single-sided line(s) skipped); ` +
      `credits remaining=${summary.credits.remaining} used=${summary.credits.used}`,
    detail: [],
  };
}

export const propsPreseasonSnapshotJob: AnyJobDefinition = defineJob<PropsPreseasonSnapshotPayload>({
  name: PROPS_PRESEASON_SNAPSHOT_JOB_NAME,
  maxAttempts: 3,
  // Up to 21 sequential fetches (one /events call plus up to MAX_EVENTS_PER_RUN event-odds calls,
  // `odds/snapshot.ts`) — generous headroom against a slow upstream night, wider than the ADP
  // snapshot's single-fetch budget for the same reason `season-week-job.ts` budgets its own
  // props-snapshot step inside a larger multi-step timeout.
  timeoutMs: 5 * 60_000,
  backoff: { baseMs: 60_000, maxMs: 10 * 60_000 },
  parsePayload: parsePropsPreseasonSnapshotPayload,
  steps: [{ name: "snapshot", run: (ctx, payload) => runPropsPreseasonSnapshotStep(ctx.db, ctx.clock, payload) }],
});
