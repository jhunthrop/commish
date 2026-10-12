// THE CADENCE'S REAL NETWORK DEPS — extracted from `scripts/season-week.ts` the day the job
// system (`src/jobs/defs/season-week-job.ts`) became the second caller, so the CLI and the
// durable job build their `SeasonWeekDeps` from ONE implementation instead of two drifting
// copies. The documented choice of ingest primitive lives with `realIngestStats` below.
import type { Db } from "@research/db/client";
import { createNflverseClient } from "@research/projections/nflverse/client";
import { ingestPlayerUniverse, ingestSeason, scheduleWeekAsOf } from "@research/projections/nflverse/ingest";
import { requireEnv } from "@research/projections/odds/http";
import { runOddsSnapshot } from "@research/projections/odds/snapshot";
import type { PropsSnapshotOutcome, StatsIngestOutcome } from "./steps";

/**
 * THE STATS-INGEST CHOICE (Task 2 brief: "pick the one that ingests a completed week's published
 * stats and document the choice").
 *
 * NOT `npm run stats:ingest` (the Tank01-backed LIVE SCORING pipeline: settles real leagues from
 * a paid, metered API into `player_stat_lines`, a table `src/projections/lines.ts` explicitly
 * refuses to read from). NOT `npm run projections:backfill` run for one season either (sized for
 * an ANNUAL history walk: control-season validation, a 95% resolution bar across the whole range,
 * gap-season derivation — all wrong weekly). This calls the primitive both of those share —
 * `ingestPlayerUniverse` + `scheduleWeekAsOf` + `ingestSeason` — for exactly the ONE season the
 * cadence cares about. Idempotent (`ingestSeason` writes `onConflictDoNothing`); a run that finds
 * nothing new costs one small CSV fetch and reports zero new observations. The full reasoning
 * paragraph lives in `scripts/season-week.ts`'s original header commit; this is its one home now.
 */
export async function realIngestStats(db: Db, season: number): Promise<StatsIngestOutcome> {
  const client = createNflverseClient();
  const universe = await ingestPlayerUniverse(db, client);
  const scheduleAsOf = (await scheduleWeekAsOf([season])).get(season);
  const report = await ingestSeason(db, client, universe, season, scheduleAsOf);
  return {
    observationsWritten: report.observationsWritten,
    statLines: report.statLines,
    participationRows: report.participationRows,
    playerWeekUnavailable: report.playerWeekUnavailable,
  };
}

/** One props snapshot (`runOddsSnapshot`, the same work as `npm run projections:odds:snapshot`).
 *  `ODDS_API_KEY` is read here through `requireEnv` and handed straight to the snapshot — it
 *  never rides an error message; a missing key throws `requireEnv`'s own name-only text. */
export async function realSnapshotProps(db: Db): Promise<PropsSnapshotOutcome> {
  const apiKey = requireEnv("ODDS_API_KEY");
  const summary = await runOddsSnapshot(db, apiKey);
  return {
    totalEvents: summary.totalEvents,
    selectedEvents: summary.selectedEvents,
    totalWritten: summary.totalWritten,
    totalSkipped: summary.totalSkipped,
    creditsRemaining: summary.credits.remaining,
    creditsUsed: summary.credits.used,
  };
}
