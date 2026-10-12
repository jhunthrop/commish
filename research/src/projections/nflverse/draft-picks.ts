import { asc, inArray } from "drizzle-orm";
import type { Db, ReadonlyDb } from "@research/db/client";
import { nflDraftPicks, nflPlayers } from "@research/db/schema";
import { NFLVERSE_CONFIG } from "./config";
import { createNflverseClient, type NflverseClient } from "./client";
import type { CsvRow } from "./csv";

/**
 * EVERY NFL DRAFT PICK, ONE FILE FOR THE WHOLE HISTORY — the ground truth
 * `preseason/rookie-curve.ts` fits its points curve against.
 *
 * `preseason/rookies.ts`'s bucket prior is fit from `preseason_rosters.draft_pick`, which is honest
 * but shallow: that table's roster backfill floor is `HISTORICAL_ROSTER_FLOOR` (`rosters.ts`; 2003
 * since fit-round Task 1, 2013 before it), a roster-availability limit rather than a draft-history one. nflverse's `draft_picks` release
 * carries no such limit — its own release notes say it reaches back to 1980 — and it is keyed on the
 * same `gsis_id` every other table here uses, so a rookie curve fit against it can draw on far more
 * draft classes than the roster table alone would give it. See `schema.ts`'s `nflDraftPicks` for why
 * that earns a dedicated table rather than a slot in `player_week_observations`.
 *
 * ONE FILE COVERS EVERY SEASON, exactly like `players.csv` — there is no `draft_picks_2020.csv` to
 * request per year, so `ingestDraftPicks` fetches it once rather than season by season.
 */

/** One player selected in one draft, as the curve fit needs to see him. */
export interface DraftPickRow {
  /** The draft year — a rookie's own pick season. */
  readonly season: number;
  readonly round: number;
  /** OVERALL pick number, 1-based. Every row here is an actual selection. */
  readonly pick: number;
  /** The gsis id, which is `nfl_players.id`. */
  readonly playerId: string;
  /** nflverse's own spelling, unnarrowed, exactly as `nfl_players.position` is. */
  readonly position: string;
  readonly team: string;
  readonly asOf: Date;
}

function text(row: CsvRow, column: string): string | null {
  const raw = row[column];
  return raw === undefined || raw.trim() === "" ? null : raw.trim();
}

function whole(row: CsvRow, column: string, atLeast: number): number | null {
  const raw = text(row, column);
  if (raw === null) return null;
  const value = Number(raw);
  return Number.isInteger(value) && value >= atLeast ? value : null;
}

/**
 * THE STAMP A PICK IS KNOWABLE BY: the first of May of its own draft year.
 *
 * The release carries no day-of-pick column, and the NFL draft's three rounds-a-day event always
 * completes inside April, so the first of May is always AFTER the real pick and never by more than
 * a few weeks — the same "deliberate over-estimate, never a guess that leaks the future" discipline
 * `NFLVERSE_CONFIG.publicationLagHours` states for the weekly releases. Nothing reads this table
 * through the point-in-time gate today (see `nflDraftPicks`'s own docblock), so the approximation
 * costs nothing yet.
 */
export function draftKnownByAsOf(season: number): Date {
  return new Date(Date.UTC(season, 4, 1));
}

/**
 * Reads the whole `draft_picks.csv` release into rows, one player per overall pick.
 *
 * Rows without a gsis id are DROPPED rather than thrown on, the same choice `mapWeek1Rosters` makes
 * and for the identical reason: a handful of picks every year (Pro Football Reference has no NFL id
 * for them, most often a player who never signed or whose career left no other trace) are a real,
 * ordinary gap in the source rather than a schema change, and refusing the whole file over one of
 * them would make the ingestion hostage to a single seventh-rounder.
 */
export function mapDraftPicks(rows: readonly CsvRow[], asOf: (season: number) => Date = draftKnownByAsOf): readonly DraftPickRow[] {
  const entries: DraftPickRow[] = [];
  for (const row of rows) {
    const season = whole(row, "season", 1936);
    const round = whole(row, "round", 1);
    const pick = whole(row, "pick", 1);
    const playerId = text(row, "gsis_id");
    const position = text(row, "position");
    const team = text(row, "team");
    if (season === null || round === null || pick === null || playerId === null || position === null || team === null) {
      continue;
    }
    entries.push({ season, round, pick, playerId, position, team, asOf: asOf(season) });
  }
  return entries.sort((a, b) => a.season - b.season || a.pick - b.pick);
}

/**
 * Postgres caps a statement at 65,535 bound parameters. Eight bound columns per row puts the hard
 * ceiling around 8,000, and the whole `draft_picks` history is an order of magnitude past that, so
 * the chunking is not a tuning knob — without it the ingestion fails outright. Rounded well down for
 * headroom, matching every other bulk writer in this engine (`store.ts`'s own `INSERT_CHUNK_ROWS`).
 */
const INSERT_CHUNK_ROWS = 2_000;

/**
 * Writes draft picks, idempotently. Returns how many rows were ACTUALLY new — a re-run of a landed
 * ingestion reports 0, the same contract every writer in this engine keeps.
 */
export async function recordDraftPicks(db: Db, rows: readonly DraftPickRow[]): Promise<number> {
  let written = 0;
  for (let start = 0; start < rows.length; start += INSERT_CHUNK_ROWS) {
    const chunk = rows.slice(start, start + INSERT_CHUNK_ROWS);
    const inserted = await db
      .insert(nflDraftPicks)
      .values(chunk.map((row) => ({ ...row })))
      .onConflictDoNothing()
      .returning({ id: nflDraftPicks.id });
    written += inserted.length;
  }
  return written;
}

/**
 * Every draft pick recorded for the given seasons, ordered by `(season, pick)` — deterministic, so
 * a fit computed from it is reproducible run to run.
 *
 * No `as_of` gate: see `nflDraftPicks`'s own docblock for why nothing reads this table through the
 * point-in-time discipline yet. `rookie-curve.ts` reads this directly, offline, the same way
 * `preseason-fit.ts` reads every other fit's own observations.
 */
export async function draftPicksFor(db: ReadonlyDb, seasons: readonly number[]): Promise<readonly DraftPickRow[]> {
  if (seasons.length === 0) return [];
  const rows = await db
    .select({
      season: nflDraftPicks.season,
      round: nflDraftPicks.round,
      pick: nflDraftPicks.pick,
      playerId: nflDraftPicks.playerId,
      position: nflDraftPicks.position,
      team: nflDraftPicks.team,
      asOf: nflDraftPicks.asOf,
    })
    .from(nflDraftPicks)
    .where(inArray(nflDraftPicks.season, [...seasons]))
    .orderBy(asc(nflDraftPicks.season), asc(nflDraftPicks.pick));
  return rows;
}

/** What one ingestion of the whole `draft_picks` release reports about itself. */
export interface DraftPickIngestReport {
  /** Rows the release carried, before the universe was consulted. */
  readonly entriesRead: number;
  /** How many were written. A re-run of a landed ingestion reports 0. */
  readonly written: number;
  /** Entries dropped because the gsis id is not in `nfl_players`. */
  readonly unknownToUniverse: number;
}

/** Every id `nfl_players` holds. Read once per ingestion rather than per row. */
async function knownPlayerIds(db: ReadonlyDb): Promise<ReadonlySet<string>> {
  const rows = await db.select({ id: nflPlayers.id }).from(nflPlayers);
  return new Set(rows.map((row) => row.id));
}

/**
 * Fetches and stores the whole draft-pick history. Run once; nflverse republishes the same one file
 * as new drafts happen, so a re-run simply picks up whatever seasons are new.
 *
 * Filtered to the ids the universe already holds, because `nfl_draft_picks.player_id` is a foreign
 * key and a pick PFR never assigned a gsis id to would fail the whole insert — the same guard
 * `ingestWeek1Rosters` applies for the identical reason.
 */
export async function ingestDraftPicks(db: Db, client: NflverseClient = createNflverseClient()): Promise<DraftPickIngestReport> {
  const rows = await client.getCsv(NFLVERSE_CONFIG.releases.draftPicks, NFLVERSE_CONFIG.files.draftPicks);
  const entries = mapDraftPicks(rows);
  const known = await knownPlayerIds(db);
  const insertable = entries.filter((entry) => known.has(entry.playerId));
  const written = await recordDraftPicks(db, insertable);
  return {
    entriesRead: entries.length,
    written,
    unknownToUniverse: entries.length - insertable.length,
  };
}
