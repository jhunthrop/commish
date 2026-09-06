import { and, asc, eq, inArray } from "drizzle-orm";
import type { Db, ReadonlyDb } from "@/db/client";
import { nflPlayers, nflverseKickingWeeks } from "@/db/schema";
import { changedRowWhere, excludedSetFor } from "@/db/upsert";
import type { NflverseClient } from "./client";
import { NFLVERSE_CONFIG } from "./config";
import type { CsvRow } from "./csv";

/**
 * THE HISTORICAL KICKING RECORD, ARCHIVED VERBATIM — one row per (season, week, gsis id).
 *
 * VERIFIED AGAINST THE LIVE RELEASE (2026-09-05), NOT ASSUMED. The asset family is `stats_player`,
 * one file per season, `stats_player_week_<season>.csv`. The 2013 header and the 2024 header were
 * both fetched directly and both carry every column in `REQUIRED_COLUMNS` below, so there is no
 * schema drift across the span this module ingests.
 *
 * A DELIBERATELY DIFFERENT SLICE OF A FILE THIS ADAPTER ALREADY READS — the same split
 * `roster-weeks.ts` describes against `preseason/rosters.ts`. `map.ts` reads the skill-position
 * columns of this same family and gates its rows through `isProjectedCandidate`, which narrowed to
 * QB, RB, WR and TE and has therefore never emitted a single kicker row. This module reads the
 * KICKING columns of the same file, for the rows the other one drops. The two never write the same
 * table and never disagree, because they do not overlap at all.
 *
 * KICKERS ARE `position == "K"`, THE FILE'S OWN SPELLING, AND THAT IS NOT THE SECOND-OPINION DEFECT
 * `players.ts` RETIRED. That defect was two DIFFERENT vocabularies narrowing the same population
 * twice, where the file's ran first and silently won wherever they disagreed. There is one
 * narrowing here and no universe position competing with it: a kicking line belongs to whoever
 * kicked, and every kicking row in the real files carries `K`. A row with kicking numbers under any
 * other spelling is a position player who attempted a field goal in a blowout, which is not a
 * fantasy kicker and is correctly dropped.
 */

/** One kicker's one week, exactly as the release published it. */
export interface KickingWeekRow {
  readonly season: number;
  readonly week: number;
  /** The gsis id, matching `nfl_players.id`. */
  readonly playerId: string;
  /** nflverse's own team code, unmapped. `team-codes.ts` translates on read. */
  readonly team: string;
  readonly fieldGoalsMade: number;
  readonly fieldGoalsAttempted: number;
  readonly fieldGoalsMissed: number;
  readonly fieldGoalsBlocked: number;
  readonly fieldGoalsMade0To19: number;
  readonly fieldGoalsMade20To29: number;
  readonly fieldGoalsMade30To39: number;
  readonly fieldGoalsMade40To49: number;
  readonly fieldGoalsMade50To59: number;
  readonly fieldGoalsMade60Plus: number;
  readonly fieldGoalsMissed0To19: number;
  readonly fieldGoalsMissed20To29: number;
  readonly fieldGoalsMissed30To39: number;
  readonly fieldGoalsMissed40To49: number;
  readonly fieldGoalsMissed50To59: number;
  readonly fieldGoalsMissed60Plus: number;
  readonly extraPointsMade: number;
  readonly extraPointsAttempted: number;
  readonly extraPointsMissed: number;
  readonly extraPointsBlocked: number;
}

/** Every numeric field this module reads, against the file's own column name for it. ONE table, so
 *  the allowlist, the parse and the shape assertion can never drift apart. */
const NUMERIC_COLUMNS: Readonly<
  Record<keyof Omit<KickingWeekRow, "season" | "week" | "playerId" | "team">, string>
> = {
  fieldGoalsMade: "fg_made",
  fieldGoalsAttempted: "fg_att",
  fieldGoalsMissed: "fg_missed",
  fieldGoalsBlocked: "fg_blocked",
  fieldGoalsMade0To19: "fg_made_0_19",
  fieldGoalsMade20To29: "fg_made_20_29",
  fieldGoalsMade30To39: "fg_made_30_39",
  fieldGoalsMade40To49: "fg_made_40_49",
  fieldGoalsMade50To59: "fg_made_50_59",
  fieldGoalsMade60Plus: "fg_made_60_",
  fieldGoalsMissed0To19: "fg_missed_0_19",
  fieldGoalsMissed20To29: "fg_missed_20_29",
  fieldGoalsMissed30To39: "fg_missed_30_39",
  fieldGoalsMissed40To49: "fg_missed_40_49",
  fieldGoalsMissed50To59: "fg_missed_50_59",
  fieldGoalsMissed60Plus: "fg_missed_60_",
  extraPointsMade: "pat_made",
  extraPointsAttempted: "pat_att",
  extraPointsMissed: "pat_missed",
  extraPointsBlocked: "pat_blocked",
};

/** The position spelling a fantasy kicker carries in this release, in every row of every file
 *  checked (2013 and 2024, fetched directly). */
const KICKER_POSITION = "K";

/**
 * Every column this module reads, checked against the file's own header before a single row is
 * mapped — the identical discipline `roster-weeks.ts` applies, for the identical reason. A column
 * silently missing would read as `undefined`, coarsen to 0, and produce a kicker who never attempted
 * a field goal out of a season in which he attempted thirty. That is indistinguishable from a real
 * backup, so it would never be caught by looking at the output.
 *
 * Extra columns the release carries (there are over a hundred) are ignored outright: this table is
 * not a box score, so a new upstream column appearing is never a reason to refuse a file.
 */
const REQUIRED_COLUMNS: readonly string[] = [
  "player_id",
  "position",
  "season",
  "week",
  "season_type",
  "team",
  ...Object.values(NUMERIC_COLUMNS),
];

function assertShape(rows: readonly CsvRow[]): void {
  if (rows.length === 0) return;
  const columns = new Set(Object.keys(rows[0]!));
  const missing = REQUIRED_COLUMNS.filter((column) => !columns.has(column));
  if (missing.length > 0) {
    throw new Error(
      `nflverse stats_player file is missing column(s) ${missing.join(", ")}. The published schema changed; ` +
        `mapping this file anyway would read every missing column as zero and produce a kicker who never kicked.`,
    );
  }
}

function trimmed(raw: string | undefined): string {
  return (raw ?? "").trim();
}

/**
 * One counting cell. An EMPTY cell is 0, which is what the release means by it: every kicking cell
 * on a non-kicker's row is empty or zero. Anything else that is not a finite number THROWS, because
 * a count this module cannot read is a count it must not guess at.
 */
function count(row: CsvRow, column: string): number {
  const raw = trimmed(row[column]);
  if (raw === "") return 0;
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new Error(`nflverse stats_player row has an unreadable ${column} (${JSON.stringify(row[column])}).`);
  }
  return value;
}

/**
 * Reads one season's `stats_player_week_YYYY.csv` into one row per (season, week, gsis id), kickers
 * only, regular season only.
 *
 * A row with no gsis id is DROPPED rather than thrown on, the same choice every other mapper in this
 * adapter makes: a weekly file legitimately carries camp bodies the NFL has never issued an id to,
 * and refusing the whole file over one of them would make the ingestion hostage to a man nobody
 * projects. A row with no readable SEASON or WEEK throws, because that is a schema change and not a
 * fringe player.
 *
 * LAST ROW WINS for a duplicate key, built as a `Map`, matching `mapRosterWeekRows`'s tie-break.
 */
export function mapKickingWeekRows(rows: readonly CsvRow[]): readonly KickingWeekRow[] {
  assertShape(rows);
  const byKey = new Map<string, KickingWeekRow>();
  for (const row of rows) {
    if (trimmed(row.season_type) !== NFLVERSE_CONFIG.seasonType) continue;
    if (trimmed(row.position) !== KICKER_POSITION) continue;
    const playerId = trimmed(row.player_id);
    if (playerId === "") continue;

    const seasonText = trimmed(row.season);
    const weekText = trimmed(row.week);
    const season = Number(seasonText);
    const week = Number(weekText);
    if (seasonText === "" || weekText === "" || !Number.isInteger(season) || !Number.isInteger(week)) {
      throw new Error(
        `nflverse stats_player row has no readable season/week (got ${JSON.stringify(row.season)}/${JSON.stringify(row.week)}).`,
      );
    }
    const team = trimmed(row.team);
    if (team === "") continue;

    const numbers = Object.fromEntries(
      Object.entries(NUMERIC_COLUMNS).map(([field, column]) => [field, count(row, column)]),
    ) as Omit<KickingWeekRow, "season" | "week" | "playerId" | "team">;
    byKey.set(`${season}|${week}|${playerId}`, { season, week, playerId, team, ...numbers });
  }
  return [...byKey.values()].sort(
    (a, b) => a.season - b.season || a.week - b.week || a.playerId.localeCompare(b.playerId),
  );
}

/** Postgres's bound-parameter ceiling, with room for this table's twenty four columns. */
const INSERT_CHUNK_ROWS = 1_000;

/** The natural key, plus `ingestedAt`, which names when a row was FIRST written and must never be
 *  overwritten by a re-ingestion. What `excludedSetFor`/`changedRowWhere` key off. */
const NATURAL_KEYS: readonly string[] = ["season", "week", "playerId", "ingestedAt"];

/** Provenance tag for every row this module writes. */
export const KICKING_WEEK_SOURCE = "nflverse_kicking_weeks";

/**
 * Writes kicking rows, UPSERTING on the natural key rather than `onConflictDoNothing` — matching
 * `recordRosterWeekRows`'s choice and for the same reason: nflverse republishes a corrected week,
 * and `onConflictDoNothing` would freeze whichever version an operator's backfill happened to run
 * first. `changedRowWhere` keeps a re-run over unchanged rows a true no-op, so re-ingesting a landed
 * season still reports 0 written.
 */
export async function recordKickingWeekRows(db: Db, rows: readonly KickingWeekRow[]): Promise<number> {
  let written = 0;
  for (let start = 0; start < rows.length; start += INSERT_CHUNK_ROWS) {
    const chunk = rows.slice(start, start + INSERT_CHUNK_ROWS).map((row) => ({ ...row, source: KICKING_WEEK_SOURCE }));
    const result = await db
      .insert(nflverseKickingWeeks)
      .values(chunk)
      .onConflictDoUpdate({
        target: [nflverseKickingWeeks.season, nflverseKickingWeeks.week, nflverseKickingWeeks.playerId],
        set: excludedSetFor(nflverseKickingWeeks, NATURAL_KEYS),
        where: changedRowWhere(nflverseKickingWeeks, NATURAL_KEYS),
      })
      .returning({ season: nflverseKickingWeeks.season });
    written += result.length;
  }
  return written;
}

/** Every id `nfl_players` holds — read once per ingestion call, matching `ingestRosterWeeks`. */
async function knownPlayerIds(db: ReadonlyDb): Promise<ReadonlySet<string>> {
  const rows = await db.select({ id: nflPlayers.id }).from(nflPlayers);
  return new Set(rows.map((row) => row.id));
}

/** What one season's kicking ingestion reports about itself. */
export interface KickingWeekIngestReport {
  readonly season: number;
  /** Every row the file carried, before any filter. */
  readonly rowsRead: number;
  /** Rows that were a kicker's regular-season week. */
  readonly kickerRows: number;
  /** How many rows were ACTUALLY written or changed. A re-run of a landed season reports 0. */
  readonly written: number;
  /** Kickers the historical universe does not hold — reported, never silently lost. */
  readonly unknownToUniverse: number;
}

/**
 * Fetches and archives one or more seasons of the kicking record.
 *
 * Filtered to the ids `nfl_players` already holds, because `nflverse_kicking_weeks.player_id` is a
 * foreign key — the same guard `ingestRosterWeeks` applies. The universe is fetched ONCE for the
 * whole call, not once per season.
 */
export async function ingestKickingWeeks(
  db: Db,
  client: NflverseClient,
  seasons: readonly number[],
): Promise<readonly KickingWeekIngestReport[]> {
  const known = await knownPlayerIds(db);
  const reports: KickingWeekIngestReport[] = [];
  for (const season of seasons) {
    const rows = await client.getCsv(NFLVERSE_CONFIG.releases.statsPlayer, `stats_player_week_${season}.csv`);
    const mapped = mapKickingWeekRows(rows);
    const insertable = mapped.filter((row) => known.has(row.playerId));
    const written = await recordKickingWeekRows(db, insertable);
    reports.push({
      season,
      rowsRead: rows.length,
      kickerRows: mapped.length,
      written,
      unknownToUniverse: mapped.length - insertable.length,
    });
  }
  return reports;
}

/** The column selection every read below shares, so a rename fails in one place. */
const SELECTION = {
  season: nflverseKickingWeeks.season,
  week: nflverseKickingWeeks.week,
  playerId: nflverseKickingWeeks.playerId,
  team: nflverseKickingWeeks.team,
  fieldGoalsMade: nflverseKickingWeeks.fieldGoalsMade,
  fieldGoalsAttempted: nflverseKickingWeeks.fieldGoalsAttempted,
  fieldGoalsMissed: nflverseKickingWeeks.fieldGoalsMissed,
  fieldGoalsBlocked: nflverseKickingWeeks.fieldGoalsBlocked,
  fieldGoalsMade0To19: nflverseKickingWeeks.fieldGoalsMade0To19,
  fieldGoalsMade20To29: nflverseKickingWeeks.fieldGoalsMade20To29,
  fieldGoalsMade30To39: nflverseKickingWeeks.fieldGoalsMade30To39,
  fieldGoalsMade40To49: nflverseKickingWeeks.fieldGoalsMade40To49,
  fieldGoalsMade50To59: nflverseKickingWeeks.fieldGoalsMade50To59,
  fieldGoalsMade60Plus: nflverseKickingWeeks.fieldGoalsMade60Plus,
  fieldGoalsMissed0To19: nflverseKickingWeeks.fieldGoalsMissed0To19,
  fieldGoalsMissed20To29: nflverseKickingWeeks.fieldGoalsMissed20To29,
  fieldGoalsMissed30To39: nflverseKickingWeeks.fieldGoalsMissed30To39,
  fieldGoalsMissed40To49: nflverseKickingWeeks.fieldGoalsMissed40To49,
  fieldGoalsMissed50To59: nflverseKickingWeeks.fieldGoalsMissed50To59,
  fieldGoalsMissed60Plus: nflverseKickingWeeks.fieldGoalsMissed60Plus,
  extraPointsMade: nflverseKickingWeeks.extraPointsMade,
  extraPointsAttempted: nflverseKickingWeeks.extraPointsAttempted,
  extraPointsMissed: nflverseKickingWeeks.extraPointsMissed,
  extraPointsBlocked: nflverseKickingWeeks.extraPointsBlocked,
} as const;

/**
 * Every archived kicking week for one kicker across the given seasons, in season and week order.
 *
 * No `as_of` gate, matching `rosterWeekRowsFor`: this is a retrospective archive of completed
 * seasons, and the point-in-time discipline lives in the caller that decides WHICH SEASONS a board
 * for a given season is entitled to read.
 */
export async function kickingWeekRowsFor(
  db: ReadonlyDb,
  playerId: string,
  seasons: readonly number[],
): Promise<readonly KickingWeekRow[]> {
  if (seasons.length === 0) return [];
  return db
    .select(SELECTION)
    .from(nflverseKickingWeeks)
    .where(and(eq(nflverseKickingWeeks.playerId, playerId), inArray(nflverseKickingWeeks.season, [...seasons])))
    .orderBy(asc(nflverseKickingWeeks.season), asc(nflverseKickingWeeks.week));
}

/** Every archived kicking week in the given seasons, for every kicker. The component fit's own read
 *  and the read a candidate builder takes a whole club's kicking volume from. */
export async function kickingWeekRowsForSeasons(
  db: ReadonlyDb,
  seasons: readonly number[],
): Promise<readonly KickingWeekRow[]> {
  if (seasons.length === 0) return [];
  return db
    .select(SELECTION)
    .from(nflverseKickingWeeks)
    .where(inArray(nflverseKickingWeeks.season, [...seasons]))
    .orderBy(asc(nflverseKickingWeeks.season), asc(nflverseKickingWeeks.week), asc(nflverseKickingWeeks.playerId));
}
