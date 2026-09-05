/**
 * THE NIGHTLY ADP SNAPSHOT (Draft HQ phase 2 Task 6, phase 4's data collection started early) —
 * one append-only row per resolved player, per capture, into `adp_snapshots`. Never a live-table
 * overwrite: unlike `preseason_rankings` (which a LIVE season's re-ingest deletes and replaces,
 * `preseason/ingest.ts`'s own docblock), this table exists so phase 4's market page has a real
 * trend to draw — a snapshot from two weeks ago must still be readable two weeks from now.
 *
 * READS THE IDENTICAL FEED `market_anchor` ALREADY RESOLVES THROUGH: `fetchAverageDraftPosition`
 * (`@/projections/preseason/publishers.ts`), Fantasy Football Calculator's twelve-team PPR ADP —
 * the same call `scripts/preseason-ingest.ts` makes for the historical `preseason_rankings`
 * benchmark, and the same feed `@/projections/market/curve.ts`'s `marketBoard` ultimately prices
 * off of (through that stored benchmark). One feed, one resolution path
 * (`resolveRankings`/`RosterIdentity`, `@/projections/preseason/benchmarks.ts`), reused rather
 * than re-fetched or re-resolved a second way.
 *
 * BACKFILLS NOTHING: this module only ever captures the CURRENT feed at the moment it runs. A
 * season's trend history starts the day this job first fires and grows one capture at a time —
 * there is no way to honestly manufacture what the market believed on a night before this table
 * existed.
 */
import { and, desc, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { adpSnapshots, nflPlayers, playerCrosswalk } from "@/db/schema";
import { BENCHMARK_SOURCES, resolveRankings, type RosterIdentity } from "@/projections/preseason/benchmarks";
import { fetchAverageDraftPosition } from "@/projections/preseason/publishers";
import { preseasonRostersAsOf } from "@/projections/preseason/store";
import { PRODUCT_SEASON } from "@/projections/preseason/current";

/** The one market/format pair this capture writes today — `BENCHMARK_SOURCES.adp` reused rather
 *  than a second literal, so the snapshot archive and the historical benchmark can never name the
 *  same feed two different ways. */
export const ADP_SNAPSHOT_CONFIG = {
  source: BENCHMARK_SOURCES.adp,
  /** The scoring/team-count format the feed itself publishes (`fetchAverageDraftPosition`'s own
   *  docblock: FFC's twelve-team PPR board) — free text, matching `adp_snapshots.format`, so a
   *  second format later is a new value here, never a schema change. */
  format: "ppr_12",
} as const;

/** Far past any correction: the roster read wants everything knowable right now, not a
 *  point-in-time bound (mirrors `scripts/preseason-ingest.ts`'s own `FINAL`). */
const FAR_FUTURE = new Date("9999-12-31T00:00:00.000Z");

/** The current season's own roster, with names joined on, as the resolver needs to see it — the
 *  identical shape `scripts/preseason-ingest.ts`'s script-local `rosterIdentities` builds, kept
 *  here instead since a job step may not import a script file. */
async function rosterIdentitiesFor(db: Db, season: number): Promise<readonly RosterIdentity[]> {
  const roster = await preseasonRostersAsOf(db, { season, asOf: FAR_FUTURE });
  const names = new Map((await db.select({ id: nflPlayers.id, name: nflPlayers.name }).from(nflPlayers)).map((row) => [row.id, row.name]));
  return roster
    .map((row) => ({ playerId: row.playerId, name: names.get(row.playerId) ?? "", position: row.position, team: row.team }))
    .filter((identity) => identity.name !== "");
}

export interface AdpSnapshotResult {
  readonly candidatesRead: number;
  /** Matched over published — `null` for an empty board, mirroring `metrics.ts`'s own convention
   *  (never a fabricated 1 or 0 for "no data"). */
  readonly resolutionRate: number | null;
  readonly written: number;
}

export interface AdpSnapshotOptions {
  readonly season?: number;
  /** Injected for the same reason `fetchAverageDraftPosition` itself injects it: no test may
   *  touch the network. */
  readonly fetchImpl?: typeof globalThis.fetch;
  /**
   * The capture instant — becomes every written row's own `capturedAt`. Fix round 1, MEDIUM 2:
   * this is NOT a wall clock in production. `src/jobs/defs/adp-snapshot-job.ts`'s
   * `runAdpSnapshotStep` derives it from the schedule's own `firedAt` (threaded onto the job's
   * payload by `schedule.ts`'s `tickOne`) rather than `Date.now()` at attempt time, so a
   * SAME-NIGHT RETRY of the identical scheduled fire (a crashed attempt, a redelivered tick)
   * recomputes the IDENTICAL `capturedAt` and therefore the identical
   * `(player_id, source, captured_at)` tuple — the unique index
   * (`adp_snapshots_player_source_captured_idx`) is what makes that retry a genuine no-op rather
   * than a second row for the same night. Only a caller with no schedule fire at all (a hand-run
   * operator invocation) falls back to a real wall-clock default here, and that path has no
   * retry-safety guarantee beyond "don't retry within the same instant" — the honest, narrower
   * claim this docblock used to make for every caller.
   */
  readonly now?: () => Date;
}

/**
 * One capture: fetch the live feed, resolve it against the current season's own roster, write
 * whatever resolved as a fresh, append-only batch of rows. Safe against a same-night retry
 * STRUCTURALLY, not by luck: see `AdpSnapshotOptions.now`'s own docblock for the real mechanism
 * (the schedule's fire instant, not wall-clock `Date.now()`) that makes the unique index catch a
 * retried attempt rather than merely a retry that happens to land in the same millisecond.
 */
export async function ingestAdpSnapshot(db: Db, options: AdpSnapshotOptions = {}): Promise<AdpSnapshotResult> {
  const season = options.season ?? PRODUCT_SEASON;
  const now = options.now ?? (() => new Date());
  const board = await fetchAverageDraftPosition(season, options.fetchImpl ?? globalThis.fetch);

  const identities = await rosterIdentitiesFor(db, season);
  const resolution = resolveRankings(board.candidates, identities);
  if (resolution.resolved.length === 0) {
    return { candidatesRead: board.candidates.length, resolutionRate: resolution.resolutionRate, written: 0 };
  }

  const capturedAt = now();
  const rows = resolution.resolved.map((entry) => ({
    playerId: entry.playerId,
    source: ADP_SNAPSHOT_CONFIG.source,
    format: ADP_SNAPSHOT_CONFIG.format,
    adp: entry.rank,
    capturedAt,
  }));
  const inserted = await db.insert(adpSnapshots).values(rows).onConflictDoNothing().returning({ id: adpSnapshots.id });

  return { candidatesRead: board.candidates.length, resolutionRate: resolution.resolutionRate, written: inserted.length };
}

/**
 * One player's ADP history, oldest first — phase 4's own future read; exercised here (rather than
 * left unbuilt) so the append-only archive is provably readable the day it starts filling, not
 * only provably writable. Takes a PRODUCT `players.id` (the space every other product surface
 * addresses a player by) and joins through `player_crosswalk` to `adp_snapshots`' own
 * `nfl_players` space — the identical crosswalk `@/draft-hq/board/service.ts`'s `boardRows`
 * already joins the evidence board through, in the opposite direction.
 */
export async function adpSnapshotHistory(db: Db, productPlayerId: string, limit: number = 90): Promise<readonly { readonly adp: number; readonly capturedAt: Date }[]> {
  const [crosswalk] = await db.select({ nflPlayerId: playerCrosswalk.nflPlayerId }).from(playerCrosswalk).where(eq(playerCrosswalk.playerId, productPlayerId)).limit(1);
  if (crosswalk === undefined || crosswalk.nflPlayerId === null) return [];
  const rows = await db
    .select({ adp: adpSnapshots.adp, capturedAt: adpSnapshots.capturedAt })
    .from(adpSnapshots)
    .where(and(eq(adpSnapshots.playerId, crosswalk.nflPlayerId), eq(adpSnapshots.source, ADP_SNAPSHOT_CONFIG.source)))
    .orderBy(desc(adpSnapshots.capturedAt))
    .limit(limit);
  return rows.reverse();
}
