import { asc, and, eq, sql } from "drizzle-orm";
import type { Db, ReadonlyDb } from "@/db/client";
import { nflverseInjuries, nflPlayers } from "@/db/schema";
import { changedRowWhere, excludedSetFor } from "@/db/upsert";
import { INJURY_SOURCE, reportFiledAt } from "../news/retrieve";
import { NFLVERSE_CONFIG } from "./config";
import type { NflverseClient } from "./client";
import type { CsvRow } from "./csv";

/**
 * THE OFFICIAL WEEKLY INJURY REPORT, ARCHIVED VERBATIM — one row per (season, week, gsis_id),
 * feeding `availability/season-end.ts`'s "his season ended after week 4 (knee, placed on injured
 * reserve)" derivation.
 *
 * A SECOND, DELIBERATELY DIFFERENT READ OF THE SAME RELEASE `news/retrieve.ts` already ingests.
 * `mapInjuries` there turns this release into ordinal `player_week_observations` — a MODEL FEATURE
 * (how bad is his outlook, as a number a fit can weigh), narrowed to the skill positions the
 * projection engine scores. A fact sheet needs the opposite shape: the report's OWN WORDS ("Knee",
 * "Out"), for every player the release names, so a claim can quote the source rather than reverse-
 * engineer its text back out of an integer. Two consumers, two tables; see `schema.ts`'s
 * `nflverseInjuries` for the storage side of this same split.
 *
 * `reportFiledAt` is reused from `news/retrieve.ts` rather than redefined, because it is the same
 * stamp on the same column — the league's own filing timestamp, taken literally rather than rounded.
 * `INJURY_SOURCE` is reused for the identical reason: both tables record a fact from the same
 * release, and a second string naming the same thing would be a second, driftable spelling of one
 * provenance tag.
 */

/** One player's one week, exactly as the report published it — never narrowed to an ordinal. */
export interface InjuryRow {
  readonly season: number;
  readonly week: number;
  /** The gsis id, matching `nfl_players.id`. */
  readonly playerId: string;
  /** The game-status designation, verbatim ("Out", "Questionable", "Doubtful"), or "" when listed
   *  with none yet. */
  readonly reportStatus: string;
  /** The report's own injury text ("Knee"), or "" when none was published. Never inferred to
   *  something more specific than these words. */
  readonly primaryInjury: string;
  /** The practice-participation designation, verbatim, or "" when not on the report. */
  readonly practiceStatus: string;
  /**
   * The league's own filing timestamp for the row this player-week kept (see `mapInjuryRows`), or
   * `null` when the file carries no such stamp at all — nflverse dropped `date_modified` entirely
   * starting with the 2025 release. `null` records a REPORTED absence, never a guess: nothing here
   * ever fabricates "now" or copies another column's timestamp in its place.
   */
  readonly dateModified: Date | null;
}

/**
 * Every column BOTH published shapes carry. Checked against the file's own header before a single
 * row is mapped — not merely relied upon by later `row[column]` lookups reading `undefined` —
 * because a column silently missing would otherwise coarsen every row on that column to "" and
 * read exactly like a healthy league: the failure this table exists to make impossible for a
 * REPORTED absence, repeated for the columns that GET it there.
 *
 * `date_modified` is deliberately NOT in this list. It is a real column in every `injuries_YYYY.csv`
 * from 2013 through 2024 and is genuinely absent from `injuries_2025.csv` onward (measured against
 * the live files); `season_type`, conversely, was ADDED in 2025 and is simply ignored here — nothing
 * in this module reads it, so its presence or absence never affects mapping. `mapInjuryRows` below
 * checks for `date_modified`'s presence itself, per file, and maps the two shapes accordingly. A file
 * missing any column still listed here (e.g. `report_status`) is a genuinely unknown shape and still
 * throws, exactly as before.
 */
const REQUIRED_COLUMNS: readonly string[] = ["season", "game_type", "week", "gsis_id", "report_status", "report_primary_injury", "practice_status"];

function assertShape(rows: readonly CsvRow[]): void {
  if (rows.length === 0) return;
  const columns = new Set(Object.keys(rows[0]!));
  const missing = REQUIRED_COLUMNS.filter((column) => !columns.has(column));
  if (missing.length > 0) {
    throw new Error(
      `nflverse injuries file is missing column(s) ${missing.join(", ")}. The published schema changed; ` +
        `mapping this file anyway would silently coarsen every row on the missing column rather than refusing.`,
    );
  }
}

function trimmed(raw: string | undefined): string {
  return (raw ?? "").trim();
}

/**
 * Whether THIS FILE's own header carries `date_modified` at all — decided once, from the first
 * row, rather than per row: a CSV's columns are a property of the file, not of any one line in it.
 * Every row `mapInjuryRows` maps from one call therefore agrees on whether it is stamped.
 */
function hasDateModifiedColumn(rows: readonly CsvRow[]): boolean {
  return rows.length > 0 && "date_modified" in rows[0]!;
}

/**
 * Which of two candidates for the same (season, week, gsis_id) key the within-file tie-break
 * keeps. See `mapInjuryRows`'s own docblock ("THE TIE-BREAK WITHOUT A STAMP") for the rule.
 *
 * Only ever compares two `Date`s or two `null`s: `hasDateModifiedColumn` decides stampedness once
 * for the whole file, so within one `mapInjuryRows` call every candidate for the same key was
 * built the same way. A mixed comparison never reaches this function — there is no real file that
 * carries the column on some rows and not others for this to arbitrate.
 */
function keepsCandidate(candidate: InjuryRow, existing: InjuryRow): boolean {
  if (candidate.dateModified === null || existing.dateModified === null) {
    return true; // no filing timestamp to compare (2025+ shape) — the later row in file order wins.
  }
  return candidate.dateModified.getTime() >= existing.dateModified.getTime();
}

/**
 * Reads one season's `injuries_YYYY.csv` into one row per (season, week, gsis_id).
 *
 * ALREADY ONE ROW PER PLAYER-WEEK IN THE REAL RELEASE — measured across six seasons spanning 2009
 * to 2025, nflverse collapses a player's week to a single filing. The rare exception (two rows in
 * the 2024 file, a designation revised mid-week from Questionable to Out) is resolved here by
 * keeping whichever row carries the LATER `date_modified`: nflverse's own most recent word for that
 * player-week, never an average or a first-seen guess between two rows that disagree.
 *
 * TWO SHAPES, READ EXPLICITLY: `injuries_2013.csv` through `injuries_2024.csv` carry `date_modified`
 * on every row; `injuries_2025.csv` onward carry no such column at all (nflverse dropped the stamp
 * the same release it added `season_type`, which this module ignores). Which shape a given call is
 * reading is decided ONCE per file, from the header (`hasDateModifiedColumn`) — never row by row.
 *
 * WHEN `date_modified` EXISTS, an empty value still refuses (`reportFiledAt`'s existing rule,
 * exercised by the 2009-2012 files, which carry the column with empty values and stay out of
 * scope) — only a file that dropped the column outright reads as `dateModified: null`.
 *
 * THE TIE-BREAK WITHOUT A STAMP: two rows can share a (season, week, gsis_id) key with NEITHER
 * carrying a `date_modified` (the 2025+ shape). With no filing timestamp to compare, this falls
 * back to LAST-ROW-WINS — the later row in the file's own order — because nflverse's convention
 * for the 2013-2024 shape was already "the file's most recent word", and file order is the only
 * signal a stampless file still carries of which row is more recent. Across separate ingestions
 * (a 2024 re-run meeting an already-stored 2024 row, say), a NULL never erases a REAL stamp
 * already on record — see `recordInjuryRows`'s own "NULL-VS-STAMPED" note for that rule, which is
 * a property of the upsert, not of this in-memory pass.
 *
 * NARROWED TO THE REGULAR SEASON, matching `NFLVERSE_CONFIG.seasonType` — the same scope every
 * other ingester in this adapter keeps, because this product does not score anything else.
 *
 * NOT narrowed to a projected skill position, unlike `mapInjuries` (`news/retrieve.ts`): this is an
 * archive of what the league published, not a feature for a fit that only ever weighs skill
 * players. `ingestInjuries` below narrows to the universe `nfl_players` holds — everyone the
 * release names who is also a real NFL player — which is a FK requirement, not a scoring one.
 */
export function mapInjuryRows(rows: readonly CsvRow[]): readonly InjuryRow[] {
  assertShape(rows);
  const stamped = hasDateModifiedColumn(rows);
  const latest = new Map<string, InjuryRow>();
  for (const row of rows) {
    if (row.game_type !== NFLVERSE_CONFIG.seasonType) continue;
    const playerId = trimmed(row.gsis_id);
    if (playerId === "") continue;

    const seasonText = trimmed(row.season);
    const weekText = trimmed(row.week);
    const season = Number(seasonText);
    const week = Number(weekText);
    if (seasonText === "" || weekText === "" || !Number.isInteger(season) || !Number.isInteger(week)) {
      throw new Error(`nflverse injuries row has no readable season/week (got ${JSON.stringify(row.season)}/${JSON.stringify(row.week)}).`);
    }

    const candidate: InjuryRow = {
      season,
      week,
      playerId,
      reportStatus: trimmed(row.report_status),
      primaryInjury: trimmed(row.report_primary_injury),
      practiceStatus: trimmed(row.practice_status),
      dateModified: stamped ? reportFiledAt(row.date_modified) : null,
    };

    const key = `${season}|${week}|${playerId}`;
    const existing = latest.get(key);
    if (existing === undefined || keepsCandidate(candidate, existing)) {
      latest.set(key, candidate);
    }
  }
  return [...latest.values()].sort((a, b) => a.season - b.season || a.week - b.week || a.playerId.localeCompare(b.playerId));
}

/** Postgres's bound-parameter ceiling, matching `draft-picks.ts`'s own `INSERT_CHUNK_ROWS`. */
const INSERT_CHUNK_ROWS = 2_000;

/** `nflverseInjuries`'s natural key, as JS property names — what `excludedSetFor`/`changedRowWhere`
 *  (`@/db/upsert`) key off. `ingestedAt` rides along as an excluded key too: it names when a row was
 *  FIRST written, and a re-ingestion must never let it be overwritten, exactly as
 *  `player_week_observations` never lets a re-run touch its own timestamp. */
const NATURAL_KEYS: readonly string[] = ["season", "week", "playerId", "ingestedAt"];

/**
 * Writes injury rows, UPSERTING on the natural key rather than `onConflictDoNothing`.
 *
 * The opposite choice from `nfl_draft_picks` (`recordDraftPicks`), and correct for the opposite
 * reason: a draft pick never changes once made, but nflverse DOES occasionally republish a week's
 * designation (`mapInjuryRows`'s own docblock: the 2024 file revises two rows mid-week), and
 * `onConflictDoNothing` would freeze whichever version an operator's backfill happened to run
 * first. `changedRowWhere` keeps a re-run with an UNCHANGED row a true no-op — the row is neither
 * updated nor counted — so re-ingesting an already-current season still reports 0 written.
 *
 * Returns how many rows were ACTUALLY new-or-changed, the same contract every writer in this
 * engine keeps.
 *
 * NULL-VS-STAMPED, THE RULE THIS TABLE COMMITS TO: `date_modified` is the one column this upsert
 * does NOT hand `excludedSetFor`'s default `set excluded.<column>` to. Instead it is
 * `COALESCE(excluded.date_modified, nflverse_injuries.date_modified)` — a `null` incoming stamp
 * never erases a stamp already on record, but an incoming REAL stamp always replaces whatever was
 * there (stamped or null). Two null-stamped revisions of the same key trivially keep the incoming
 * row's null (coalescing null with null stays null) — there is nothing to lose. In practice this
 * never actually fires across shapes: `season` is part of the natural key, and nflverse has never
 * mixed shapes within one season, so a given key's rows are either always stamped (2013-2024) or
 * always null (2025+) — but the coalesce keeps the guarantee true even if that ever changed,
 * rather than depending on an invariant this module does not enforce. `changedRowWhere` still
 * compares every column INCLUDING `date_modified` against `excluded`, so a row whose only nominal
 * difference is a stamped value trying to arrive as null still correctly reads as "changed" and
 * takes the update path — it is only the value that ends up written that the coalesce protects.
 */
export async function recordInjuryRows(db: Db, rows: readonly InjuryRow[]): Promise<number> {
  let written = 0;
  for (let start = 0; start < rows.length; start += INSERT_CHUNK_ROWS) {
    const chunk = rows.slice(start, start + INSERT_CHUNK_ROWS).map((row) => ({ ...row, source: INJURY_SOURCE }));
    const result = await db
      .insert(nflverseInjuries)
      .values(chunk)
      .onConflictDoUpdate({
        target: [nflverseInjuries.season, nflverseInjuries.week, nflverseInjuries.playerId],
        set: {
          ...excludedSetFor(nflverseInjuries, NATURAL_KEYS),
          dateModified: sql`coalesce(excluded.date_modified, ${nflverseInjuries.dateModified})`,
        },
        where: changedRowWhere(nflverseInjuries, NATURAL_KEYS),
      })
      .returning({ season: nflverseInjuries.season });
    written += result.length;
  }
  return written;
}

/** Every id `nfl_players` holds — read once per ingestion call, matching `draft-picks.ts`'s own
 *  `knownPlayerIds`, which this duplicates in miniature rather than sharing: each caller's shape
 *  (a `Db` here, a `ReadonlyDb` there) has stayed a two-line function not worth a shared module. */
async function knownPlayerIds(db: ReadonlyDb): Promise<ReadonlySet<string>> {
  const rows = await db.select({ id: nflPlayers.id }).from(nflPlayers);
  return new Set(rows.map((row) => row.id));
}

/** What one season's injury-archive ingestion reports about itself. */
export interface InjuryIngestReport {
  readonly season: number;
  /** Rows the release carried for the regular season, before the universe was consulted. */
  readonly rowsRead: number;
  /** How many rows were ACTUALLY written or changed. A re-run of a landed season reports 0. */
  readonly written: number;
  /** Rows dropped because the gsis id is not in `nfl_players` — reported, never silently lost. */
  readonly unknownToUniverse: number;
}

/**
 * Fetches and archives one or more seasons of the official injury report.
 *
 * Filtered to the ids `nfl_players` already holds, because `nflverse_injuries.player_id` is a
 * foreign key — the same guard `ingestDraftPicks` applies for the identical reason. The universe is
 * fetched ONCE for the whole call, not once per season, matching every other multi-season ingester
 * in this adapter.
 */
export async function ingestInjuries(db: Db, client: NflverseClient, seasons: readonly number[]): Promise<readonly InjuryIngestReport[]> {
  const known = await knownPlayerIds(db);
  const reports: InjuryIngestReport[] = [];
  for (const season of seasons) {
    const rows = await client.getCsv(NFLVERSE_CONFIG.releases.injuries, `injuries_${season}.csv`);
    const mapped = mapInjuryRows(rows);
    const insertable = mapped.filter((row) => known.has(row.playerId));
    const written = await recordInjuryRows(db, insertable);
    reports.push({ season, rowsRead: rows.length, written, unknownToUniverse: mapped.length - insertable.length });
  }
  return reports;
}

/**
 * Every archived injury row for one player, one season, in week order — the read
 * `availability/season-end.ts`'s caller is expected to build a derivation's input from.
 *
 * No `as_of` gate: like `nflDraftPicks`, nothing reads this table through the point-in-time
 * discipline (a season-ending absence is a retrospective claim about a season already over, not a
 * live projection input), so the plain historical read is the honest one.
 */
export async function injuryRowsFor(db: ReadonlyDb, playerId: string, season: number): Promise<readonly InjuryRow[]> {
  const rows = await db
    .select({
      season: nflverseInjuries.season,
      week: nflverseInjuries.week,
      playerId: nflverseInjuries.playerId,
      reportStatus: nflverseInjuries.reportStatus,
      primaryInjury: nflverseInjuries.primaryInjury,
      practiceStatus: nflverseInjuries.practiceStatus,
      dateModified: nflverseInjuries.dateModified,
    })
    .from(nflverseInjuries)
    .where(and(eq(nflverseInjuries.playerId, playerId), eq(nflverseInjuries.season, season)))
    .orderBy(asc(nflverseInjuries.week));
  return rows;
}
