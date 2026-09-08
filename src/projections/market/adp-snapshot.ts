/**
 * THE NIGHTLY ADP SNAPSHOT (Draft HQ phase 2 Task 6, phase 4's data collection started early) —
 * one append-only row per resolved player, per format, per capture, into `adp_snapshots`. Never a
 * live-table overwrite: unlike `preseason_rankings` (which a LIVE season's re-ingest deletes and
 * replaces, `preseason/ingest.ts`'s own docblock), this table exists so phase 4's market page has
 * a real trend to draw — a snapshot from two weeks ago must still be readable two weeks from now.
 *
 * READS THE IDENTICAL FEED `market_anchor` ALREADY RESOLVES THROUGH: `fetchAverageDraftPosition`
 * (`@/projections/preseason/publishers.ts`), Fantasy Football Calculator's twelve-team ADP — the
 * same call `scripts/preseason-ingest.ts` makes for the historical `preseason_rankings` benchmark,
 * and the same feed `@/projections/market/curve.ts`'s `marketBoard` ultimately prices off of
 * (through that stored benchmark). One feed, one resolution path (`rosterIdentitiesFor` and
 * `resolveRankings`, `@/projections/preseason/adp-benchmark.ts`), reused rather than re-fetched or
 * re-resolved a second way.
 *
 * THREE FORMATS PER FIRE (the scoring-formats round, 2026-09-08): PPR, half PPR and standard, one
 * fetch each, so the job's upstream budget is `ADP_SNAPSHOT_CAPTURES.length` (three) requests a
 * night where it was one. Each format's rows land under that format's OWN `source`
 * (`ffc_adp_ppr_12`, `ffc_adp_half_12`, `ffc_adp_std_12`, the same names `preseason_rankings`
 * uses) and its own `format` (`ppr_12`, `half_12`, `std_12`), so the existing unique index on
 * `(player_id, source, captured_at)` already keeps the three apart and a same-night retry of the
 * whole fire is still a no-op. A reader that wants one format filters by source; a reader that
 * filters by nothing now sees three rows per player per night and must say which it means.
 *
 * BACKFILLS NOTHING: this module only ever captures the CURRENT feed at the moment it runs. A
 * season's trend history starts the day this job first fires and grows one capture at a time —
 * there is no way to honestly manufacture what the market believed on a night before this table
 * existed.
 */
import { and, desc, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { adpSnapshots, playerCrosswalk } from "@/db/schema";
import { resolveRankings } from "@/projections/preseason/benchmarks";
import { rosterIdentitiesFor } from "@/projections/preseason/adp-benchmark";
import { BOARD_FORMAT_SPECS, BOARD_FORMATS, DEFAULT_BOARD_FORMAT, type BoardFormat, type FfcAdpFormat } from "@/projections/preseason/board-formats";
import { fetchAverageDraftPosition } from "@/projections/preseason/publishers";
import { PRODUCT_SEASON } from "@/projections/preseason/current";

/** One format's capture: which feed to fetch and which source/format pair its rows carry. */
export interface AdpSnapshotCapture {
  readonly format: BoardFormat;
  readonly source: string;
  /** Free text, matching `adp_snapshots.format`. */
  readonly snapshotFormat: string;
  readonly feedFormat: FfcAdpFormat;
}

export function adpSnapshotCaptureFor(format: BoardFormat): AdpSnapshotCapture {
  const spec = BOARD_FORMAT_SPECS[format];
  return { format, source: spec.adpSource, snapshotFormat: spec.snapshotFormat, feedFormat: spec.feedFormat };
}

/** Every format one fire captures, PPR first. */
export const ADP_SNAPSHOT_CAPTURES: readonly AdpSnapshotCapture[] = BOARD_FORMATS.map(adpSnapshotCaptureFor);

/** THE JOB'S OWN UPSTREAM BUDGET: one request per format per fire, three a night. Named so the
 *  schedule's description, the job's docblock and the test all read one number. */
export const ADP_SNAPSHOT_REQUESTS_PER_FIRE = ADP_SNAPSHOT_CAPTURES.length;

/** The PPR capture's own source/format pair, the one every pre-round row was written under. */
export const ADP_SNAPSHOT_CONFIG = {
  source: adpSnapshotCaptureFor(DEFAULT_BOARD_FORMAT).source,
  format: adpSnapshotCaptureFor(DEFAULT_BOARD_FORMAT).snapshotFormat,
} as const;

export interface AdpSnapshotFormatResult {
  readonly format: BoardFormat;
  readonly candidatesRead: number;
  /** Matched over published — `null` for an empty board, mirroring `metrics.ts`'s own convention
   *  (never a fabricated 1 or 0 for "no data"). */
  readonly resolutionRate: number | null;
  readonly written: number;
  /** What this format's own fetch or parse threw, or `null` when it landed. EACH FORMAT IS ITS
   *  OWN TRY: a half-PPR feed that is down tonight never costs the PPR capture its rows. */
  readonly error: string | null;
}

export interface AdpSnapshotResult {
  /** Summed over every format captured. */
  readonly candidatesRead: number;
  /** Pooled: resolved over published across every format, `null` when nothing was published. */
  readonly resolutionRate: number | null;
  readonly written: number;
  readonly byFormat: readonly AdpSnapshotFormatResult[];
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
  /** Which formats to capture. Defaults to all three; a test pins one format's behaviour by
   *  naming it. */
  readonly formats?: readonly BoardFormat[];
}

type FormatCapture = AdpSnapshotFormatResult & { readonly resolved: number };

/** One format's fetch, resolve and append. The instant is shared by every format of one fire. */
async function captureFormat(
  db: Db,
  capture: AdpSnapshotCapture,
  season: number,
  identities: Awaited<ReturnType<typeof rosterIdentitiesFor>>,
  capturedAt: Date,
  fetchImpl: typeof globalThis.fetch,
): Promise<FormatCapture> {
  const board = await fetchAverageDraftPosition(season, fetchImpl, capture.feedFormat);
  const resolution = resolveRankings(board.candidates, identities);
  const base = { format: capture.format, candidatesRead: board.candidates.length, resolutionRate: resolution.resolutionRate, resolved: resolution.resolved.length, error: null };
  if (resolution.resolved.length === 0) return { ...base, written: 0 };

  const rows = resolution.resolved.map((entry) => ({
    playerId: entry.playerId,
    source: capture.source,
    format: capture.snapshotFormat,
    adp: entry.rank,
    capturedAt,
  }));
  const inserted = await db.insert(adpSnapshots).values(rows).onConflictDoNothing().returning({ id: adpSnapshots.id });
  return { ...base, written: inserted.length };
}

/** The same capture, with its own failure caught and named rather than thrown past the other
 *  formats: nothing published, nothing resolved, nothing written, and the message. */
async function captureFormatOrFailure(
  db: Db,
  capture: AdpSnapshotCapture,
  season: number,
  identities: Awaited<ReturnType<typeof rosterIdentitiesFor>>,
  capturedAt: Date,
  fetchImpl: typeof globalThis.fetch,
): Promise<FormatCapture> {
  try {
    return await captureFormat(db, capture, season, identities, capturedAt, fetchImpl);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return { format: capture.format, candidatesRead: 0, resolutionRate: null, resolved: 0, written: 0, error: message };
  }
}

/**
 * One capture: fetch each format's live feed, resolve it against the current season's own roster,
 * write whatever resolved as a fresh, append-only batch of rows. Safe against a same-night retry
 * STRUCTURALLY, not by luck: see `AdpSnapshotOptions.now`'s own docblock for the real mechanism
 * (the schedule's fire instant, not wall-clock `Date.now()`) that makes the unique index catch a
 * retried attempt rather than merely a retry that happens to land in the same millisecond.
 *
 * EACH FORMAT IS ITS OWN TRY (the scoring-formats round). A secondary format's failure is recorded
 * on its own `byFormat` entry and the fire succeeds with the PPR rows it wrote. The PPR capture
 * failing is the one failure that still THROWS, after every other format has had its turn: PPR is
 * the board the product reads, the job's retry exists for exactly that fetch, and the secondary
 * rows already written are no-ops on the retry (same instant, same unique index).
 */
export async function ingestAdpSnapshot(db: Db, options: AdpSnapshotOptions = {}): Promise<AdpSnapshotResult> {
  const season = options.season ?? PRODUCT_SEASON;
  const now = options.now ?? (() => new Date());
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const captures = (options.formats ?? BOARD_FORMATS).map(adpSnapshotCaptureFor);

  const identities = await rosterIdentitiesFor(db, season);
  const capturedAt = now();
  const results: FormatCapture[] = [];
  for (const capture of captures) {
    results.push(await captureFormatOrFailure(db, capture, season, identities, capturedAt, fetchImpl));
  }

  const primary = results.find((result) => result.format === DEFAULT_BOARD_FORMAT);
  if (primary !== undefined && primary.error !== null) {
    const others = results.filter((result) => result !== primary).map((result) => `${result.format}: ${result.error ?? `${result.written} written`}`);
    throw new Error(`adp-snapshot: the ${DEFAULT_BOARD_FORMAT} capture failed (${primary.error})${others.length > 0 ? `; ${others.join("; ")}` : ""}.`);
  }

  const candidatesRead = results.reduce((sum, result) => sum + result.candidatesRead, 0);
  const resolved = results.reduce((sum, result) => sum + result.resolved, 0);
  return {
    candidatesRead,
    resolutionRate: candidatesRead === 0 ? null : resolved / candidatesRead,
    written: results.reduce((sum, result) => sum + result.written, 0),
    byFormat: results.map(({ format, candidatesRead: read, resolutionRate, written, error }) => ({ format, candidatesRead: read, resolutionRate, written, error })),
  };
}

/**
 * One player's ADP history in one format, oldest first — phase 4's own future read; exercised
 * here (rather than left unbuilt) so the append-only archive is provably readable the day it
 * starts filling, not only provably writable. Takes a PRODUCT `players.id` (the space every other
 * product surface addresses a player by) and joins through `player_crosswalk` to `adp_snapshots`'
 * own `nfl_players` space — the identical crosswalk `@/draft-hq/board/service.ts`'s `boardRows`
 * already joins the evidence board through, in the opposite direction.
 */
export async function adpSnapshotHistory(
  db: Db,
  productPlayerId: string,
  limit: number = 90,
  format: BoardFormat = DEFAULT_BOARD_FORMAT,
): Promise<readonly { readonly adp: number; readonly capturedAt: Date }[]> {
  const [crosswalk] = await db.select({ nflPlayerId: playerCrosswalk.nflPlayerId }).from(playerCrosswalk).where(eq(playerCrosswalk.playerId, productPlayerId)).limit(1);
  if (crosswalk === undefined || crosswalk.nflPlayerId === null) return [];
  const rows = await db
    .select({ adp: adpSnapshots.adp, capturedAt: adpSnapshots.capturedAt })
    .from(adpSnapshots)
    .where(and(eq(adpSnapshots.playerId, crosswalk.nflPlayerId), eq(adpSnapshots.source, adpSnapshotCaptureFor(format).source)))
    .orderBy(desc(adpSnapshots.capturedAt))
    .limit(limit);
  return rows.reverse();
}
