import type { Db, ReadonlyDb } from "@/db/client";
import { nflPlayers } from "@/db/schema";
import { createNflverseClient, type NflverseClient } from "../nflverse/client";
import { NFLVERSE_CONFIG } from "../nflverse/config";
import { mapWeek1Rosters, ROSTER_SOURCE_CONFIG } from "../nflverse/rosters";
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
): Promise<RosterIngestReport> {
  const rows = await client.getCsv(
    NFLVERSE_CONFIG.releases.weeklyRosters,
    ROSTER_SOURCE_CONFIG.file(season),
  );
  const entries = mapWeek1Rosters(rows, season);
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
