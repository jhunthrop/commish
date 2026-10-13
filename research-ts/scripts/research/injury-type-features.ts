// PRE-REGISTERED ROUND (2026-09-05): injury-type-conditioned availability. Binding pre-registration
// at `docs/research/2026-09-05-availability-injury-type-preregistration.md` (Amendment 1).
//
// TASK 1 — THE FEATURE BUILD. For every veteran player-season 2015-2025 (QB/RB/WR/TE), derives:
//   absenceClass, terminalAbsenceAgeMonths, bodyPartClass, spellCount, longestSpellWeeks,
//   questionablePlayedRate — from `nflverse_injuries` + `nflverse_roster_weeks` (both fully
//   backfilled 2013-2025 in this database) via the committed combiner
//   (`src/projections/availability/season-end.ts`'s `deriveSeasonEnding`).
//
// A DATA-ACCESS FINDING THAT FORCED AMENDMENT 2 (recorded in the results doc, not here — this file
// only implements the resolution). This database's `preseason_rosters` table holds ONLY season
// 2026, and `player_week_observations` (the point-in-time store `loadPreseason`/
// `loadAvailabilityObservations` read through) carries real game-log metrics for 2023-2025 alone —
// confirmed by running `npm run projections:preseason:fit` against this exact `DATABASE_URL`, which
// throws "The store holds no game-derived observations for 2021" before it ever reaches a fit. The
// full board harness (`loadPreseason` -> `preseasonCandidates`) the August round used is therefore
// UNREACHABLE for any season this round needs. The fix used here: nflverse's OWN public weekly
// stats release (`stats_player_week_{season}.csv`, the identical upstream `nflverse_player_week`
// this engine's ingestion already reads) is fetched directly from its GitHub release for the
// seasons this database does not carry, giving real per-week participation back to 2015 rather than
// a database-only 2023-2025. Two genuine gaps in nflverse's own release stream — confirmed matching
// this repo's own `STAT_LINE_GAPS` note in `nflverse/stat-lines.ts` — are handled explicitly below:
//   - 2019: `stats_player_week_2019.csv` 404s upstream. `snap_counts_2019.csv` (pfr-id keyed)
//     does not, so 2019 presence is read from it via `players.csv`'s own pfr_id<->gsis_id
//     crosswalk. 2019 is used only as HISTORY (feeding a later season's prior-three-year record),
//     never as a fit or judged season itself — see the results doc's Amendment 2.
//   - 2025: also a `stats_player_week` gap, but this database's own `player_week_observations`
//     already carries 2025 via `nflverse_snap_counts` (gsis-keyed) — the same fallback
//     `admitsDerivedPriorSeason` names for a live board. Read from the database directly.
//
// Run: DATABASE_URL=... npx tsx scripts/research/injury-type-features.ts
// Output: a JSON dataset written to `RESEARCH_CACHE_DIR` (default: an OS tmp directory), read by
// `scripts/research/injury-type-fit.ts`. Network dependency: raw CSV fetches from
// github.com/nflverse/nflverse-data's public releases (read-only, no credentials) plus a read-only
// DATABASE_URL. Nothing here writes to the database.
import { sql } from "drizzle-orm";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDb, type Db } from "@research-ts/db/client";
import type { Position } from "@research-ts/domain/player";
import {
  deriveSeasonEnding,
  type WeeklyInjuryReport,
  type WeeklyRosterStatus,
} from "@research-ts/projections/availability/season-end";
import { rosterStatusOf, type RosterStatus } from "@research-ts/projections/nflverse/rosters";
import { ageAtSeason, teamGamesIn } from "@research-ts/projections/preseason/availability";

const CACHE_DIR = process.env.RESEARCH_CACHE_DIR ?? join(tmpdir(), "injury-type-research");
const OUTPUT_PATH = join(CACHE_DIR, "feature-dataset.json");

const POSITIONS: readonly Position[] = ["QB", "RB", "WR", "TE"];

/** Label/fit seasons this round touches. 2019 excluded as a LABEL year (see module docblock); it is
 *  still read as HISTORY for 2020-2022. 2025 is the single held-out judged season. 2026 never read. */
const FIT_SEASONS = [2018, 2020, 2021, 2022, 2023, 2024] as const;
const JUDGE_SEASON = 2025;
const ALL_LABEL_SEASONS = [...FIT_SEASONS, JUDGE_SEASON];
const HISTORY_SEASONS = 3;

// Every season whose OWN games-played count this script needs, either as a label or as history.
const NEEDED_GAMES_SEASONS = Array.from(
  new Set(ALL_LABEL_SEASONS.flatMap((season) => [season, season - 1, season - 2, season - 3])),
).sort((a, b) => a - b);

/* ---------------------------------------------------------------------------------------------
 * CSV fetch + parse, cached to disk. Minimal RFC4180 parser (nflverse files quote fields containing
 * commas, e.g. headshot URLs) — no dependency pulled in for a research script.
 * ------------------------------------------------------------------------------------------- */

async function fetchCached(url: string, cacheName: string): Promise<string> {
  if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
  const path = join(CACHE_DIR, cacheName);
  if (existsSync(path)) return readFileSync(path, "utf8");
  const response = await fetch(url);
  const text = await response.text();
  writeFileSync(path, text);
  return text;
}

function parseCsv(text: string): { header: readonly string[]; rows: readonly string[][] } {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i += 1;
      row.push(field);
      field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  const [header, ...body] = rows;
  return { header: header ?? [], rows: body };
}

function indexRows(header: readonly string[], rows: readonly string[][]): readonly Record<string, string>[] {
  const columnIndex = new Map(header.map((name, index) => [name, index]));
  return rows.map((row) => {
    const record: Record<string, string> = {};
    for (const [name, index] of columnIndex) record[name] = row[index] ?? "";
    return record;
  });
}

const STATS_PLAYER_WEEK_URL = (season: number) =>
  `https://github.com/nflverse/nflverse-data/releases/download/player_stats/stats_player_week_${season}.csv`;
const SNAP_COUNTS_URL = (season: number) =>
  `https://github.com/nflverse/nflverse-data/releases/download/snap_counts/snap_counts_${season}.csv`;
const PLAYERS_URL = "https://github.com/nflverse/nflverse-data/releases/download/players/players.csv";

/** Weeks a gsis-id player appeared in a REGULAR SEASON game, per the weekly stats file. */
async function playedWeeksFromStatsPlayerWeek(season: number): Promise<Map<string, Set<number>> | null> {
  const text = await fetchCached(STATS_PLAYER_WEEK_URL(season), `stats_player_week_${season}.csv`);
  if (text.trim() === "Not Found") return null;
  const { header, rows } = parseCsv(text);
  const records = indexRows(header, rows);
  const byPlayer = new Map<string, Set<number>>();
  for (const record of records) {
    if (record.season_type !== "REG") continue;
    const week = Number(record.week);
    if (!Number.isFinite(week)) continue;
    const set = byPlayer.get(record.player_id) ?? new Set<number>();
    set.add(week);
    byPlayer.set(record.player_id, set);
  }
  return byPlayer;
}

/** The 2019 fallback: pfr-id-keyed snap counts, joined to gsis ids via `players.csv`. */
async function playedWeeksFromSnapCounts(season: number, pfrToGsis: ReadonlyMap<string, string>): Promise<Map<string, Set<number>>> {
  const text = await fetchCached(SNAP_COUNTS_URL(season), `snap_counts_${season}.csv`);
  const { header, rows } = parseCsv(text);
  const records = indexRows(header, rows);
  const byPlayer = new Map<string, Set<number>>();
  for (const record of records) {
    if (record.game_type !== "REG") continue;
    const offenseSnaps = Number(record.offense_snaps);
    if (!Number.isFinite(offenseSnaps) || offenseSnaps <= 0) continue;
    const gsis = pfrToGsis.get(record.pfr_player_id);
    if (gsis === undefined) continue;
    const week = Number(record.week);
    if (!Number.isFinite(week)) continue;
    const set = byPlayer.get(gsis) ?? new Set<number>();
    set.add(week);
    byPlayer.set(gsis, set);
  }
  return byPlayer;
}

/** The 2025 fallback: this database's own `nflverse_snap_counts` rows, already gsis-keyed. */
async function playedWeeksFromDb(db: Db, season: number): Promise<Map<string, Set<number>>> {
  const rows = await db.execute(sql`
    select distinct week, player_id from player_week_observations
    where season = ${season} and source = 'nflverse_snap_counts' and metric = 'offensive_snaps' and value > 0
  `);
  const byPlayer = new Map<string, Set<number>>();
  for (const row of rows as unknown as { week: number; player_id: string }[]) {
    const set = byPlayer.get(row.player_id) ?? new Set<number>();
    set.add(Number(row.week));
    byPlayer.set(row.player_id, set);
  }
  return byPlayer;
}

interface PlayersMeta {
  readonly birthDateByGsis: ReadonlyMap<string, string>;
  readonly pfrToGsis: ReadonlyMap<string, string>;
}

async function loadPlayersMeta(): Promise<PlayersMeta> {
  const text = await fetchCached(PLAYERS_URL, "players.csv");
  const { header, rows } = parseCsv(text);
  const records = indexRows(header, rows);
  const birthDateByGsis = new Map<string, string>();
  const pfrToGsis = new Map<string, string>();
  for (const record of records) {
    if (record.gsis_id === "") continue;
    if (record.birth_date !== "") birthDateByGsis.set(record.gsis_id, record.birth_date);
    if (record.pfr_id !== "") pfrToGsis.set(record.pfr_id, record.gsis_id);
  }
  return { birthDateByGsis, pfrToGsis };
}

/** Position-appropriate role share for one season, from the SAME weekly file, averaged over weeks
 *  played. A proxy for layer 1's predicted snap share (unavailable historically without the full
 *  board harness — see module docblock): target share for WR/TE (published directly in the file),
 *  a computed team-week carry share for RB, a computed team-week pass-attempt share for QB. */
async function roleShareFromStatsPlayerWeek(season: number): Promise<Map<string, number>> {
  const text = await fetchCached(STATS_PLAYER_WEEK_URL(season), `stats_player_week_${season}.csv`);
  if (text.trim() === "Not Found") return new Map();
  const { header, rows } = parseCsv(text);
  const records = indexRows(header, rows).filter((record) => record.season_type === "REG");

  const teamWeekCarries = new Map<string, number>();
  const teamWeekAttempts = new Map<string, number>();
  for (const record of records) {
    const key = `${record.team}|${record.week}`;
    teamWeekCarries.set(key, (teamWeekCarries.get(key) ?? 0) + Number(record.carries || 0));
    teamWeekAttempts.set(key, (teamWeekAttempts.get(key) ?? 0) + Number(record.attempts || 0));
  }

  const shares = new Map<string, { sum: number; weeks: number }>();
  for (const record of records) {
    const position = record.position as Position;
    if (!POSITIONS.includes(position)) continue;
    const key = `${record.team}|${record.week}`;
    let share: number | null = null;
    if (position === "WR" || position === "TE") {
      share = record.target_share === "" ? null : Number(record.target_share);
    } else if (position === "RB") {
      const teamCarries = teamWeekCarries.get(key) ?? 0;
      share = teamCarries > 0 ? Number(record.carries || 0) / teamCarries : null;
    } else if (position === "QB") {
      const teamAttempts = teamWeekAttempts.get(key) ?? 0;
      share = teamAttempts > 0 ? Number(record.attempts || 0) / teamAttempts : null;
    }
    if (share === null || !Number.isFinite(share)) continue;
    const running = shares.get(record.player_id) ?? { sum: 0, weeks: 0 };
    running.sum += share;
    running.weeks += 1;
    shares.set(record.player_id, running);
  }
  return new Map([...shares].map(([playerId, { sum, weeks }]) => [playerId, sum / weeks]));
}

/** The 2019 role-share fallback: `offense_pct` from snap counts, a direct (not proxied) snap share. */
async function roleShareFromSnapCounts2019(pfrToGsis: ReadonlyMap<string, string>): Promise<Map<string, number>> {
  const text = await fetchCached(SNAP_COUNTS_URL(2019), "snap_counts_2019.csv");
  const { header, rows } = parseCsv(text);
  const records = indexRows(header, rows).filter((record) => record.game_type === "REG");
  const shares = new Map<string, { sum: number; weeks: number }>();
  for (const record of records) {
    const gsis = pfrToGsis.get(record.pfr_player_id);
    if (gsis === undefined) continue;
    const pct = Number(record.offense_pct);
    if (!Number.isFinite(pct)) continue;
    const running = shares.get(gsis) ?? { sum: 0, weeks: 0 };
    running.sum += pct;
    running.weeks += 1;
    shares.set(gsis, running);
  }
  return new Map([...shares].map(([playerId, { sum, weeks }]) => [playerId, sum / weeks]));
}

/* ---------------------------------------------------------------------------------------------
 * THE BODY-PART VOCABULARY — committed BEFORE any fitting, per the pre-registration.
 *
 * Built from the REAL distinct `primary_injury` text on qualifying ("Out") anchor rows in this
 * database (`select primary_injury, count(*) from nflverse_injuries where report_status = 'Out'
 * group by 1 order by 2 desc`), not guessed. The fixed vocabulary is the pre-registration's own:
 * knee, hamstring, ankle, shoulder, concussion, other — plus `unknown` for a status-sourced
 * (roster-RES-anchored) terminal absence, which carries no body part at all (Amendment 1).
 * ------------------------------------------------------------------------------------------- */
export const BODY_PART_VOCABULARY = ["knee", "hamstring", "ankle", "shoulder", "concussion", "other", "unknown"] as const;
export type BodyPartClass = (typeof BODY_PART_VOCABULARY)[number];

export function bodyPartClassOf(primaryInjury: string | null): BodyPartClass {
  if (primaryInjury === null) return "unknown";
  const normalized = primaryInjury.trim().toLowerCase().replace(/^(left|right)\s+/, "");
  if (normalized === "knee") return "knee";
  if (normalized === "hamstring") return "hamstring";
  if (normalized === "ankle") return "ankle";
  if (normalized === "shoulder") return "shoulder";
  if (normalized === "concussion") return "concussion";
  return "other";
}

/* ---------------------------------------------------------------------------------------------
 * SPELLS — a run of consecutive weeks carrying INJURY-QUALIFYING evidence (mirroring
 * `season-end.ts`'s own qualifying sets, restated locally since that module does not export them):
 * a report row of "Out" or "Injured Reserve", or a roster row of "RES". A missed week with no such
 * evidence (a healthy scratch, a coach's decision, a bye) is never counted — absence of a report is
 * not itself a report of absence, the exact discipline `season-end.ts` states for its own anchor.
 * ------------------------------------------------------------------------------------------- */
const SPELL_REPORT_STATUSES = new Set(["Out", "Injured Reserve"]);
const SPELL_RESERVE_STATUSES = new Set(["RES"]);

export interface AbsenceFeatures {
  readonly absenceClass: "healthy" | "discrete_terminal" | "recurring";
  readonly terminalAbsenceAgeMonths: number | null;
  readonly bodyPartClass: BodyPartClass | null;
  readonly spellCount: number;
  readonly longestSpellWeeks: number;
  readonly questionablePlayedRate: number | null;
}

/** Calendar date of an NFL regular-season week, approximated: week 1 falls on the Thursday nearest
 *  September 8th every year in the 2015-2025 span (verified against the real schedule for a handful
 *  of anchor seasons), each subsequent week seven days later. Precise to within a few days, which is
 *  what `terminalAbsenceAgeMonths` (measured in whole months against a September kickoff) needs. */
function approxWeekDate(season: number, week: number): Date {
  const week1 = Date.UTC(season, 8, 8); // September 8th
  return new Date(week1 + (week - 1) * 7 * 24 * 60 * 60 * 1000);
}

function monthsBetween(from: Date, to: Date): number {
  return (to.getTime() - from.getTime()) / (30.4368 * 24 * 60 * 60 * 1000);
}

export function computeAbsenceFeatures(
  season: number,
  nextSeason: number,
  injuryRows: readonly WeeklyInjuryReport[],
  statusRows: readonly WeeklyRosterStatus[],
  playedWeeks: ReadonlySet<number>,
): AbsenceFeatures {
  const teamGames = teamGamesIn(season);
  const lastWeek = teamGames + 1; // 18 calendar weeks for a 17-game season, 17 for a 16-game one.

  const qualifyingMissed = new Set<number>();
  const reportByWeek = new Map(injuryRows.map((row) => [row.week, row] as const));
  const statusByWeek = new Map(statusRows.map((row) => [row.week, row] as const));
  for (let week = 1; week <= lastWeek; week += 1) {
    if (playedWeeks.has(week)) continue;
    const report = reportByWeek.get(week);
    const status = statusByWeek.get(week);
    const qualifies =
      (report !== undefined && SPELL_REPORT_STATUSES.has(report.reportStatus)) ||
      (status !== undefined && SPELL_RESERVE_STATUSES.has(status.status));
    if (qualifies) qualifyingMissed.add(week);
  }

  // Group consecutive qualifying weeks into spells.
  const spellStarts: number[] = [];
  const spellLengths: number[] = [];
  let currentStart: number | null = null;
  let currentLength = 0;
  for (let week = 1; week <= lastWeek + 1; week += 1) {
    if (qualifyingMissed.has(week)) {
      if (currentStart === null) currentStart = week;
      currentLength += 1;
    } else if (currentStart !== null) {
      spellStarts.push(currentStart);
      spellLengths.push(currentLength);
      currentStart = null;
      currentLength = 0;
    }
  }
  const spellCount = spellStarts.length;
  const longestSpellWeeks = spellLengths.length === 0 ? 0 : Math.max(...spellLengths);

  const gamesPlayedWeeks = [...playedWeeks];
  const combined = deriveSeasonEnding(injuryRows, statusRows, gamesPlayedWeeks);

  const questionableWeeks = injuryRows.filter((row) => row.reportStatus === "Questionable");
  const questionablePlayedRate =
    questionableWeeks.length === 0
      ? null
      : questionableWeeks.filter((row) => playedWeeks.has(row.week)).length / questionableWeeks.length;

  if (spellCount === 0) {
    return { absenceClass: "healthy", terminalAbsenceAgeMonths: null, bodyPartClass: null, spellCount, longestSpellWeeks, questionablePlayedRate };
  }

  const isTerminal = combined !== null && spellStarts.includes(combined.firstMissedWeek) && combined.firstMissedWeek === spellStarts[spellStarts.length - 1];

  if (spellCount === 1) {
    if (!isTerminal) {
      return { absenceClass: "healthy", terminalAbsenceAgeMonths: null, bodyPartClass: null, spellCount, longestSpellWeeks, questionablePlayedRate };
    }
    const ageMonths = monthsBetween(approxWeekDate(season, combined!.firstMissedWeek), new Date(Date.UTC(nextSeason, 8, 1)));
    return {
      absenceClass: "discrete_terminal",
      terminalAbsenceAgeMonths: ageMonths,
      bodyPartClass: bodyPartClassOf(combined!.primaryInjury),
      spellCount,
      longestSpellWeeks,
      questionablePlayedRate,
    };
  }

  // Recurring: 2+ spells. Report the last spell's body part / age if it happens to be terminal (for
  // description only — the class multiplier does not condition on this for `recurring`).
  const ageMonths = isTerminal ? monthsBetween(approxWeekDate(season, combined!.firstMissedWeek), new Date(Date.UTC(nextSeason, 8, 1))) : null;
  return {
    absenceClass: "recurring",
    terminalAbsenceAgeMonths: ageMonths,
    bodyPartClass: isTerminal ? bodyPartClassOf(combined!.primaryInjury) : null,
    spellCount,
    longestSpellWeeks,
    questionablePlayedRate,
  };
}

/* ---------------------------------------------------------------------------------------------
 * MAIN — assembles one row per (label season, veteran player), QB/RB/WR/TE only.
 * ------------------------------------------------------------------------------------------- */

export interface FeatureRow {
  readonly season: number;
  readonly playerId: string;
  readonly position: Position;
  readonly age: number | null;
  readonly status: RosterStatus;
  readonly projectedSnapShare: number;
  readonly history: readonly { season: number; gamesPlayed: number; teamGames: number }[];
  readonly gamesPlayed: number; // THE LABEL: actual games played this season.
  readonly teamGames: number;
  readonly priorAbsence: AbsenceFeatures; // computed from season - 1, the model's own feature.
  readonly priorPriorHealthy: boolean; // season - 2 also healthy (gate 3's population test).
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") throw new Error(`${name} is not set.`);
  return value;
}

async function main(): Promise<void> {
  const db = createDb(requireEnv("DATABASE_URL"));
  const meta = await loadPlayersMeta();

  console.log(`Fetching games-played ground truth for seasons: ${NEEDED_GAMES_SEASONS.join(", ")}`);
  const gamesPlayedBySeason = new Map<number, Map<string, Set<number>>>();
  for (const season of NEEDED_GAMES_SEASONS) {
    if (season === 2019) {
      gamesPlayedBySeason.set(season, await playedWeeksFromSnapCounts(season, meta.pfrToGsis));
    } else if (season >= 2023 && season <= 2025) {
      // Prefer the database's own gsis-keyed feed for the seasons it fully carries (2023-2025);
      // avoids re-fetching a large external file for seasons already loaded.
      gamesPlayedBySeason.set(season, await playedWeeksFromDb(db, season));
    } else {
      const played = await playedWeeksFromStatsPlayerWeek(season);
      if (played === null) throw new Error(`stats_player_week is unexpectedly a gap for ${season}; add a fallback.`);
      gamesPlayedBySeason.set(season, played);
    }
  }

  // Position lookup: nflverse_roster_weeks' own `position` column, latest row per player-season.
  console.log("Loading roster-week rows (position, status) for all needed seasons...");
  const rosterSeasons = Array.from(new Set(ALL_LABEL_SEASONS.flatMap((s) => [s, s - 1, s - 2]))).sort((a, b) => a - b);
  const rosterRowsBySeason = new Map<number, readonly { week: number; player_id: string; status: string; status_detail: string; position: string }[]>();
  for (const season of rosterSeasons) {
    const rows = await db.execute(sql`
      select week, player_id, status, status_detail, position from nflverse_roster_weeks where season = ${season} order by week
    `);
    rosterRowsBySeason.set(season, rows as unknown as { week: number; player_id: string; status: string; status_detail: string; position: string }[]);
  }

  const positionByPlayerSeason = new Map<string, Position>(); // `${season}|${playerId}` -> position
  for (const [season, rows] of rosterRowsBySeason) {
    for (const row of rows) {
      if (!POSITIONS.includes(row.position as Position)) continue;
      positionByPlayerSeason.set(`${season}|${row.player_id}`, row.position as Position);
    }
  }

  // All injury rows for the seasons whose absence features feed a label season (season - 1, and
  // season - 2 for gate 3's "healthy in both of the prior two seasons" population test).
  const injurySeasons = Array.from(new Set(ALL_LABEL_SEASONS.flatMap((s) => [s - 1, s - 2])));
  const injuryRowsBySeason = new Map<number, Map<string, WeeklyInjuryReport[]>>();
  for (const season of injurySeasons) {
    const rows = await db.execute(sql`
      select week, player_id, report_status, primary_injury from nflverse_injuries where season = ${season} order by week
    `);
    const byPlayer = new Map<string, WeeklyInjuryReport[]>();
    for (const row of rows as unknown as { week: number; player_id: string; report_status: string; primary_injury: string }[]) {
      const list = byPlayer.get(row.player_id) ?? [];
      list.push({ week: row.week, reportStatus: row.report_status, primaryInjury: row.primary_injury });
      byPlayer.set(row.player_id, list);
    }
    injuryRowsBySeason.set(season, byPlayer);
  }
  const statusRowsBySeason = new Map<number, Map<string, WeeklyRosterStatus[]>>();
  for (const season of injurySeasons) {
    // `rosterSeasons` (built above) covers {s, s-1, s-2} for every label season, a superset of
    // `injurySeasons` ({s-1, s-2}), so the roster rows are always already loaded here.
    const rows = rosterRowsBySeason.get(season);
    if (rows === undefined) throw new Error(`Roster rows for ${season} were expected to already be loaded.`);
    const byPlayer = new Map<string, WeeklyRosterStatus[]>();
    for (const row of rows) {
      const list = byPlayer.get(row.player_id) ?? [];
      list.push({ week: row.week, status: row.status, statusDetail: row.status_detail });
      byPlayer.set(row.player_id, list);
    }
    statusRowsBySeason.set(season, byPlayer);
  }

  // Role-share proxy, per (season, position) — see `roleShareFromStatsPlayerWeek`'s docblock.
  console.log("Computing role-share proxies...");
  const roleShareBySeason = new Map<number, Map<string, number>>();
  for (const season of new Set(ALL_LABEL_SEASONS.map((s) => s - 1))) {
    if (season === 2019) {
      roleShareBySeason.set(season, await roleShareFromSnapCounts2019(meta.pfrToGsis));
    } else {
      roleShareBySeason.set(season, await roleShareFromStatsPlayerWeek(season));
    }
  }

  const rows: FeatureRow[] = [];
  for (const season of ALL_LABEL_SEASONS) {
    const priorSeason = season - 1;
    const priorPlayers = rosterRowsBySeason.get(priorSeason) ?? [];
    const veteranIds = new Set(priorPlayers.map((r) => r.player_id));
    const thisSeasonRoster = rosterRowsBySeason.get(season) ?? [];
    const week1Status = new Map<string, string>();
    for (const row of thisSeasonRoster) {
      if (!week1Status.has(row.player_id)) week1Status.set(row.player_id, row.status); // earliest row, ordered by week
    }

    const injByPlayer = injuryRowsBySeason.get(priorSeason) ?? new Map();
    const statusByPlayer = statusRowsBySeason.get(priorSeason) ?? new Map();
    const priorGamesIndex = gamesPlayedBySeason.get(priorSeason) ?? new Map();
    const roleShare = roleShareBySeason.get(priorSeason) ?? new Map();
    const gamesIndex = gamesPlayedBySeason.get(season)!;

    for (const playerId of veteranIds) {
      const position = positionByPlayerSeason.get(`${priorSeason}|${playerId}`) ?? positionByPlayerSeason.get(`${season}|${playerId}`);
      if (position === undefined) continue;
      const statusCode = week1Status.get(playerId);
      if (statusCode === undefined) continue; // not on a roster this season at all -> exclude.
      const status = rosterStatusOf(statusCode);

      const birthDate = meta.birthDateByGsis.get(playerId) ?? null;
      const age = ageAtSeason(birthDate, season);

      const history: FeatureRow["history"][number][] = [];
      for (let prior = season - HISTORY_SEASONS; prior <= season - 1; prior += 1) {
        const played = gamesPlayedBySeason.get(prior)?.get(playerId);
        if (played === undefined) continue;
        history.push({ season: prior, gamesPlayed: played.size, teamGames: teamGamesIn(prior) });
      }

      const priorAbsence = computeAbsenceFeatures(
        priorSeason,
        season,
        injByPlayer.get(playerId) ?? [],
        statusByPlayer.get(playerId) ?? [],
        priorGamesIndex.get(playerId) ?? new Set(),
      );

      // Gate 3's population test: also healthy in season - 2.
      const priorPriorSeason = season - 2;
      const priorPriorInj = injuryRowsBySeason.get(priorPriorSeason)?.get(playerId) ?? [];
      const priorPriorStatus = statusRowsBySeason.get(priorPriorSeason)?.get(playerId) ?? [];
      const priorPriorGames = gamesPlayedBySeason.get(priorPriorSeason)?.get(playerId);
      const priorPriorHealthy =
        priorPriorGames === undefined
          ? false
          : computeAbsenceFeatures(priorPriorSeason, priorSeason, priorPriorInj, priorPriorStatus, priorPriorGames).absenceClass === "healthy";

      rows.push({
        season,
        playerId,
        position,
        age,
        status,
        projectedSnapShare: roleShare.get(playerId) ?? 0,
        history,
        gamesPlayed: gamesIndex.get(playerId)?.size ?? 0,
        teamGames: teamGamesIn(season),
        priorAbsence,
        priorPriorHealthy,
      });
    }
  }

  if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(OUTPUT_PATH, JSON.stringify(rows, null, 2));
  console.log(`Wrote ${rows.length} player-season rows to ${OUTPUT_PATH}`);
  const byClass = new Map<string, number>();
  for (const row of rows) byClass.set(row.priorAbsence.absenceClass, (byClass.get(row.priorAbsence.absenceClass) ?? 0) + 1);
  console.log("Class counts (all seasons):", Object.fromEntries(byClass));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
