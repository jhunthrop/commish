import { and, asc, inArray } from "drizzle-orm";
import type { Db, ReadonlyDb } from "@research-ts/db/client";
import { nflverseTeamDefenseWeeks } from "@research-ts/db/schema";
import { changedRowWhere, excludedSetFor } from "@research-ts/db/upsert";
import type { NflverseClient } from "./client";
import { NFLVERSE_CONFIG } from "./config";
import type { CsvRow } from "./csv";
import { mapSchedule, SCHEDULE_SOURCE_CONFIG, type TeamGame } from "./schedule";
import { teamWeekKey } from "./team-codes";

/**
 * THE HISTORICAL TEAM-DEFENSE RECORD, ARCHIVED IN THE DEFENSE'S OWN FRAME.
 *
 * VERIFIED AGAINST THE LIVE RELEASE (2026-09-05), NOT ASSUMED. The asset family is `stats_team`,
 * one file per season, `stats_team_week_<season>.csv`. The 2013 and 2024 headers were both fetched
 * directly and both carry every column in `REQUIRED_COLUMNS` below.
 *
 * THE ONE TRANSFORMATION THIS MODULE MAKES, AND WHY IT MAKES IT AT INGEST. A row's `passing_yards`
 * and `rushing_yards` in the published file are that team's OWN offense. A fantasy defense is scored
 * on the yards it ALLOWED, which is the other row of the same game. Joining the pair here, once, and
 * storing the result under names that say whose yards they are is what stops a later reader from
 * having to know the join exists. A reader who got it backwards would produce a defense graded on
 * how good its own offense was, and nothing downstream would look wrong.
 *
 * AN UNPAIRED ROW IS DROPPED AND COUNTED, NEVER ZEROED. A game with only one team's row in the file
 * cannot say what that team allowed, and writing 0 would be a shutout this module invented — the
 * single most valuable fabricated number on a defense board, and therefore the one that must be
 * impossible. Measured against the real 2013 through 2025 files every regular-season row pairs; the
 * branch exists so a future partial file degrades to a MISSING row rather than to a flattering one.
 *
 * POINTS ALLOWED NOW RIDES ON THE ROW, NULLABLE (migration 0079). It used to be left out on the
 * argument that `schedule.ts` already stores every game's score as team observations, so a second
 * copy would be a second number that can disagree with the first. That argument holds for the FIT
 * path, which still reads the observation store and is untouched here. It does not hold for a
 * product surface: the observation store carries only the season in play, so a finished season's
 * defense weeks join to nothing there and a team defense's whole history stops at the database
 * boundary. Both copies are filled from the same `games.csv`, through `pointsAllowedByTeamWeek`
 * below, so they have one origin rather than two opinions — and a week the schedule has no
 * scoreline for is written NULL, never zero, because a shutout this module invented is the single
 * most flattering fabricated number a defense row can carry.
 */

/** One club's one defensive week, in the frame a fantasy defense is scored in. */
export interface TeamDefenseWeekRow {
  readonly season: number;
  readonly week: number;
  /** nflverse's own team code, unmapped and contemporary to the season. */
  readonly team: string;
  readonly opponentTeam: string;
  /** Not an integer: a shared sack is credited as a half in the published file. */
  readonly sacks: number;
  readonly interceptions: number;
  readonly fumbleRecoveries: number;
  readonly defensiveTouchdowns: number;
  readonly safeties: number;
  readonly puntBlocks: number;
  readonly extraPointBlocks: number;
  readonly fieldGoalBlocks: number;
  readonly specialTeamsTouchdowns: number;
  /** THE OPPONENT's passing yards in this game. See the module docblock. */
  readonly passingYardsAllowed: number;
  /** THE OPPONENT's rushing yards in this game. */
  readonly rushingYardsAllowed: number;
  /** THE OPPONENT's yards lost to sacks in this game, the term that nets `passingYardsAllowed`
   *  the way a box score does. `null` only on a row written before the column existed. */
  readonly sackYardsLostAllowed: number | null;
  /** THE OPPONENT's final score, from the schedule file, or `null` when it carried no scoreline
   *  for this pairing. Never 0 for an unknown game — see the module docblock. */
  readonly pointsAllowed: number | null;
}

/**
 * The key both sides of the points-allowed join are folded onto: season, week, and the club in the
 * PRODUCT's spelling.
 *
 * The product's spelling and not either feed's, because the two feeds disagree with each other and
 * with themselves. `stats_team` normalises a club to its current code in every row (a 2014 Rams row
 * reads `LA`), while `games.csv` keeps the contemporary one (`STL` for the same game). Folding both
 * through `productTeamCode` is what makes a relocated franchise's season join at all, instead of
 * silently missing every one of its weeks.
 */
/** Re-exported for the tests and callers that learned the key here first. */
export { teamWeekKey };

/**
 * Every team-week's points allowed, from the schedule file's own rows, keyed by `teamWeekKey`.
 *
 * A game with no scoreline yet contributes NO ENTRY rather than an entry of zero, so an unplayed or
 * unpublished game is distinguishable from a shutout at every later step.
 */
export function pointsAllowedByTeamWeek(games: readonly TeamGame[]): ReadonlyMap<string, number> {
  const byKey = new Map<string, number>();
  for (const game of games) {
    if (game.pointsAgainst === null) continue;
    byKey.set(teamWeekKey(game.season, game.week, game.team), game.pointsAgainst);
  }
  return byKey;
}

/** The fields read off the DEFENSE's own row, against the file's own column name for each. */
const OWN_COLUMNS = {
  sacks: "def_sacks",
  interceptions: "def_interceptions",
  fumbleRecoveries: "fumble_recovery_opp",
  defensiveTouchdowns: "def_tds",
  safeties: "def_safeties",
  puntBlocks: "def_punt_blocks",
  extraPointBlocks: "def_pat_blocks",
  fieldGoalBlocks: "def_fg_blocks",
  specialTeamsTouchdowns: "special_teams_tds",
} as const satisfies Readonly<Record<string, string>>;

type OwnField = keyof typeof OWN_COLUMNS;

/** The two fields read off the OPPONENT's row. See the module docblock. */
const OPPONENT_COLUMNS = {
  passingYardsAllowed: "passing_yards",
  rushingYardsAllowed: "rushing_yards",
  sackYardsLostAllowed: "sack_yards_lost",
} as const;

/**
 * Every column this module reads, checked against the file's own header before a single row is
 * mapped — the identical discipline `roster-weeks.ts` and `kicking-weeks.ts` apply. A column
 * silently missing would read as `undefined` and coarsen to 0, which for a defense means a season of
 * takeaways that never happened, indistinguishable from a bad defense.
 */
const REQUIRED_COLUMNS: readonly string[] = [
  "season",
  "week",
  "team",
  "season_type",
  "opponent_team",
  ...Object.values(OWN_COLUMNS),
  ...Object.values(OPPONENT_COLUMNS),
];

function assertShape(rows: readonly CsvRow[]): void {
  if (rows.length === 0) return;
  const columns = new Set(Object.keys(rows[0]!));
  const missing = REQUIRED_COLUMNS.filter((column) => !columns.has(column));
  if (missing.length > 0) {
    throw new Error(
      `nflverse stats_team file is missing column(s) ${missing.join(", ")}. The published schema changed; ` +
        `mapping this file anyway would read every missing column as zero and grade a defense on a game it never played.`,
    );
  }
}

function trimmed(raw: string | undefined): string {
  return (raw ?? "").trim();
}

/** One counting cell. Empty is 0, which is what the release means by it; anything else unreadable
 *  THROWS rather than being guessed at. */
function count(row: CsvRow, column: string): number {
  const raw = trimmed(row[column]);
  if (raw === "") return 0;
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new Error(`nflverse stats_team row has an unreadable ${column} (${JSON.stringify(row[column])}).`);
  }
  return value;
}

interface ParsedRow {
  readonly season: number;
  readonly week: number;
  readonly team: string;
  readonly opponentTeam: string;
  readonly row: CsvRow;
}

/** The regular-season rows, keyed and validated, before the opponent join. */
function parse(rows: readonly CsvRow[]): readonly ParsedRow[] {
  const parsed: ParsedRow[] = [];
  for (const row of rows) {
    if (trimmed(row.season_type) !== NFLVERSE_CONFIG.seasonType) continue;
    const seasonText = trimmed(row.season);
    const weekText = trimmed(row.week);
    const season = Number(seasonText);
    const week = Number(weekText);
    if (seasonText === "" || weekText === "" || !Number.isInteger(season) || !Number.isInteger(week)) {
      throw new Error(
        `nflverse stats_team row has no readable season/week (got ${JSON.stringify(row.season)}/${JSON.stringify(row.week)}).`,
      );
    }
    const team = trimmed(row.team);
    const opponentTeam = trimmed(row.opponent_team);
    if (team === "" || opponentTeam === "") continue;
    parsed.push({ season, week, team, opponentTeam, row });
  }
  return parsed;
}

/**
 * Reads one season's `stats_team_week_YYYY.csv` into one row per (season, week, team), regular
 * season only, with each team's yards allowed taken from its opponent's own row and its points
 * allowed from `pointsAllowed` (build it with `pointsAllowedByTeamWeek`).
 *
 * `pointsAllowed` is a REQUIRED parameter and not a defaulted one: a caller that forgot it would
 * write a whole season of nulls, which reads downstream as "the schedule had no scoreline" — a
 * quiet, plausible lie. An empty map is a caller SAYING that, in one visible word.
 */
export function mapTeamDefenseWeekRows(rows: readonly CsvRow[], pointsAllowed: ReadonlyMap<string, number>): readonly TeamDefenseWeekRow[] {
  assertShape(rows);
  const parsed = parse(rows);
  const byKey = new Map(parsed.map((entry) => [`${entry.season}|${entry.week}|${entry.team}`, entry] as const));

  const mapped: TeamDefenseWeekRow[] = [];
  for (const entry of byKey.values()) {
    const opponent = byKey.get(`${entry.season}|${entry.week}|${entry.opponentTeam}`);
    if (opponent === undefined) continue;
    const own = Object.fromEntries(
      Object.entries(OWN_COLUMNS).map(([field, column]) => [field, count(entry.row, column)]),
    ) as Record<OwnField, number>;
    mapped.push({
      season: entry.season,
      week: entry.week,
      team: entry.team,
      opponentTeam: entry.opponentTeam,
      ...own,
      passingYardsAllowed: count(opponent.row, OPPONENT_COLUMNS.passingYardsAllowed),
      rushingYardsAllowed: count(opponent.row, OPPONENT_COLUMNS.rushingYardsAllowed),
      sackYardsLostAllowed: count(opponent.row, OPPONENT_COLUMNS.sackYardsLostAllowed),
      pointsAllowed: pointsAllowed.get(teamWeekKey(entry.season, entry.week, entry.team)) ?? null,
    });
  }
  return mapped.sort((a, b) => a.season - b.season || a.week - b.week || a.team.localeCompare(b.team));
}

const INSERT_CHUNK_ROWS = 1_000;

/** The natural key, plus `ingestedAt`, which names when a row was FIRST written. */
const NATURAL_KEYS: readonly string[] = ["season", "week", "team", "ingestedAt"];

/** Provenance tag for every row this module writes. */
export const TEAM_DEFENSE_WEEK_SOURCE = "nflverse_team_defense_weeks";

/**
 * The one column an incoming null must not erase (migration 0079's own rule).
 *
 * `points_allowed` was added to a table that already held thirteen seasons of rows, and a re-run
 * that cannot resolve a scoreline for some week must leave whatever is already stored rather than
 * blanking it. `excludedSetFor`/`changedRowWhere` write it as
 * `COALESCE(excluded.points_allowed, stored)` and compare against the same expression, so a re-run
 * that FILLS the column counts as a changed row and one that changes nothing counts as none.
 */
const COALESCED_COLUMNS: readonly string[] = ["pointsAllowed"];

/** Upserts on the natural key, for the reason `recordKickingWeekRows` gives: nflverse republishes a
 *  corrected week, and freezing whichever backfill ran first would make the archive a record of an
 *  operator's timing rather than of the league's. */
export async function recordTeamDefenseWeekRows(db: Db, rows: readonly TeamDefenseWeekRow[]): Promise<number> {
  let written = 0;
  for (let start = 0; start < rows.length; start += INSERT_CHUNK_ROWS) {
    const chunk = rows
      .slice(start, start + INSERT_CHUNK_ROWS)
      .map((row) => ({ ...row, source: TEAM_DEFENSE_WEEK_SOURCE }));
    const result = await db
      .insert(nflverseTeamDefenseWeeks)
      .values(chunk)
      .onConflictDoUpdate({
        target: [nflverseTeamDefenseWeeks.season, nflverseTeamDefenseWeeks.week, nflverseTeamDefenseWeeks.team],
        set: excludedSetFor(nflverseTeamDefenseWeeks, NATURAL_KEYS, COALESCED_COLUMNS),
        where: changedRowWhere(nflverseTeamDefenseWeeks, NATURAL_KEYS, COALESCED_COLUMNS),
      })
      .returning({ season: nflverseTeamDefenseWeeks.season });
    written += result.length;
  }
  return written;
}

/** What one season's team-defense ingestion reports about itself. */
export interface TeamDefenseWeekIngestReport {
  readonly season: number;
  readonly rowsRead: number;
  readonly written: number;
  /** Regular-season rows whose opponent had no row in the same file. Reported, never zeroed. */
  readonly unpaired: number;
  /** Written rows the schedule file had no scoreline for. Reported so an operator can see how much
   *  of a season's points allowed is genuinely unknown rather than assuming the column filled. */
  readonly withoutPointsAllowed: number;
}

/**
 * One season's team-defense weeks, archived, with points allowed joined in from the schedule.
 *
 * TWO CLIENTS, because the two files live on different hosts: the release assets carry
 * `stats_team_week_YYYY.csv` and the schedule repository carries `games.csv` (`schedule.ts`). They
 * are separate parameters rather than one client with a branch inside it so a caller cannot pass a
 * client that can only reach one of them and get a silent half-ingestion.
 *
 * The schedule file covers every season at once, so it is fetched ONCE for the whole run rather
 * than per season.
 */
export async function ingestTeamDefenseWeeks(
  db: Db,
  client: NflverseClient,
  seasons: readonly number[],
  scheduleClient: NflverseClient,
): Promise<readonly TeamDefenseWeekIngestReport[]> {
  const scheduleRows = await scheduleClient.getCsv(SCHEDULE_SOURCE_CONFIG.release, SCHEDULE_SOURCE_CONFIG.file);
  const pointsAllowed = pointsAllowedByTeamWeek(mapSchedule(scheduleRows, seasons));

  const reports: TeamDefenseWeekIngestReport[] = [];
  for (const season of seasons) {
    const rows = await client.getCsv(NFLVERSE_CONFIG.releases.statsTeam, `stats_team_week_${season}.csv`);
    const mapped = mapTeamDefenseWeekRows(rows, pointsAllowed);
    const regularSeasonRows = rows.filter(
      (row) => (row.season_type ?? "").trim() === NFLVERSE_CONFIG.seasonType,
    ).length;
    const written = await recordTeamDefenseWeekRows(db, mapped);
    reports.push({
      season,
      rowsRead: rows.length,
      written,
      unpaired: regularSeasonRows - mapped.length,
      withoutPointsAllowed: mapped.filter((row) => row.pointsAllowed === null).length,
    });
  }
  return reports;
}

/** Every archived team-defense week in the given seasons. The component fit's own read, and the
 *  read a candidate builder takes one club's own defensive history from. */
export async function teamDefenseWeekRowsForSeasons(
  db: ReadonlyDb,
  seasons: readonly number[],
  /** SOURCE team codes (`sourceTeamCode`), narrowing to a few clubs on the (team, season, week) index. */
  teams?: readonly string[],
): Promise<readonly TeamDefenseWeekRow[]> {
  if (seasons.length === 0 || teams?.length === 0) return [];
  return db
    .select({
      season: nflverseTeamDefenseWeeks.season,
      week: nflverseTeamDefenseWeeks.week,
      team: nflverseTeamDefenseWeeks.team,
      opponentTeam: nflverseTeamDefenseWeeks.opponentTeam,
      sacks: nflverseTeamDefenseWeeks.sacks,
      interceptions: nflverseTeamDefenseWeeks.interceptions,
      fumbleRecoveries: nflverseTeamDefenseWeeks.fumbleRecoveries,
      defensiveTouchdowns: nflverseTeamDefenseWeeks.defensiveTouchdowns,
      safeties: nflverseTeamDefenseWeeks.safeties,
      puntBlocks: nflverseTeamDefenseWeeks.puntBlocks,
      extraPointBlocks: nflverseTeamDefenseWeeks.extraPointBlocks,
      fieldGoalBlocks: nflverseTeamDefenseWeeks.fieldGoalBlocks,
      specialTeamsTouchdowns: nflverseTeamDefenseWeeks.specialTeamsTouchdowns,
      passingYardsAllowed: nflverseTeamDefenseWeeks.passingYardsAllowed,
      rushingYardsAllowed: nflverseTeamDefenseWeeks.rushingYardsAllowed,
      sackYardsLostAllowed: nflverseTeamDefenseWeeks.sackYardsLostAllowed,
      pointsAllowed: nflverseTeamDefenseWeeks.pointsAllowed,
    })
    .from(nflverseTeamDefenseWeeks)
    .where(
      teams === undefined
        ? inArray(nflverseTeamDefenseWeeks.season, [...seasons])
        : and(inArray(nflverseTeamDefenseWeeks.season, [...seasons]), inArray(nflverseTeamDefenseWeeks.team, [...teams])),
    )
    .orderBy(
      asc(nflverseTeamDefenseWeeks.season),
      asc(nflverseTeamDefenseWeeks.week),
      asc(nflverseTeamDefenseWeeks.team),
    );
}
