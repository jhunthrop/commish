import { and, asc, inArray } from "drizzle-orm";
import type { ReadonlyDb } from "@/db/client";
import { nflverseInjuries, nflverseRosterWeeks } from "@/db/schema";
import type { SeasonAvailability } from "@/projections/preseason/availability";
import type { WeeklyInjuryReport, WeeklyRosterStatus } from "./season-end";
import { classifySeasonWeeks } from "./week-classification";

/**
 * ONE PLAYER-SEASON'S AVAILABILITY RECORD, built from the three stores that together say what he
 * did each week: `player_week_observations` for the weeks he played (the caller's own point-in-time
 * read), and the two designation archives, `nflverse_roster_weeks` (the census) and
 * `nflverse_injuries` (the report), for the weeks he could not have played. The classification
 * itself is `week-classification.ts`; this module only reads the two archives for a whole
 * population and shapes the answer into the `SeasonAvailability` the preseason model consumes.
 *
 * NO `as_of` GATE ON THE ARCHIVES, deliberately, matching `season-end.ts`'s own reads: a designation
 * about a COMPLETED prior season is a retrospective fact, and nothing here ever reads the season
 * being projected. The played weeks still come through the caller's gated read.
 */

type BySeasonByPlayer<T> = ReadonlyMap<number, ReadonlyMap<string, readonly T[]>>;

interface SeasonPlayerKeyed {
  readonly season: number;
  readonly playerId: string;
}

function groupBySeasonAndPlayer<T extends SeasonPlayerKeyed, S>(
  seasons: readonly number[],
  rows: readonly T[],
  shape: (row: T) => S,
): Map<number, Map<string, S[]>> {
  const out = new Map<number, Map<string, S[]>>(seasons.map((season) => [season, new Map<string, S[]>()]));
  for (const row of rows) {
    const bySeason = out.get(row.season);
    if (bySeason === undefined) continue;
    const list = bySeason.get(row.playerId) ?? [];
    list.push(shape(row));
    bySeason.set(row.playerId, list);
  }
  return out;
}

/**
 * Which of these seasons BOTH archives hold at least one row for. A season only one archive covers
 * is uncovered: the roster alone cannot see an `Out` week on an active roster, and the report alone
 * cannot see a man who vanished onto injured reserve (`schema.ts`'s `nflverseRosterWeeks` docblock).
 */
export async function availabilityStoreCoverage(db: ReadonlyDb, seasons: readonly number[]): Promise<ReadonlySet<number>> {
  if (seasons.length === 0) return new Set();
  const [rosterSeasons, injurySeasons] = await Promise.all([
    db
      .select({ season: nflverseRosterWeeks.season })
      .from(nflverseRosterWeeks)
      .where(inArray(nflverseRosterWeeks.season, [...seasons]))
      .groupBy(nflverseRosterWeeks.season),
    db
      .select({ season: nflverseInjuries.season })
      .from(nflverseInjuries)
      .where(inArray(nflverseInjuries.season, [...seasons]))
      .groupBy(nflverseInjuries.season),
  ]);
  const withReports = new Set(injurySeasons.map((row) => row.season));
  return new Set(rosterSeasons.map((row) => row.season).filter((season) => withReports.has(season)));
}

/** Every archived roster week for these seasons, keyed by season then player, in week order. Every
 *  requested season is present, empty when the archive holds nothing for it. */
export async function rosterWeeksBySeason(db: ReadonlyDb, seasons: readonly number[]): Promise<BySeasonByPlayer<WeeklyRosterStatus>> {
  if (seasons.length === 0) return new Map();
  const rows = await db
    .select({
      season: nflverseRosterWeeks.season,
      week: nflverseRosterWeeks.week,
      playerId: nflverseRosterWeeks.playerId,
      status: nflverseRosterWeeks.status,
      statusDetail: nflverseRosterWeeks.statusDetail,
    })
    .from(nflverseRosterWeeks)
    .where(and(inArray(nflverseRosterWeeks.season, [...seasons])))
    .orderBy(asc(nflverseRosterWeeks.week));
  return groupBySeasonAndPlayer(seasons, rows, (row) => ({ week: row.week, status: row.status, statusDetail: row.statusDetail }));
}

/** Every archived report row for these seasons, same shape and same guarantee. */
export async function injuryReportsBySeason(db: ReadonlyDb, seasons: readonly number[]): Promise<BySeasonByPlayer<WeeklyInjuryReport>> {
  if (seasons.length === 0) return new Map();
  const rows = await db
    .select({ season: nflverseInjuries.season, week: nflverseInjuries.week, playerId: nflverseInjuries.playerId, reportStatus: nflverseInjuries.reportStatus, primaryInjury: nflverseInjuries.primaryInjury })
    .from(nflverseInjuries)
    .where(and(inArray(nflverseInjuries.season, [...seasons])))
    .orderBy(asc(nflverseInjuries.week));
  return groupBySeasonAndPlayer(seasons, rows, (row) => ({ week: row.week, reportStatus: row.reportStatus, primaryInjury: row.primaryInjury }));
}

/** One season's evidence for a whole population, before it is shaped into records. */
export interface SeasonRecordInput {
  readonly season: number;
  readonly teamGames: number;
  /** Whether both archives cover the season (`availabilityStoreCoverage`). */
  readonly covered: boolean;
  /** Weeks each player has a played row for, from the caller's own gated read. */
  readonly playedWeeks: ReadonlyMap<string, readonly number[]>;
  readonly rosterRows: ReadonlyMap<string, readonly WeeklyRosterStatus[]>;
  readonly injuryRows: ReadonlyMap<string, readonly WeeklyInjuryReport[]>;
}

/**
 * The season's `SeasonAvailability` per player. A player with no played week and no unavailable
 * week has NO record for the season: a practice-squad year or a season on nobody's roster says
 * nothing about his availability, and an empty record would be counted as a season of evidence.
 * On an uncovered season the roster archive is not consulted at all, so only players with a played
 * week appear, each with `gamesUnavailable: null`.
 */
export function seasonAvailabilityRecords(input: SeasonRecordInput): ReadonlyMap<string, SeasonAvailability> {
  const rosterPlayers = input.covered ? [...input.rosterRows.keys()] : [];
  const players = new Set([...input.playedWeeks.keys(), ...rosterPlayers]);
  const records = new Map<string, SeasonAvailability>();
  for (const playerId of players) {
    const gamesPlayedWeeks = input.playedWeeks.get(playerId) ?? [];
    const gamesUnavailable = input.covered
      ? classifySeasonWeeks({ rosterRows: input.rosterRows.get(playerId) ?? [], injuryRows: input.injuryRows.get(playerId) ?? [], gamesPlayedWeeks }).unavailableWeeks.length
      : null;
    const gamesPlayed = new Set(gamesPlayedWeeks).size;
    if (gamesPlayed === 0 && (gamesUnavailable ?? 0) === 0) continue;
    // Capped at the team's games: the census omits bye weeks (32 clubs times 17 team-weeks in the
    // real 2025 file), but a man traded across two clubs' byes can be rostered for eighteen.
    const capped = gamesUnavailable === null ? null : Math.min(gamesUnavailable, input.teamGames);
    records.set(playerId, { season: input.season, gamesPlayed, teamGames: input.teamGames, gamesUnavailable: capped });
  }
  return records;
}
