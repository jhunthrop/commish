import { asc, and, eq } from "drizzle-orm";
import type { Db, ReadonlyDb } from "@research-ts/db/client";
import { nflverseRosterWeeks, nflPlayers } from "@research-ts/db/schema";
import { changedRowWhere, excludedSetFor } from "@research-ts/db/upsert";
import { NFLVERSE_CONFIG } from "./config";
import type { NflverseClient } from "./client";
import type { CsvRow } from "./csv";

/**
 * THE OFFICIAL WEEKLY ROSTER STATUS, ARCHIVED VERBATIM — one row per (season, week, gsis_id),
 * feeding `availability/season-end.ts`'s status-based derivation for exactly the case the weekly
 * INJURY report cannot answer: a player placed on injured reserve and never mentioned on a report
 * again.
 *
 * VERIFIED AGAINST THE LIVE RELEASE (2026-09-05), NOT ASSUMED. The asset family is
 * `weekly_rosters` (nflverse-data releases), one file per season, `roster_weekly_<season>.csv`
 * — confirmed by fetching `roster_weekly_2024.csv` and `roster_weekly_2025.csv` directly. Both
 * files carry the SAME header, no schema drift across the two seasons checked:
 *   season, team, position, depth_chart_position, jersey_number, status, full_name, first_name,
 *   last_name, birth_date, height, weight, college, gsis_id, espn_id, sportradar_id, yahoo_id,
 *   rotowire_id, pff_id, pfr_id, fantasy_data_id, sleeper_id, years_exp, headshot_url,
 *   ngs_position, week, game_type, status_description_abbr, football_name, esb_id, gsis_it_id,
 *   smart_id, entry_year, rookie_year, draft_club, draft_number.
 * This module reads only `season`, `week`, `game_type`, `team`, `gsis_id`, `position`, `status` —
 * see `REQUIRED_COLUMNS`. `preseason/rosters.ts`'s `ROSTER_SOURCE_CONFIG` already names this same
 * release/file pattern for week 1; this module reads every week rather than only the first.
 *
 * `status` VOCABULARY OBSERVED (every row, both files checked): `ACT`, `INA`, `RES`, `DEV`, `CUT`,
 * `RET`, `EXE`, `TRC`, `TRD`, and a single stray `E01` (2024, one row) — see `schema.ts`'s
 * `nflverseRosterWeeks` docblock, which carries the same list, and `preseason/rosters.ts`'s
 * `rosterStatusOf` for the WEEK-1-ONLY coarsening this module deliberately does not apply.
 *
 * A SECOND, DELIBERATELY DIFFERENT READ OF A RELEASE `preseason/rosters.ts` ALREADY INGESTS — the
 * identical split `injuries.ts` describes against `news/retrieve.ts`. `preseason/rosters.ts` keeps
 * only week 1, coarsened to four buckets, because a preseason board can only ever see the cutdown.
 * This table keeps EVERY week, verbatim, because a season-ending derivation needs to see the
 * transition itself (week 4 `ACT` -> week 5 `RES`), which a week-1 snapshot can never show.
 */

/** One player's one week of roster status, exactly as the release published it. */
export interface RosterWeekRow {
  readonly season: number;
  readonly week: number;
  /** The gsis id, matching `nfl_players.id`. */
  readonly playerId: string;
  /** The club this week's row lists him with. nflverse's own team code, unmapped. */
  readonly team: string;
  /** The league's own roster-status code, verbatim ("ACT", "RES", "INA", "CUT", "DEV", …). */
  readonly status: string;
  /** The release's `status_description_abbr`, verbatim ("R01", "R40", "A01", …), `""` where blank.
   *  The reserve-list detail the coarse code lost from 2021 on: see `schema.ts`'s
   *  `nflverseRosterWeeks.statusDetail` for the measured vocabulary and why it is archived. */
  readonly statusDetail: string;
  /** nflverse's own spelling, unnarrowed, exactly as `nfl_players.position` is. */
  readonly position: string;
}

/**
 * Every column this module reads. Checked against the file's own header before a single row is
 * mapped — not merely relied upon by later `row[column]` lookups reading `undefined` — because a
 * column silently missing would otherwise coarsen every row on that column to "" or drop it, and
 * read exactly like a healthy, fully-active league: the failure this table exists to make
 * impossible for a RESERVE placement, repeated for the columns that GET it there.
 *
 * Extra columns the release carries (`birth_date`, `draft_number`, `headshot_url`, …) are ignored
 * outright, matching `mapWeek1Rosters`'s own tolerance: this table is not a biography snapshot, so
 * a new upstream column appearing is never a reason to refuse a file this module can otherwise
 * read in full.
 *
 * `status_description_abbr` IS REQUIRED, not tolerated (founder report 2026-09-08): every file
 * 2013-2025 carries it, and from 2021 it is the only column that tells a suspension from injured
 * reserve. A file without it would archive every suspended week as an injury week, silently.
 */
const REQUIRED_COLUMNS: readonly string[] = ["season", "week", "game_type", "team", "gsis_id", "position", "status", "status_description_abbr"];

function assertShape(rows: readonly CsvRow[]): void {
  if (rows.length === 0) return;
  const columns = new Set(Object.keys(rows[0]!));
  const missing = REQUIRED_COLUMNS.filter((column) => !columns.has(column));
  if (missing.length > 0) {
    throw new Error(
      `nflverse weekly_rosters file is missing column(s) ${missing.join(", ")}. The published schema changed; ` +
        `mapping this file anyway would silently coarsen every row on the missing column rather than refusing.`,
    );
  }
}

function trimmed(raw: string | undefined): string {
  return (raw ?? "").trim();
}

/**
 * Reads one season's `roster_weekly_YYYY.csv` into one row per (season, week, gsis_id).
 *
 * NARROWED TO THE REGULAR SEASON, matching `NFLVERSE_CONFIG.seasonType` — the same scope every
 * other ingester in this adapter keeps, because this product does not score anything else.
 *
 * Rows without a gsis id are DROPPED rather than thrown on, the same choice `mapWeek1Rosters` and
 * `mapDraftPicks` make and for the identical reason: a weekly roster legitimately carries
 * practice-squad bodies and camp arms the NFL has never issued an id to, and refusing the whole
 * file over one of them would make the ingestion hostage to the thirtieth man on a roster nobody
 * projects.
 *
 * LAST ROW WINS for a duplicate (season, week, gsis_id) key — built as a `Map`, matching
 * `mapWeek1Rosters`'s own tie-break for a player claimed off waivers mid-week. Measured against
 * the real 2024 and 2025 files, every duplicate key with a REAL gsis_id was in fact unique; the
 * only collisions found were rows with a blank id, which are dropped before the key is ever built.
 * The tie-break exists so a genuine future case (a mid-week trade producing two team rows in one
 * week) degrades to "keeps the later listing" rather than throwing on a row this module has no
 * principled way to prefer between.
 */
export function mapRosterWeekRows(rows: readonly CsvRow[]): readonly RosterWeekRow[] {
  assertShape(rows);
  const byKey = new Map<string, RosterWeekRow>();
  for (const row of rows) {
    if (row.game_type !== NFLVERSE_CONFIG.seasonType) continue;
    const playerId = trimmed(row.gsis_id);
    if (playerId === "") continue;

    const seasonText = trimmed(row.season);
    const weekText = trimmed(row.week);
    const season = Number(seasonText);
    const week = Number(weekText);
    if (seasonText === "" || weekText === "" || !Number.isInteger(season) || !Number.isInteger(week)) {
      throw new Error(`nflverse weekly_rosters row has no readable season/week (got ${JSON.stringify(row.season)}/${JSON.stringify(row.week)}).`);
    }

    const team = trimmed(row.team);
    const position = trimmed(row.position);
    const status = trimmed(row.status);
    if (team === "" || position === "" || status === "") continue;

    const key = `${season}|${week}|${playerId}`;
    byKey.set(key, { season, week, playerId, team, status, statusDetail: trimmed(row.status_description_abbr), position });
  }
  return [...byKey.values()].sort((a, b) => a.season - b.season || a.week - b.week || a.playerId.localeCompare(b.playerId));
}

/** Postgres's bound-parameter ceiling, matching `injuries.ts`'s own `INSERT_CHUNK_ROWS`. */
const INSERT_CHUNK_ROWS = 2_000;

/** `nflverseRosterWeeks`'s natural key, as JS property names — what `excludedSetFor`/
 *  `changedRowWhere` (`@research-ts/db/upsert`) key off. `ingestedAt` rides along as an excluded key too: it
 *  names when a row was FIRST written, and a re-ingestion must never let it be overwritten. */
const NATURAL_KEYS: readonly string[] = ["season", "week", "playerId", "ingestedAt"];

/** Provenance tag for every row this module writes. */
export const ROSTER_WEEK_SOURCE = "nflverse_roster_weeks";

/**
 * Writes roster-week rows, UPSERTING on the natural key rather than `onConflictDoNothing` —
 * matching `recordInjuryRows`'s choice and for the same reason: nflverse occasionally republishes
 * a past week's file with a corrected status, and `onConflictDoNothing` would freeze whichever
 * version an operator's backfill happened to run first. `changedRowWhere` keeps a re-run with an
 * UNCHANGED row a true no-op, so re-ingesting an already-current season still reports 0 written.
 *
 * Returns how many rows were ACTUALLY new-or-changed, the same contract every writer in this
 * engine keeps.
 */
export async function recordRosterWeekRows(db: Db, rows: readonly RosterWeekRow[]): Promise<number> {
  let written = 0;
  for (let start = 0; start < rows.length; start += INSERT_CHUNK_ROWS) {
    const chunk = rows.slice(start, start + INSERT_CHUNK_ROWS).map((row) => ({ ...row, source: ROSTER_WEEK_SOURCE }));
    const result = await db
      .insert(nflverseRosterWeeks)
      .values(chunk)
      .onConflictDoUpdate({
        target: [nflverseRosterWeeks.season, nflverseRosterWeeks.week, nflverseRosterWeeks.playerId],
        set: excludedSetFor(nflverseRosterWeeks, NATURAL_KEYS),
        where: changedRowWhere(nflverseRosterWeeks, NATURAL_KEYS),
      })
      .returning({ season: nflverseRosterWeeks.season });
    written += result.length;
  }
  return written;
}

/** Every id `nfl_players` holds — read once per ingestion call, matching `injuries.ts`'s own
 *  `knownPlayerIds`, which this duplicates in miniature rather than sharing (each caller's shape
 *  has stayed a two-line function not worth a shared module). */
async function knownPlayerIds(db: ReadonlyDb): Promise<ReadonlySet<string>> {
  const rows = await db.select({ id: nflPlayers.id }).from(nflPlayers);
  return new Set(rows.map((row) => row.id));
}

/** What one season's roster-week ingestion reports about itself. */
export interface RosterWeekIngestReport {
  readonly season: number;
  /** Rows the release carried for the regular season, before the universe was consulted. */
  readonly rowsRead: number;
  /** How many rows were ACTUALLY written or changed. A re-run of a landed season reports 0. */
  readonly written: number;
  /** Rows dropped because the gsis id is not in `nfl_players` — reported, never silently lost. */
  readonly unknownToUniverse: number;
}

/**
 * Fetches and archives one or more seasons of the weekly roster-status release.
 *
 * Filtered to the ids `nfl_players` already holds, because `nflverse_roster_weeks.player_id` is a
 * foreign key — the same guard `ingestInjuries` applies for the identical reason. The universe is
 * fetched ONCE for the whole call, not once per season, matching every other multi-season ingester
 * in this adapter.
 */
export async function ingestRosterWeeks(db: Db, client: NflverseClient, seasons: readonly number[]): Promise<readonly RosterWeekIngestReport[]> {
  const known = await knownPlayerIds(db);
  const reports: RosterWeekIngestReport[] = [];
  for (const season of seasons) {
    const rows = await client.getCsv(NFLVERSE_CONFIG.releases.weeklyRosters, `roster_weekly_${season}.csv`);
    const mapped = mapRosterWeekRows(rows);
    const insertable = mapped.filter((row) => known.has(row.playerId));
    const written = await recordRosterWeekRows(db, insertable);
    reports.push({ season, rowsRead: rows.length, written, unknownToUniverse: mapped.length - insertable.length });
  }
  return reports;
}

/**
 * Every archived roster-week row for one player, one season, in week order — the read
 * `availability/season-end.ts`'s status-based derivation builds its input from.
 *
 * No `as_of` gate: like `injuryRowsFor`, nothing reads this table through the point-in-time
 * discipline (a season-ending absence is a retrospective claim about a season already over, not a
 * live projection input), so the plain historical read is the honest one.
 */
export async function rosterWeekRowsFor(db: ReadonlyDb, playerId: string, season: number): Promise<readonly RosterWeekRow[]> {
  const rows = await db
    .select({
      season: nflverseRosterWeeks.season,
      week: nflverseRosterWeeks.week,
      playerId: nflverseRosterWeeks.playerId,
      team: nflverseRosterWeeks.team,
      status: nflverseRosterWeeks.status,
      statusDetail: nflverseRosterWeeks.statusDetail,
      position: nflverseRosterWeeks.position,
    })
    .from(nflverseRosterWeeks)
    .where(and(eq(nflverseRosterWeeks.playerId, playerId), eq(nflverseRosterWeeks.season, season)))
    .orderBy(asc(nflverseRosterWeeks.week));
  return rows;
}
