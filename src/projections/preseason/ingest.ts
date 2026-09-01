import type { Db, ReadonlyDb } from "@/db/client";
import { nflPlayers } from "@/db/schema";
import type { Clock } from "@/domain/timing";
import { createNflverseClient, type NflverseClient } from "../nflverse/client";
import { NFLVERSE_CONFIG } from "../nflverse/config";
import {
  HISTORICAL_ROSTER_FLOOR,
  mapWeek1Rosters,
  ROSTER_SOURCE_CONFIG,
  week1RosterAsOfBoundedBy,
} from "../nflverse/rosters";
import { allPositions } from "../backtest";
import { recordObservations } from "../store";
import { firstKickoffFor, mapDepthChart } from "./depth";
import { recordPreseasonRosters } from "./store";

/**
 * BRINGING THE OFFSEASON INTO THE STORE — one season's week-one rosters, stamped at cutdown.
 *
 * Kept out of `nflverse/ingest.ts` on purpose. Everything in that file is a fact a GAME produced
 * and is stamped from a game day; this is the one fact in the engine that is true before any game
 * and is stamped from a league deadline. Mixing the two would put a second, differently-derived
 * stamp behind a docblock that promises game-day derivation, and the whole value of the `as_of`
 * column is that a reader can tell which kind of claim a row is making.
 */

/** What one season's roster ingestion reports about itself. */
export interface RosterIngestReport {
  readonly season: number;
  /** Week-one entries the release carried, before the universe was consulted. */
  readonly entriesRead: number;
  /** How many were written. A re-run of a landed ingestion reports 0. */
  readonly written: number;
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
  const written = await recordPreseasonRosters(db, insertable);
  return {
    season,
    entriesRead: entries.length,
    written,
    unknownToUniverse: entries.length - insertable.length,
  };
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
