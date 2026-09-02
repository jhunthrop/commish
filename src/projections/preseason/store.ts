import { and, asc, desc, eq, inArray, lte, min } from "drizzle-orm";
import type { Db, DbTx, ReadonlyDb } from "@/db/client";
import { preseasonRankings, preseasonRosters } from "@/db/schema";
import type { PreseasonRosterEntry, RosterStatus } from "../nflverse/rosters";

/**
 * THE PRESEASON HALF OF THE POINT-IN-TIME STORE — the same discipline as `store.ts`, over the two
 * kinds of fact that exist before a season rather than during one.
 *
 * Both readers carry the `as_of <=` predicate for the same reason every read in this engine does:
 * a board for 2023 must be unable to reach a 2024 file, and the only thing standing between those
 * two is the gate. The preseason case is the DANGEROUS one — offseason data is messy, most of it
 * arrives in one undated dump, and a roster or a consensus ranking that quietly carried today's
 * date would make a backtest look like clairvoyance.
 *
 * Nothing here interprets. `availability.ts` decides what a reserve designation means and
 * `rookies.ts` decides what a draft pick implies; this module only decides what was knowable when.
 */

const INSERT_CHUNK_ROWS = 2_000;

/** One man's week-one roster row, as it was known at a moment. */
export interface PreseasonRosterRow {
  readonly season: number;
  readonly team: string;
  readonly playerId: string;
  readonly position: string;
  readonly status: RosterStatus;
  readonly birthDate: string | null;
  readonly draftYear: number | null;
  readonly draftPick: number | null;
  readonly draftClub: string | null;
  readonly asOf: Date;
}

/** One source's published ranking of one player before one season. */
export interface PreseasonRankingRow {
  readonly season: number;
  /** `ffc_adp_ppr_12`, `fantasypros_ecr_ppr`. */
  readonly source: string;
  readonly playerId: string;
  /** Lower is better, in whatever unit the source publishes. */
  readonly rank: number;
  readonly asOf: Date;
}

/**
 * Writes week-one rosters, idempotently, returning how many rows were ACTUALLY new.
 *
 * `onConflictDoNothing` and never `DoUpdate`, matching `recordObservations`: a roster as it stood at
 * a stated moment is immutable. A corrected file says something different at a LATER moment, which
 * is a new row and a new stamp, not an overwrite of the old belief.
 *
 * THAT ARGUMENT HOLDS ONLY WHILE THE STAMP CAN MOVE, which is why `preseason/ingest.ts` now runs this
 * write behind a delete for a LIVE season — see `deletePreseasonRosters` below. It is unchanged, and
 * still the only write an archive season ever takes.
 */
export async function recordPreseasonRosters(db: Db | DbTx, rows: readonly PreseasonRosterEntry[]): Promise<number> {
  let written = 0;
  for (let start = 0; start < rows.length; start += INSERT_CHUNK_ROWS) {
    const chunk = rows.slice(start, start + INSERT_CHUNK_ROWS).map((row) => ({ ...row }));
    const inserted = await db
      .insert(preseasonRosters)
      .values(chunk)
      .onConflictDoNothing()
      .returning({ id: preseasonRosters.id });
    written += inserted.length;
  }
  return written;
}

/**
 * Later than any stamp this table will ever hold — the bound for the one question that is about the
 * table's CURRENT contents rather than about what was knowable at a moment.
 *
 * Every other read here takes an `asOf` from its caller precisely because the gate is the point.
 * `preseasonRosterStatusesFor` is the exception that proves it: it exists to answer "what does this
 * season's row say, right now, before we replace it", and a point-in-time bound would be answering a
 * different question.
 */
const EVERY_STAMP = new Date("9999-12-31T00:00:00.000Z");

/**
 * What the season's rows state TODAY, one status per player — the "before" half of a superseding
 * write, so the ingestion can report what it actually changed instead of a row count.
 *
 * Read through `preseasonRostersAsOf` rather than with a query of its own so "one row per player"
 * means here exactly what it means to every reader of this table: the LATEST statement wins.
 */
export async function preseasonRosterStatusesFor(db: ReadonlyDb, season: number): Promise<ReadonlyMap<string, RosterStatus>> {
  const rows = await preseasonRostersAsOf(db, { season, asOf: EVERY_STAMP });
  return new Map(rows.map((row) => [row.playerId, row.status]));
}

/**
 * Deletes every week-one roster row for one season, returning how many went.
 *
 * FOR A LIVE SEASON ONLY, and the caller is the one that enforces it — `preseason/ingest.ts`'s
 * `ingestWeek1Rosters`, inside the same transaction as the write that replaces them, mirroring
 * `nflverse/ingest.ts`'s `ingestDerivedStatLines`. An ARCHIVE season's rows are the primary record
 * behind every published measurement in this engine and nothing may delete them through an
 * ingestion path; a live season's rows are a claim about a roster that is still moving, and the only
 * honest thing to do with a superseded claim is to replace it.
 */
export async function deletePreseasonRosters(db: Db | DbTx, season: number): Promise<number> {
  const deleted = await db
    .delete(preseasonRosters)
    .where(eq(preseasonRosters.season, season))
    .returning({ id: preseasonRosters.id });
  return deleted.length;
}

export async function recordPreseasonRankings(db: Db, rows: readonly PreseasonRankingRow[]): Promise<number> {
  let written = 0;
  for (let start = 0; start < rows.length; start += INSERT_CHUNK_ROWS) {
    const chunk = rows.slice(start, start + INSERT_CHUNK_ROWS).map((row) => ({ ...row }));
    const inserted = await db
      .insert(preseasonRankings)
      .values(chunk)
      .onConflictDoNothing()
      .returning({ id: preseasonRankings.id });
    written += inserted.length;
  }
  return written;
}

/**
 * The week-one roster for a season as it was knowable at `asOf`, one row per player.
 *
 * `DISTINCT ON (player_id)` ordered by descending `as_of` picks the latest statement at or before
 * the moment, exactly as `observationsAsOf` does. Ordering is by player id so a board built from
 * this is reproducible run to run — the same requirement rank correlation puts on every read in the
 * engine, since tie ordering moves the number.
 */
export async function preseasonRostersAsOf(
  db: ReadonlyDb,
  { season, asOf }: { readonly season: number; readonly asOf: Date },
): Promise<readonly PreseasonRosterRow[]> {
  const rows = await db
    .selectDistinctOn([preseasonRosters.playerId], {
      season: preseasonRosters.season,
      team: preseasonRosters.team,
      playerId: preseasonRosters.playerId,
      position: preseasonRosters.position,
      status: preseasonRosters.status,
      birthDate: preseasonRosters.birthDate,
      draftYear: preseasonRosters.draftYear,
      draftPick: preseasonRosters.draftPick,
      draftClub: preseasonRosters.draftClub,
      asOf: preseasonRosters.asOf,
    })
    .from(preseasonRosters)
    .where(and(eq(preseasonRosters.season, season), lte(preseasonRosters.asOf, asOf)))
    .orderBy(asc(preseasonRosters.playerId), desc(preseasonRosters.asOf));
  return rows.map((row) => ({ ...row, status: row.status as RosterStatus }));
}

/**
 * A player's FIRST season with a stamped week-one roster row, through a given season.
 *
 * `MIN(season)` grouped by player, bounded by `throughSeason` rather than read open-ended: a career
 * fact used to predict `throughSeason` may not be built from a roster row that postdates it, the
 * same discipline every other point-in-time read in this engine keeps, even though a debut season is
 * itself immutable once it happens (unlike a corrected stat line, there is no "later, truer" first
 * roster year to prefer, so there is no `asOf` gate here — only the season bound).
 *
 * NOT the player's true NFL debut. `preseason-rosters.ts`'s backfill floor is `HISTORICAL_ROSTER_FLOOR`
 * (2003 since fit-round Task 1, 2013 before it); a veteran who debuted earlier has no row before it,
 * so his "first" season here is really "first season this table can see him in". Callers that turn
 * this into a career-year band (see `model/efficiency.ts`'s `experienceCohort`) have to treat a first
 * season AT the floor as censored rather than as a literal rookie year. The floor moving does not
 * change that rule; it changes how many players it catches, and every season above the floor becomes
 * a measurement rather than a lower bound.
 */
export async function firstRosterSeasonsThrough(db: ReadonlyDb, throughSeason: number): Promise<ReadonlyMap<string, number>> {
  const rows = await db
    .select({ playerId: preseasonRosters.playerId, firstSeason: min(preseasonRosters.season) })
    .from(preseasonRosters)
    .where(lte(preseasonRosters.season, throughSeason))
    .groupBy(preseasonRosters.playerId);
  return new Map(rows.filter((row) => row.firstSeason !== null).map((row) => [row.playerId, row.firstSeason!] as const));
}

/**
 * One source's opinion of a named handful of players, for a surface that draws one man.
 *
 * The same gate and the same `DISTINCT ON` as the whole-board read; only the `IN` list differs. A
 * player the source never ranked is ABSENT FROM THE RESULT rather than present with a zero, so the
 * caller has one thing to check and one thing to print for it.
 */
export async function preseasonRankingsFor(
  db: ReadonlyDb,
  { season, source, asOf }: { readonly season: number; readonly source: string; readonly asOf: Date },
  playerIds: readonly string[],
): Promise<readonly PreseasonRankingRow[]> {
  if (playerIds.length === 0) return [];
  return db
    .selectDistinctOn([preseasonRankings.playerId], {
      season: preseasonRankings.season,
      source: preseasonRankings.source,
      playerId: preseasonRankings.playerId,
      rank: preseasonRankings.rank,
      asOf: preseasonRankings.asOf,
    })
    .from(preseasonRankings)
    .where(
      and(
        eq(preseasonRankings.season, season),
        eq(preseasonRankings.source, source),
        lte(preseasonRankings.asOf, asOf),
        inArray(preseasonRankings.playerId, [...playerIds]),
      ),
    )
    .orderBy(asc(preseasonRankings.playerId), desc(preseasonRankings.asOf));
}

/** One source's whole published board for a season, as it was knowable at `asOf`. */
export async function preseasonRankingsAsOf(
  db: ReadonlyDb,
  { season, source, asOf }: { readonly season: number; readonly source: string; readonly asOf: Date },
): Promise<readonly PreseasonRankingRow[]> {
  const rows = await db
    .selectDistinctOn([preseasonRankings.playerId], {
      season: preseasonRankings.season,
      source: preseasonRankings.source,
      playerId: preseasonRankings.playerId,
      rank: preseasonRankings.rank,
      asOf: preseasonRankings.asOf,
    })
    .from(preseasonRankings)
    .where(
      and(
        eq(preseasonRankings.season, season),
        eq(preseasonRankings.source, source),
        lte(preseasonRankings.asOf, asOf),
      ),
    )
    .orderBy(asc(preseasonRankings.playerId), desc(preseasonRankings.asOf));
  return rows;
}
