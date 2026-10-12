// THE PRE-KICKOFF PROPS SNAPSHOT — runs nightly (the research nightly run's ingest, and the league
// app's `props-preseason-snapshot` job until cutover) and captures
// the current season's props archive (`@research/projections/odds/snapshot`'s `runOddsSnapshot`, the same
// work `npm run projections:odds:snapshot` does), THEN RESOLVES it (`player-map.ts`'s
// `resolveAllPropNames`, the identical core `npm run projections:odds:resolve` runs by hand) so a
// newly-captured or newly-postable name reaches `props_player_map` the same night rather than
// waiting on an operator to remember a manual step — until `PRODUCT_SEASON`'s own first kickoff,
// after which BOTH steps SELF-DISABLE: every fire past that instant is a no-op that never reaches
// the network and never touches the resolve core either.
//
// WHY THIS EXISTS SEPARATELY FROM THE SEASON-WEEK CADENCE. `season-week-job.ts`'s own
// `props-snapshot` step already runs the identical `runOddsSnapshot` three times a week
// (Tue/Wed/Thu, `schedules.ts`), but that cadence exists to keep the CURRENT week's lines fresh
// for whichever week is about to freeze — it is not aimed at growing the pre-kickoff archive
// `market/props-anchor.ts`'s leakage gate reads from for THIS season. A daily cadence in the
// run-up to kickoff (rather than three-times-weekly) buys more independent snapshots of a market
// that moves daily in the final week, at the cost of more API credits — an acceptable trade
// because this job SELF-DISABLES the instant the reason for running it is gone.
//
// WHAT "THE WINDOW CLOSES" ACTUALLY MEANS (fix round 1 correction, 2026-09-05) — narrower than an
// earlier draft of this comment claimed. `props-anchor.ts`'s leakage gate refuses any row whose
// `fetched_at` is at or after the season's first kickoff, so this job's OWN, LIVE-TIER capture
// genuinely cannot contribute a usable row past that instant — that half is verified and certain.
// What is NOT verified, and is left explicitly open: the 2023-2025 archive `scripts/odds-props-
// backfill.ts` built was fetched through the Odds API's HISTORICAL endpoint, which reconstructs a
// snapshot AT A PAST INSTANT after the fact — so whether a missed pre-kickoff window could later be
// recovered retroactively (subject to that endpoint's own retention and cost) is a genuinely open
// question this round did not answer. This job exists so that question never needs answering for
// 2026: running daily rather than relying on a later historical rebuild is the belt, not the only
// strap.
//
// SELF-DISABLING, MECHANICALLY. There is no per-schedule "disable" switch in this job system
// (`schedule.ts`'s `tickOne` fires every schedule unconditionally, forever) — so the STEP itself
// is what stops: once `now >= firstKickoffFor(PRODUCT_SEASON)`, it returns a skip outcome without
// ever calling `runOddsSnapshot` OR `resolveAllPropNames`, spending zero credits and writing zero
// rows. The daily fire still lands in the queue harmlessly for the life of the product; only the
// actual network call and archive writes are gated. `PRODUCT_SEASON` itself rolls forward exactly
// once a year (`preseason/current.ts`'s own docblock), at which point this job's gate re-opens for
// the new season's own pre-kickoff window automatically — no redeploy, no schedule edit.
//
// TERMINAL VS RETRYABLE: identical judgment to `adp-snapshot-job.ts`'s own — a missing
// `ODDS_API_KEY`, a network/HTTP failure inside `runOddsSnapshot`, or a DB failure inside the
// resolve step is worth retrying (the next scheduled fire, or a same-night redelivery, may simply
// find the key configured or the upstream recovered), so nothing here is classified terminal.
import type { Db } from "@research/db/client";
import type { Clock } from "@research/domain/timing";
import { PRODUCT_SEASON } from "@research/projections/preseason/current";
import { requireEnv } from "@research/projections/odds/http";
import { resolveAllPropNames, type ResolveAllPropNamesResult } from "@research/projections/odds/player-map";
import { runOddsSnapshot, type SnapshotSummary } from "@research/projections/odds/snapshot";
import { firstKickoffFor } from "@research/projections/team-store";

export interface PropsPreseasonSnapshotPayload {
  /** The schedule's own fire instant (`schedule.ts`'s `tickOne`) — read here so the gate check is
   *  against the FIRE'S own instant rather than whatever the wall clock reads when the attempt
   *  actually executes, the same `firedAt`-over-`Date.now()` discipline `adp-snapshot-job.ts`
   *  already keeps. Optional because a hand-enqueued run (an operator re-run) carries no schedule
   *  fire; that case falls back to the injected clock. */
  readonly firedAt?: string;
}

/** The network + gate + resolve seam, injectable so a test drives "before kickoff" (capture, then
 *  resolve), "the gate has closed" (neither), and a resolve failure without a socket, a real
 *  schedule row, or a real `props_player_map` write. Mirrors `SeasonWeekNetwork`'s own shape
 *  (`season-week-job.ts`). */
export interface PropsPreseasonSnapshotDeps {
  readonly firstKickoff: (db: Db, season: number) => Promise<Date | null>;
  readonly snapshot: (db: Db, apiKey: string) => Promise<SnapshotSummary>;
  readonly resolve: (db: Db) => Promise<ResolveAllPropNamesResult>;
}

export const REAL_PROPS_PRESEASON_DEPS: PropsPreseasonSnapshotDeps = { firstKickoff: firstKickoffFor, snapshot: runOddsSnapshot, resolve: resolveAllPropNames };

export async function snapshotPreseasonProps(
  db: Db,
  clock: Clock,
  payload: PropsPreseasonSnapshotPayload,
  deps: PropsPreseasonSnapshotDeps = REAL_PROPS_PRESEASON_DEPS,
): Promise<{ readonly summary: string }> {
  const now = payload.firedAt !== undefined ? new Date(payload.firedAt) : new Date(clock.now());
  const kickoff = await deps.firstKickoff(db, PRODUCT_SEASON);

  if (kickoff === null) {
    return {
      summary: `props-preseason-snapshot: ${PRODUCT_SEASON} has no ingested schedule yet, so there is no kickoff to gate against; skipping (no network call made)`,
    };
  }

  // THE SELF-DISABLE. Strictly before, never at: a snapshot fetched AT the instant of kickoff is
  // exactly the leakage `props-anchor.ts`'s own gate refuses to read, so a fire landing on or after
  // that instant does no work at all — never mind that its own line would be rejected downstream.
  // The resolve step is gated identically: a name only THIS capture could have posted is not worth
  // resolving once the capture that would have produced it never ran.
  if (now.getTime() >= kickoff.getTime()) {
    return {
      summary: `props-preseason-snapshot: ${PRODUCT_SEASON} kicked off at ${kickoff.toISOString()}; the pre-kickoff window is closed and this job no longer runs (no network call made)`,
    };
  }

  const apiKey = requireEnv("ODDS_API_KEY");
  const summary = await deps.snapshot(db, apiKey);

  // THE SELF-RESOLVE (fix round 1, MEDIUM 1a) — runs after every successful capture so a name this
  // capture just saw for the first time (or a late call-up the roster only just learned about)
  // reaches `props_player_map` the same night, with no operator needing to remember
  // `npm run projections:odds:resolve`. Idempotent (`resolveAllPropNames`'s own docblock), so this
  // costs a full-archive read even on a night with nothing new to resolve.
  const resolved = await deps.resolve(db);

  return {
    summary:
      `props-preseason-snapshot: fetched ${summary.totalEvents} event(s) (${summary.selectedEvents} snapshotted), wrote ` +
      `${summary.totalWritten} observation(s) (${summary.totalSkipped} single-sided line(s) skipped); ` +
      `credits remaining=${summary.credits.remaining} used=${summary.credits.used}; resolved ${resolved.matched.length}/` +
      `${resolved.observed.length} prop name(s) archive-wide (${resolved.written} newly mapped)`,
  };
}
