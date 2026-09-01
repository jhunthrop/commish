// Validates data/win-totals/win-totals.csv against four independent claims: every season carries
// exactly the canonical 32 teams, every win total and price looks like a real market line, every
// source_date strictly precedes the season's first kickoff, and every actual_wins value matches
// the schedule store's own regular-season record for a completed season.
//
// Run: npm run projections:win-totals:validate
// (dotenv -e .env.local -- tsx scripts/validate-win-totals.ts)
//
// The pure checks below take already-resolved ground truth (a team list, a kickoff lookup, an
// expected-wins map) as plain arguments rather than reaching for the database or the network
// themselves, so `validate-win-totals.test.ts` can drive them from fixture rows with no I/O at
// all. `main()` is the only place that touches Postgres or fetches nflverse's schedule file.
import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { createDb, type ReadonlyDb } from "@/db/client";
import { teamWeekObservations } from "@/db/schema";
import { firstKickoffFor } from "@/projections/team-store";
import { finalWeekOf, nflTeamsBySeason } from "@/projections/nflverse/team-eras";
import { mapSchedule, SCHEDULE_SOURCE, SCHEDULE_SOURCE_CONFIG, type TeamGame } from "@/projections/nflverse/schedule";
import { createNflverseClient } from "@/projections/nflverse/client";
import { parseCsv } from "@/projections/nflverse/csv";

export const WIN_TOTALS_CSV_PATH = "data/win-totals/win-totals.csv";
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
  /** `null`, never `0` — a season with no recorded wins is unknown, not winless. */
  readonly actualWins: number | null;
  readonly source: string;
  readonly sourceDate: string;
}

export interface Violation {
  readonly kind: string;
  readonly message: string;
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

/**
 * Check (a): every named season carries exactly its canonical 32 teams, no duplicate, no
 * substitute, no extra. `teamsForSeason` is injected so the fixture suite never has to reproduce
 * the real relocation history to prove the check works.
 */
export function checkRowCounts(
  rows: readonly WinTotalRow[],
  seasons: readonly number[],
  teamsForSeason: (season: number) => readonly string[],
): readonly Violation[] {
  const bySeasonTeams = new Map<number, string[]>();
  for (const row of rows) {
    const list = bySeasonTeams.get(row.season) ?? [];
    list.push(row.team);
    bySeasonTeams.set(row.season, list);
  }
  const violations: Violation[] = [];
  for (const season of seasons) {
    const teams = bySeasonTeams.get(season) ?? [];
    const expected = new Set(teamsForSeason(season));
    if (teams.length !== expected.size) {
      violations.push({ kind: "row_count", message: `${season}: ${teams.length} rows, expected ${expected.size}.` });
      continue;
    }
    const actual = new Set(teams);
    if (actual.size !== teams.length) {
      violations.push({ kind: "duplicate_team", message: `${season}: the ${teams.length} rows repeat at least one team code.` });
    }
    const missing = [...expected].filter((team) => !actual.has(team));
    const extra = [...actual].filter((team) => !expected.has(team));
    if (missing.length > 0 || extra.length > 0) {
      violations.push({
        kind: "team_set_mismatch",
        message: `${season}: team codes do not match the canonical 32 for that season; missing ${missing.join(", ") || "none"}, unexpected ${extra.join(", ") || "none"}.`,
      });
    }
  }
  return violations;
}

/** Check (b): win_total in [0, 17], and both prices look like American odds. */
export function checkRanges(rows: readonly WinTotalRow[]): readonly Violation[] {
  const violations: Violation[] = [];
  for (const row of rows) {
    if (!(row.winTotal >= 0 && row.winTotal <= 17)) {
      violations.push({ kind: "win_total_range", message: `${row.season} ${row.team}: win_total ${row.winTotal} is outside 0 to 17.` });
    }
    for (const [label, price] of [
      ["over_price", row.overPrice],
      ["under_price", row.underPrice],
    ] as const) {
      if (!Number.isInteger(price) || Math.abs(price) < 100) {
        violations.push({ kind: "price_format", message: `${row.season} ${row.team}: ${label} ${price} does not read as American odds.` });
      }
    }
  }
  return violations;
}

export interface KickoffInfo {
  readonly kickoff: Date;
  /** `true` when this is the documented early-September convention rather than a real store kickoff. */
  readonly conventional: boolean;
}

/** Check (d): source_date parses, and strictly precedes the season's first kickoff. */
export function checkSourceDates(rows: readonly WinTotalRow[], kickoffFor: (season: number) => KickoffInfo): readonly Violation[] {
  const violations: Violation[] = [];
  for (const row of rows) {
    const parsed = new Date(row.sourceDate);
    if (Number.isNaN(parsed.getTime())) {
      violations.push({ kind: "source_date_unparseable", message: `${row.season} ${row.team}: source_date "${row.sourceDate}" does not parse.` });
      continue;
    }
    const info = kickoffFor(row.season);
    if (parsed.getTime() >= info.kickoff.getTime()) {
      const basis = info.conventional ? "the conventional early-September season start" : "the season's first kickoff";
      violations.push({
        kind: "source_date_not_before_kickoff",
        message: `${row.season} ${row.team}: source_date ${row.sourceDate} does not strictly precede ${basis} (${info.kickoff.toISOString()}).`,
      });
    }
  }
  return violations;
}

/**
 * Check (c): actual_wins matches the store's schedule-derived record exactly, every team, never
 * averaged into a pass rate. `expectedWins` keys are `${season}|${team}`; a `null` value means
 * "this season is not complete or not covered, actual_wins must be empty"; a missing key means no
 * ground truth exists for that row at all and it is not checked.
 */
export function checkActualWins(rows: readonly WinTotalRow[], expectedWins: ReadonlyMap<string, number | null>): readonly Violation[] {
  const violations: Violation[] = [];
  for (const row of rows) {
    const key = `${row.season}|${row.team}`;
    if (!expectedWins.has(key)) continue;
    const expected = expectedWins.get(key) ?? null;
    if (expected === null) {
      if (row.actualWins !== null) {
        violations.push({
          kind: "actual_wins_unexpected",
          message: `${row.season} ${row.team}: actual_wins is ${row.actualWins} but that season is not complete or not covered by the store; expected empty.`,
        });
      }
      continue;
    }
    if (row.actualWins === null) {
      violations.push({
        kind: "actual_wins_missing",
        message: `${row.season} ${row.team}: actual_wins is empty but the store-derived record is ${expected}.`,
      });
    } else if (row.actualWins !== expected) {
      violations.push({
        kind: "actual_wins_mismatch",
        message: `${row.season} ${row.team}: actual_wins is ${row.actualWins} but the store-derived record is ${expected}.`,
      });
    }
  }
  return violations;
}

/** Regular-season games one team plays in `season`: one fewer than the week count, for the bye. */
export function regularSeasonGamesPerTeam(season: number): number {
  return finalWeekOf(season) - 1;
}

/** Regular-season win total from a set of games, counting a tie as half a win. `null` when the
 *  team's regular season is not yet complete (fewer completed games than the season requires). */
export function computeSeasonWins(games: readonly TeamGame[], season: number, team: string): number | null {
  const played = games.filter((g) => g.season === season && g.team === team && g.pointsFor !== null && g.pointsAgainst !== null);
  if (played.length !== regularSeasonGamesPerTeam(season)) return null;
  let wins = 0;
  for (const game of played) {
    if (game.pointsFor! > game.pointsAgainst!) wins += 1;
    else if (game.pointsFor === game.pointsAgainst) wins += 0.5;
  }
  return wins;
}

/** Every season the store confirms it has ingested schedule data for, ascending. */
export async function seasonsWithScheduleCoverage(db: ReadonlyDb): Promise<readonly number[]> {
  const rows = await db
    .selectDistinctOn([teamWeekObservations.season], { season: teamWeekObservations.season })
    .from(teamWeekObservations)
    .where(eq(teamWeekObservations.source, SCHEDULE_SOURCE.schedule))
    .orderBy(teamWeekObservations.season);
  return rows.map((r) => r.season);
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`${name} is not set. Run this through \`npm run projections:win-totals:validate\`, which loads .env.local.`);
  }
  return value;
}

async function main(): Promise<void> {
  const text = readFileSync(WIN_TOTALS_CSV_PATH, "utf8");
  const rows = parseWinTotalsCsv(text);
  console.log(`Loaded ${rows.length} rows from ${WIN_TOTALS_CSV_PATH} across seasons ${WIN_TOTALS_SEASONS[0]} to ${WIN_TOTALS_SEASONS.at(-1)}.`);

  const db = createDb(requireEnv("DATABASE_URL"));

  const rowCountViolations = checkRowCounts(rows, WIN_TOTALS_SEASONS, nflTeamsBySeason);
  const rangeViolations = checkRanges(rows);

  const coveredSeasons = new Set(await seasonsWithScheduleCoverage(db));
  console.log(`Store schedule coverage: seasons ${[...coveredSeasons].sort((a, b) => a - b).join(", ") || "none"}.`);

  const kickoffCache = new Map<number, KickoffInfo>();
  for (const season of WIN_TOTALS_SEASONS) {
    if (coveredSeasons.has(season)) {
      const kickoff = await firstKickoffFor(db, season);
      if (kickoff !== null) {
        kickoffCache.set(season, { kickoff, conventional: false });
        continue;
      }
    }
    // No store kickoff for this season (before the store's coverage began, or a season the store
    // has schedule metadata for but no week-1 kickoff row). Fall back to a conservative, documented
    // convention: NFL regular seasons in this span never opened before September 1.
    kickoffCache.set(season, { kickoff: new Date(Date.UTC(season, 8, 1)), conventional: true });
  }
  const sourceDateViolations = checkSourceDates(rows, (season) => {
    const info = kickoffCache.get(season);
    if (info === undefined) throw new Error(`No kickoff basis computed for season ${season}; this is a validator bug.`);
    return info;
  });

  console.log("Fetching nflverse's schedule file to derive regular-season wins...");
  const scheduleClient = createNflverseClient({ baseUrl: SCHEDULE_SOURCE_CONFIG.baseUrl });
  const scheduleRows = await scheduleClient.getCsv(SCHEDULE_SOURCE_CONFIG.release, SCHEDULE_SOURCE_CONFIG.file);
  const games = mapSchedule(scheduleRows, [...coveredSeasons]);

  const expectedWins = new Map<string, number | null>();
  for (const season of WIN_TOTALS_SEASONS) {
    const teams = nflTeamsBySeason(season);
    for (const team of teams) {
      const key = `${season}|${team}`;
      expectedWins.set(key, coveredSeasons.has(season) ? computeSeasonWins(games, season, team) : null);
    }
  }
  const actualWinsViolations = checkActualWins(rows, expectedWins);

  await db.$client.end();

  const allViolations = [...rowCountViolations, ...rangeViolations, ...sourceDateViolations, ...actualWinsViolations];
  console.log("");
  console.log(`Row count and team-set check: ${rowCountViolations.length} violation(s).`);
  console.log(`Win total and price range check: ${rangeViolations.length} violation(s).`);
  console.log(`source_date precedes kickoff check: ${sourceDateViolations.length} violation(s).`);
  console.log(`actual_wins matches the store check: ${actualWinsViolations.length} violation(s).`);
  console.log("");

  if (allViolations.length === 0) {
    console.log(`PASS: all ${rows.length} rows across ${WIN_TOTALS_SEASONS.length} seasons validated clean.`);
    return;
  }

  console.log(`FAIL: ${allViolations.length} violation(s) found.`);
  for (const violation of allViolations) {
    console.log(`  [${violation.kind}] ${violation.message}`);
  }
  process.exitCode = 1;
}

if (process.argv[1] !== undefined && process.argv[1].endsWith("validate-win-totals.ts")) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
