import type { Db, ReadonlyDb } from "@research-ts/db/client";
import { nflPlayers } from "@research-ts/db/schema";
import type { Clock } from "@research-ts/domain/timing";
import { createNflverseClient, type NflverseClient } from "../nflverse/client";
import { NFLVERSE_CONFIG } from "../nflverse/config";
import {
  HISTORICAL_ROSTER_FLOOR,
  mapWeek1Rosters,
  ROSTER_SOURCE_CONFIG,
  week1RosterAsOfBoundedBy,
  type PreseasonRosterEntry,
} from "../nflverse/rosters";
import { allPositions } from "../backtest";
import { recordObservations } from "../store";
// The NULLABLE reading of the same consolidated definition `firstKickoffFor` (below) throws through:
// a season with no ingested schedule is a season this module declines to call live, never a refusal.
import { firstKickoffFor as scheduledFirstKickoff } from "../team-store";
import { firstKickoffFor, mapDepthChart } from "./depth";
import { deletePreseasonRosters, preseasonRosterStatusesFor, recordPreseasonRosters } from "./store";

/**
 * BRINGING THE OFFSEASON INTO THE STORE — one season's week-one rosters, stamped at cutdown.
 *
 * Kept out of `nflverse/ingest.ts` on purpose. Everything in that file is a fact a GAME produced
 * and is stamped from a game day; this is the one fact in the engine that is true before any game
 * and is stamped from a league deadline. Mixing the two would put a second, differently-derived
 * stamp behind a docblock that promises game-day derivation, and the whole value of the `as_of`
 * column is that a reader can tell which kind of claim a row is making.
 */

/**
 * Which write path a season's roster ingestion took, and what it did.
 *
 * `insert_if_absent` is the archive path, unchanged since this module was written: rows land once and
 * a re-run adds nothing. `supersede` is the LIVE path — see `ingestWeek1Rosters`'s own docblock for
 * why a season that has not kicked off cannot be written the archive way.
 */
export type RosterWriteMode = "supersede" | "insert_if_absent";

/** What a roster write changed, in the terms an operator reads it in. */
export interface RosterWriteCounts {
  readonly mode: RosterWriteMode;
  /** Rows this run actually put in the table. */
  readonly written: number;
  /** Players the season had no row for at all before this run. */
  readonly added: number;
  /** Players whose existing row this run replaced. Always 0 on the archive path, which replaces
   *  nothing by construction. */
  readonly replaced: number;
  /** The replaced rows whose STATUS the fresh capture states differently — the count that would have
   *  been silently zero for every re-ingest before the live path existed. */
  readonly statusChanged: number;
  /** Players the season held a row for that the fresh capture does not carry at all. Always 0 on the
   *  archive path, which deletes nothing. */
  readonly removed: number;
}

/** What one season's roster ingestion reports about itself. */
export interface RosterIngestReport extends RosterWriteCounts {
  readonly season: number;
  /** Week-one entries the release carried, before the universe was consulted. */
  readonly entriesRead: number;
  /**
   * Entries dropped because the gsis id is not in `nfl_players`.
   *
   * Reported rather than swallowed, following `players.ts`' rule: a join that quietly loses eight
   * percent of receivers looks like a lot of healthy scratches rather than like a bug. Camp bodies
   * genuinely absent from the universe are the ordinary case here and the number should be small
   * relative to `entriesRead`.
   */
  readonly unknownToUniverse: number;
}

/**
 * THE HONEST STAMP FOR A SEASON BEFORE THE FIXED-STAMP CUTOVER.
 *
 * `week1RosterAsOf`'s single hardcoded first-of-September cannot be trusted below
 * `ROSTER_SOURCE_CONFIG.earliestSeason` — see that constant's own docblock for the two cutdown dates
 * (2016, 2017) that already fall after it, on top of 2020's pandemic-pushed one. Rather than research
 * and hardcode every historical cutdown date (a search that gets harder and less certain the further
 * back it goes), this reads the season's OWN first kickoff from the store — already ingested by
 * `projections:context` back to 2011 — and stamps one millisecond before it, exactly as
 * `ingestDepthCharts` below stamps a depth chart. That is always SAFE (a cutdown, whenever it fell,
 * necessarily preceded the games it enabled) and never LATE enough to matter: the earliest
 * game-derived observation `preseasonMomentFor` gates on is stamped a day and a half after kickoff,
 * so a roster stamped a millisecond before kickoff is always visible to a board built for its own
 * season. The one thing it gives up, deliberately, is claiming the EXACT cutdown date — this module
 * only ever needs "knowable before the season", never "knowable on this specific day in August".
 */
export async function historicalWeek1RosterAsOf(db: ReadonlyDb, season: number): Promise<Date> {
  if (season < HISTORICAL_ROSTER_FLOOR) {
    throw new Error(
      `Week-one rosters are not backfilled before ${HISTORICAL_ROSTER_FLOOR}; ${season} is out of scope. See HISTORICAL_ROSTER_FLOOR.`,
    );
  }
  return new Date((await firstKickoffFor(db, season)).getTime() - 1);
}

/**
 * `week1RosterAsOfBoundedBy(season, fetchedAt)` from the fixed-stamp cutover onward,
 * `historicalWeek1RosterAsOf` before it. The one place a caller decides which of the two stamping
 * strategies a season needs. Exported so the dispatch itself — not just each branch in isolation —
 * can be pinned by a test.
 *
 * `fetchedAt` (Task 3, ruling C) matters ONLY to the fixed-stamp branch — the honest bound on the
 * September-1 convention, mirroring `parseExpertConsensus`'s own `earlierOf`. The historical branch
 * ignores it entirely: `historicalWeek1RosterAsOf` derives its stamp from the season's own kickoff,
 * never from a clock, so there is nothing for a fetch instant to bound there.
 */
export async function week1RosterStampFor(db: ReadonlyDb, season: number, fetchedAt: Date): Promise<Date> {
  return season >= ROSTER_SOURCE_CONFIG.earliestSeason
    ? week1RosterAsOfBoundedBy(season, fetchedAt)
    : historicalWeek1RosterAsOf(db, season);
}

/** The real wall clock, read by both ingest functions below exactly where `client`'s own default
 *  (`createNflverseClient()`) already reads real configuration in this same file — overridable in a
 *  test the identical way `client` already is. */
const REAL_CLOCK: Clock = { now: () => new Date().toISOString() };

/**
 * Reads one season's week-one rosters into the store.
 *
 * Filtered to the ids the universe already holds, because `preseason_rosters.player_id` is a
 * foreign key and a camp arm the NFL never issued a gsis id to would fail the whole insert. The
 * drop is counted and returned rather than logged, so a caller can refuse a season whose resolution
 * collapsed instead of quietly building a board on half a league.
 *
 * SELF-SUPERSEDING FOR A LIVE SEASON, insert-if-absent for an archive one, and the split is the
 * whole of this function's care. A season's stamp is `min(the first of September, the fetch
 * instant)` and DOES NOT MOVE between two runs on the same day, so a re-ingest's rows collide with
 * the landed ones on `preseason_rosters_fact_idx` and `onConflictDoNothing` throws every fresh status
 * away — a re-run reports "0 new" and the store keeps saying what it said this morning. That is
 * harmless for a season whose rosters were settled years ago and actively wrong for one whose clubs
 * are still cutting players: the defect that produced this function's live arm was a back the Broncos
 * had already released sitting 118th on the 2026 board, because our row still read DEN/active from
 * the day's first capture. The live arm deletes the season's rows and writes the fresh capture in ONE
 * transaction, exactly as `nflverse/ingest.ts`'s `ingestDerivedStatLines` does for a recomputed
 * derivation, and for the same reason: a row that is a current best statement rather than a primary
 * record is safe to replace, and dangerous not to.
 *
 * AN ARCHIVE SEASON IS BYTE-IDENTICAL to before, deliberately and load-bearingly. Every published
 * measurement in this engine was fitted and scored against rows written insert-if-absent, and a replay
 * season's rows are the primary record of what was knowable before a season that has now been played.
 * Nothing in this path may delete one.
 *
 * LIVE IS THE KICKOFF, NEVER THE CALENDAR — `season`'s own first scheduled kickoff read from the
 * store, compared against the fetch instant, which is `preseason/source.ts`'s `liveMomentFor` guard
 * verbatim ("`now >= kickoff` means the season has already started"). A season the store holds no
 * schedule for is treated as an ARCHIVE: an ingestion cannot claim a season is still ahead of us on
 * the strength of a schedule it has never seen, and the conservative reading costs a refresh rather
 * than a row.
 */
export async function ingestWeek1Rosters(
  db: Db,
  season: number,
  client: NflverseClient = createNflverseClient(),
  clock: Clock = REAL_CLOCK,
): Promise<RosterIngestReport> {
  const rows = await client.getCsv(
    NFLVERSE_CONFIG.releases.weeklyRosters,
    ROSTER_SOURCE_CONFIG.file(season),
  );
  // Read AFTER the fetch, never before: the claim is "we had this file", and a clock read before a
  // slow request would date the claim to before the bytes existed. Mirrors `fetchExpertConsensus`'s
  // own "read AFTER the body" comment in `preseason/publishers.ts`.
  const fetchedAt = new Date(clock.now());
  const asOf = await week1RosterStampFor(db, season, fetchedAt);
  const entries = mapWeek1Rosters(rows, season, asOf);
  const known = await knownPlayerIds(db);
  const insertable = entries.filter((entry) => known.has(entry.playerId));
  const write = (await isLiveSeason(db, season, fetchedAt))
    ? await supersedeSeasonRosters(db, season, insertable)
    : await appendSeasonRosters(db, insertable);
  return {
    season,
    entriesRead: entries.length,
    unknownToUniverse: entries.length - insertable.length,
    ...write,
  };
}

/** Whether `season` has still not kicked off as of `at` — `liveMomentFor`'s own guard, and `false`
 *  whenever the store holds no schedule to check against. See `ingestWeek1Rosters`'s docblock. */
async function isLiveSeason(db: ReadonlyDb, season: number, at: Date): Promise<boolean> {
  const kickoff = await scheduledFirstKickoff(db, season);
  return kickoff !== null && at.getTime() < kickoff.getTime();
}

/**
 * The LIVE write: delete the season's rows, write the fresh capture, in one transaction.
 *
 * REFUSES AN EMPTY CAPTURE rather than emptying the season. A file that mapped to nothing is a broken
 * release or a fetch that returned a stub, and "delete every row and write none" is the one outcome
 * this path must never produce silently — the same fail-fast reading `ingestCoaches` gives a missing
 * play-caller file. The archive path needs no such guard: writing nothing there deletes nothing.
 */
async function supersedeSeasonRosters(
  db: Db,
  season: number,
  entries: readonly PreseasonRosterEntry[],
): Promise<RosterWriteCounts> {
  if (entries.length === 0) {
    throw new Error(
      `${season}'s week-one roster file mapped to an empty capture, so there is nothing to supersede its stored rows with. Refusing to delete the season's rosters on the strength of an empty file.`,
    );
  }
  return db.transaction(async (tx) => {
    const before = await preseasonRosterStatusesFor(tx, season);
    await deletePreseasonRosters(tx, season);
    const written = await recordPreseasonRosters(tx, entries);
    const fresh = new Set(entries.map((entry) => entry.playerId));
    let replaced = 0;
    let statusChanged = 0;
    for (const entry of entries) {
      const previous = before.get(entry.playerId);
      if (previous === undefined) continue;
      replaced += 1;
      if (previous !== entry.status) statusChanged += 1;
    }
    return {
      mode: "supersede",
      written,
      added: entries.length - replaced,
      replaced,
      statusChanged,
      removed: [...before.keys()].filter((playerId) => !fresh.has(playerId)).length,
    };
  });
}

/** The ARCHIVE write: `recordPreseasonRosters` alone, untouched. Everything it cannot do — replace,
 *  remove, restate a status — reports zero, because it never does any of them. */
async function appendSeasonRosters(db: Db, entries: readonly PreseasonRosterEntry[]): Promise<RosterWriteCounts> {
  const written = await recordPreseasonRosters(db, entries);
  return { mode: "insert_if_absent", written, added: written, replaced: 0, statusChanged: 0, removed: 0 };
}

/** Every id `nfl_players` holds. Read once per season rather than per row. */
async function knownPlayerIds(db: ReadonlyDb): Promise<ReadonlySet<string>> {
  const rows = await db.select({ id: nflPlayers.id }).from(nflPlayers);
  return new Set(rows.map((row) => row.id));
}

/** What one season's depth-chart ingestion reports about itself. */
export interface DepthChartIngestReport {
  readonly season: number;
  /** Week-one offensive entries the release carried, before the universe was consulted. */
  readonly entriesRead: number;
  /** How many were written. A re-run of a landed ingestion reports 0. */
  readonly written: number;
  /**
   * THE CUTOFF this run used to pick which snapshot counts as week one — `min(now, firstKickoff -
   * 1ms)` (Task 3, ruling B). For a LEGACY season (the week/game_type/formation schema, 2019-2025)
   * this is ALSO the stamp every row carries, unchanged from before this ruling — that path is
   * byte-identical. For a DATED season (2026 onward) each row instead carries its own snapshot's
   * real `dt` (see `mapDepthChart`'s docblock); this field is only the ceiling that snapshot could
   * not exceed, not the stamp itself. Printed so an operator can check the claim rather than trust
   * it either way.
   */
  readonly asOf: Date;
  /** Depth-chart rows naming a player the universe does not project. */
  readonly unknownToUniverse: number;
}

/**
 * Reads one season's WEEK-ONE depth chart into the store, stamped before the season's first game.
 *
 * Here rather than in `nflverse/ingest.ts` for the reason the roster ingestion above is: every row
 * that file writes is a fact a game produced, and this one is a claim about what was knowable before
 * any game was played. `firstGameDayFor` derives the stamp and `depth.ts` documents what it may and
 * may not claim.
 *
 * THE CUTOFF IS `min(now, firstKickoff - 1ms)`, NOT `firstKickoff - 1ms` ALONE (Task 3, ruling B).
 * For an already-played season `firstKickoff - 1ms` is always in the past, so `now` never binds and
 * this is byte-identical to the ingestion every archived season already ran under. For a season that
 * has not kicked off yet, `firstKickoff - 1ms` is a FUTURE instant, and letting it stand as the
 * cutoff would mean selecting a snapshot as though we had already seen everything up to the eve of
 * kickoff — a claim this ingestion has no grounds for on the day it actually runs. Bounding by `now`
 * keeps the claim honest: we can only pick from what has actually been published as of the moment we
 * are doing the picking.
 */
export async function ingestDepthCharts(
  db: Db,
  season: number,
  client: NflverseClient = createNflverseClient(),
  clock: Clock = REAL_CLOCK,
): Promise<DepthChartIngestReport> {
  const rows = await client.getCsv(NFLVERSE_CONFIG.releases.depthCharts, `depth_charts_${season}.csv`);
  const kickoffEve = new Date((await firstKickoffFor(db, season)).getTime() - 1);
  const now = new Date(clock.now());
  const asOf = now.getTime() < kickoffEve.getTime() ? now : kickoffEve;
  // The universe of PROJECTED players, exactly as `ingestInjuryReports` narrows: a lineman's
  // place on a depth chart has nowhere to go, and the store is keyed on a player the board carries.
  const mapped = mapDepthChart(rows, new Set((await allPositions(db)).keys()), season, asOf);
  return {
    season,
    entriesRead: mapped.observations.length + mapped.unknownPlayers.length,
    written: await recordObservations(db, mapped.observations),
    asOf,
    unknownToUniverse: mapped.unknownPlayers.length,
  };
}
