import type { Db } from "@research/db/client";
import { parseCsv } from "../nflverse/csv";
import { nflTeamsBySeason } from "../nflverse/team-eras";
import { recordTeamObservations, teamObservationsAsOf, type TeamWeekObservation } from "../team-store";

/**
 * THE VEGAS WIN-TOTALS INGEST — a SEPARATE module from `nflverse/ingest.ts` on purpose.
 *
 * Every other ingestion in that file reads a released nflverse CSV over the network. This reads a
 * committed file (`data/win-totals/win-totals.csv`, curated and validated by
 * `scripts/validate-win-totals.ts`) that is not nflverse data at all — it is the preseason betting
 * market, sourced from `nfelosrs` (see `data/win-totals/README.md`'s provenance section). Folding
 * this into `nflverse/ingest.ts` would blur a distinction the rest of the engine keeps carefully:
 * which facts come from the play-by-play/schedule feed this project treats as ground truth, and
 * which come from a market. A separate module keeps that line visible in the import graph, not just
 * in a comment.
 *
 * THE CSV SHAPE LIVES HERE, NOT IN THE VALIDATOR. `scripts/validate-win-totals.ts` (Task 1) defined
 * `WinTotalRow`/`parseWinTotalsCsv`/the season range originally; they move here because this module
 * is the canonical parser of the win-totals shape, and a script importing from `src/` (as
 * `validate-win-totals.ts` already does for `firstKickoffFor`, `nflTeamsBySeason`, and the rest) is
 * this repo's normal direction of dependency. The validator re-exports these names so nothing else
 * that imports from it has to change.
 *
 * THE FILE READ DOES NOT LIVE HERE (file-sourced data round, 2026-09-09). This module is imported
 * by the request path for `VEGAS_SOURCE` and `VEGAS_METRICS`, so a `readFileSync` in it would be
 * traced into the serverless bundle, the exact shape of the coaches CSV outage. The committed
 * file's path and its read are `scripts/lib/win-totals-csv.ts`'s; this module parses text it is
 * handed and writes rows it has verified.
 */

export const FIRST_WIN_TOTALS_SEASON = 2003;
export const LAST_WIN_TOTALS_SEASON = 2026;

/** Every season the curated CSV covers, 2003 through 2026 inclusive. */
export const WIN_TOTALS_SEASONS: readonly number[] = Array.from(
  { length: LAST_WIN_TOTALS_SEASON - FIRST_WIN_TOTALS_SEASON + 1 },
  (_, i) => FIRST_WIN_TOTALS_SEASON + i,
);

export interface WinTotalRow {
  readonly season: number;
  readonly team: string;
  readonly winTotal: number;
  readonly overPrice: number;
  readonly underPrice: number;
  /** `null`, never `0` — a season with no recorded wins is unknown, not winless. Read by the
   *  validator only; this ingest never writes it (Task 3's own delta reads actual wins from the
   *  schedule store, not from this column — see `data/win-totals/README.md`). */
  readonly actualWins: number | null;
  readonly source: string;
  readonly sourceDate: string;
}

function requiredNumber(raw: string, column: string, season: string, team: string): number {
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new Error(`win-totals.csv row (season ${season}, team ${team}) has an unreadable ${column} (got ${JSON.stringify(raw)}).`);
  }
  return value;
}

/** Parses the curated CSV into typed rows. Throws on any unreadable numeric column. */
export function parseWinTotalsCsv(text: string): readonly WinTotalRow[] {
  return parseCsv(text).map((row) => {
    const season = requiredNumber(row.season ?? "", "season", row.season ?? "", row.team ?? "");
    const team = row.team ?? "";
    const actualWinsRaw = (row.actual_wins ?? "").trim();
    return {
      season,
      team,
      winTotal: requiredNumber(row.win_total ?? "", "win_total", row.season ?? "", team),
      overPrice: requiredNumber(row.over_price ?? "", "over_price", row.season ?? "", team),
      underPrice: requiredNumber(row.under_price ?? "", "under_price", row.season ?? "", team),
      actualWins: actualWinsRaw === "" ? null : requiredNumber(actualWinsRaw, "actual_wins", row.season ?? "", team),
      source: row.source ?? "",
      sourceDate: row.source_date ?? "",
    };
  });
}

/** Provenance stamp for every observation this module writes. */
export const VEGAS_SOURCE = "vegas_win_totals";

export const VEGAS_METRICS = {
  /** The posted regular-season win total line. */
  winTotal: "vegas_win_total",
  /** American odds on the over. */
  overPrice: "vegas_win_total_over_price",
  /** American odds on the under. */
  underPrice: "vegas_win_total_under_price",
} as const;

/**
 * ONE ROW, WEEK ONE — the season's own preseason identity, not replicated across every week the
 * team plays.
 *
 * This differs from `coachObservations` (`nflverse/coaches.ts`), which DOES replicate a season-long
 * fact across every week of the season, and that difference is deliberate rather than an
 * inconsistency: the coach prior needs to survive a week-range read scoped to the games actually
 * played (`teamObservationsAsOf({ week: { from: 1, to: LAST_POSSIBLE_WEEK } })` filtered later by a
 * feature that only wants the weeks it is predicting), where a gap at week 9 would silently drop the
 * fact from a week-9 lookup keyed by `(team, season, week, metric)`. A win total carries no such
 * per-week reader: every consumer this engine has for a preseason market line — the live-board
 * team-facts read (`preseason/source.ts`'s `loadPreseason`, which pulls the WHOLE
 * `{ from: 1, to: LAST_POSSIBLE_WEEK }` range regardless) and any season-level "law" condition
 * (`laws/populations.ts`) — reads a WHOLE-SEASON quantity, not a week-accurate one, and week one is
 * the one week every one of those range reads is guaranteed to include. Stamping all eighteen-plus
 * weeks would be twenty-two times the storage for a value that never varies within a season, to
 * satisfy a reader shape nothing in this engine has.
 */
const OBSERVATION_WEEK = 1;

/** The three metrics, for every row, at their own `source_date` stamp — the CSV's own stamping
 *  ruling (`progress.md`, Task 1's sourcing note): each row's `source_date` where it is a real
 *  tracked publication date, the documented `not_tracked` convention date otherwise. Every stamp is
 *  independently validated (`scripts/validate-win-totals.ts`) to precede that season's first
 *  kickoff, so this function trusts the column rather than re-deriving or re-checking it. */
export function winTotalObservations(rows: readonly WinTotalRow[]): readonly TeamWeekObservation[] {
  const observations: TeamWeekObservation[] = [];
  for (const row of rows) {
    const asOf = new Date(row.sourceDate);
    if (Number.isNaN(asOf.getTime())) {
      throw new Error(`win-totals.csv row (season ${row.season}, team ${row.team}) has an unparseable source_date "${row.sourceDate}".`);
    }
    const stamp = { season: row.season, week: OBSERVATION_WEEK, team: row.team, source: VEGAS_SOURCE, asOf } as const;
    observations.push({ ...stamp, metric: VEGAS_METRICS.winTotal, value: row.winTotal });
    observations.push({ ...stamp, metric: VEGAS_METRICS.overPrice, value: row.overPrice });
    observations.push({ ...stamp, metric: VEGAS_METRICS.underPrice, value: row.underPrice });
  }
  return observations;
}

/**
 * THE PUBLISHER'S OWN FILE (dossier-voice round §3.6) — where the committed CSV came from, read
 * live so a new season's lines land without a human fetching them ([[pfr-account-for-model-inputs]]
 * rules out a recurring manual pull). Provenance and license reasoning: `data/win-totals/README.md`.
 *
 * The committed CSV stays the VALIDATED SEED: `scripts/validate-win-totals.ts` checks it row by row
 * against the store's own schedule, and `ingestWinTotalsCsv` (`scripts/lib/win-totals-csv.ts`) still reads it. This fetch only ever
 * adds a season the committed file does not carry yet.
 */
export const PUBLISHED_WIN_TOTALS_URL = "https://raw.githubusercontent.com/greerreNFL/nfelosrs/main/nfelosrs/Manual%20Data/win_totals.csv";

/** The publisher's own column names, which differ from the curated file's (`line` rather than
 *  `win_total`, `over_odds`/`under_odds` rather than the `_price` pair). Stated here rather than
 *  guessed at read time, so a publisher rename fails loudly with the column it wanted. */
const PUBLISHED_COLUMNS = ["season", "team", "line", "over_odds", "under_odds", "source", "source_date"] as const;

/**
 * The two team-code divergences `data/win-totals/README.md` documents, applied to a fetched row so
 * a live read lands in the same spelling the curated file was normalized to (and the same one
 * `nflTeamsBySeason` asserts): the publisher's `LAR` is nflverse's `LA`, and the publisher keeps
 * stamping `OAK` for seasons the Raiders have been `LV` since 2020.
 */
export function normalizePublishedTeam(team: string, season: number): string {
  if (team === "LAR") return "LA";
  if (team === "OAK" && season >= 2020) return "LV";
  return team;
}

export interface PublishedWinTotals {
  /** `false` when the publisher carries no rows for the season, or carries fewer than a full
   *  league. Either way the caller writes nothing and the product keeps saying "not posted yet",
   *  which is then true. */
  readonly posted: boolean;
  readonly rows: readonly WinTotalRow[];
  /** How many distinct teams the publisher has posted for this season. */
  readonly teamsPosted: number;
}

/**
 * One season's rows from the publisher, or an honest "not posted".
 *
 * THE SHAPE IS ASSERTED, NOT ASSUMED. A file missing any column this reader needs throws, naming
 * the column: a silently renamed column would otherwise read as a season nobody has posted, and a
 * gap that looks like an ordinary preseason state is exactly the failure this project keeps
 * catching late. An unreadable number throws through `requiredNumber`, the same way the committed
 * file's own parse does.
 *
 * A PARTIAL POST IS NOT A POST. Fewer than the season's own full league (`nflTeamsBySeason`) means
 * the publisher is mid-update, and half a league of win totals stored is a board where some teams
 * carry a market and some do not, for no reason a reader could see.
 */
export async function fetchPublishedWinTotals(
  season: number,
  deps: { readonly fetch?: typeof globalThis.fetch } = {},
): Promise<PublishedWinTotals> {
  const doFetch = deps.fetch ?? globalThis.fetch;
  const response = await doFetch(PUBLISHED_WIN_TOTALS_URL);
  if (!response.ok) {
    throw new Error(`win-totals publisher returned HTTP ${response.status} for ${PUBLISHED_WIN_TOTALS_URL}.`);
  }
  const parsed = parseCsv(await response.text());
  const first = parsed[0];
  if (first === undefined) throw new Error("win-totals publisher returned a file with no rows.");
  for (const column of PUBLISHED_COLUMNS) {
    if (!(column in first)) {
      throw new Error(`win-totals publisher file has no "${column}" column; it carries ${Object.keys(first).join(", ")}.`);
    }
  }

  const rows = parsed
    .filter((row) => Number(row.season) === season)
    .map((row) => {
      const team = normalizePublishedTeam((row.team ?? "").trim(), season);
      return {
        season,
        team,
        winTotal: requiredNumber(row.line ?? "", "line", String(season), team),
        overPrice: requiredNumber(row.over_odds ?? "", "over_odds", String(season), team),
        underPrice: requiredNumber(row.under_odds ?? "", "under_odds", String(season), team),
        actualWins: null,
        source: (row.source ?? "").trim(),
        sourceDate: (row.source_date ?? "").trim(),
      } satisfies WinTotalRow;
    });

  const teamsPosted = new Set(rows.map((row) => row.team)).size;
  return { posted: teamsPosted >= nflTeamsBySeason(season).length, rows, teamsPosted };
}

export interface VegasIngestReport {
  readonly rowsRead: number;
  readonly seasons: readonly number[];
  /** How many observations were ACTUALLY new — a re-run of a landed ingestion reports 0. */
  readonly observationsWritten: number;
  /** CSV rows read, per season — every season should read 32 (the canonical league size). */
  readonly rowsPerSeason: ReadonlyMap<number, number>;
}

/**
 * Writes every row's three metrics to the team store, from EITHER source — the committed CSV
 * (`scripts/lib/win-totals-csv.ts`'s `ingestWinTotalsCsv`) or the publisher's live file (the
 * win-totals job). One writer, so a fetched season lands under exactly the same provenance stamp,
 * the same week-one convention and the same value-by-value verification a committed season does.
 *
 * VERIFIES ITS OWN WRITE RATHER THAN TRUSTING `recordTeamObservations`' RETURN COUNT
 * (`progress.md`'s documented `onConflictDoNothing` shadowing hazard: two different values sharing
 * one conflict key resolve to whichever landed first, silently, for any row NOT caught by
 * `assertFiniteValues`' same-batch check). This writer's own key
 * (`season|week|team|source|metric|asOf`) can only collide with a PRIOR run of this exact function,
 * because `VEGAS_SOURCE` is unique to it — so a short write count should mean nothing but an
 * ordinary idempotent re-run, every already-landed row unchanged. This function does not assume
 * that; it reads every row back after the write and compares VALUES, not merely counts, and throws
 * loudly naming every mismatch if a stored value ever disagrees with what this ingest computed,
 * rather than reporting a written-row count that looked plausible while a wrong number sat in the
 * store underneath it.
 */
export async function writeVerifiedWinTotals(db: Db, rows: readonly WinTotalRow[]): Promise<VegasIngestReport> {
  const observations = winTotalObservations(rows);
  const observationsWritten = await recordTeamObservations(db, observations);

  const seasons = [...new Set(rows.map((row) => row.season))].sort((a, b) => a - b);
  const readBackAsOf = new Date();
  const stored = new Map<string, number>();
  for (const season of seasons) {
    for (const row of await teamObservationsAsOf(db, { season, week: OBSERVATION_WEEK, asOf: readBackAsOf, source: VEGAS_SOURCE })) {
      stored.set(`${row.season}|${row.team}|${row.metric}`, row.value);
    }
  }
  const mismatches: string[] = [];
  for (const observation of observations) {
    const key = `${observation.season}|${observation.team}|${observation.metric}`;
    const value = stored.get(key);
    if (value === undefined || value !== observation.value) {
      mismatches.push(`${key}: store holds ${value ?? "nothing"}, this ingest computed ${observation.value}`);
    }
  }
  if (mismatches.length > 0) {
    throw new Error(
      `writeVerifiedWinTotals: ${mismatches.length} observation(s) did not land as computed after the write. ` +
        `This is the onConflictDoNothing shadowing hazard (team_week_observations, documented store debt) ` +
        `catching a real collision rather than an ordinary re-run -- ${mismatches.slice(0, 10).join("; ")}` +
        `${mismatches.length > 10 ? "; ..." : ""}`,
    );
  }

  const rowsPerSeason = new Map<number, number>();
  for (const row of rows) rowsPerSeason.set(row.season, (rowsPerSeason.get(row.season) ?? 0) + 1);

  return { rowsRead: rows.length, seasons, observationsWritten, rowsPerSeason };
}
