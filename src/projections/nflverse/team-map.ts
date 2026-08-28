import type { PlayerWeekTeam, TeamWeekObservation } from "../team-store";
import { NFLVERSE_CONFIG } from "./config";
import type { CsvRow } from "./csv";
import { gameDayAsOf } from "./map";
import type { PlayerUniverse } from "./players";

/**
 * TWO THINGS THE SNAP-COUNT FILE ALREADY CARRIES AND NOBODY WAS READING: which offence each player
 * was in, and who the five men in front of him were.
 *
 * Both come free with a download the engine already performs, which is the reason they are derived
 * here rather than from a roster feed. A roster is a CURRENT snapshot — the same defect that cost
 * Phase 1 ten points of resolution per season going backwards — while a snap count is a fact about
 * a Sunday that happened, and it dates itself.
 *
 * LINE CONTINUITY IS THE ONE PART OF THE OFFENSIVE LINE COMPOSITE THAT NEEDS NO PLAY-BY-PLAY. It is
 * also among the better-known predictors in the public literature: five men who have played
 * together communicate, and a line that has started a different five every week does not, whatever
 * the individual talent. It is pure participation data, which is exactly what this file is.
 */

export const CONTINUITY_SOURCE = "nflverse_line_continuity";

export const CONTINUITY_METRICS = {
  /** How many of this week's five offensive line starters also started the previous week (0 to 5). */
  sameStarters: "line_same_starters_as_previous_week",
  /** Distinct men who have started on the line this season so far. Lower is a settled line. */
  startersUsed: "line_starters_used_to_date",
} as const;

/**
 * The positions the snap-count file uses for offensive linemen.
 *
 * A set rather than a prefix match, because "T" is a tackle and "TE" is not, and a `startsWith`
 * would put every tight end on the line and make continuity a measurement of the passing game.
 */
const LINE_POSITIONS: ReadonlySet<string> = new Set(["T", "G", "C", "OL", "OT", "OG", "LT", "RT", "LG", "RG"]);

/** How many linemen start a play. Five, and it is the whole basis of the continuity measurement. */
const LINE_STARTERS = 5;

function numeric(row: CsvRow, column: string): number {
  const raw = row[column];
  const value = raw === undefined || raw.trim() === "" ? Number.NaN : Number(raw);
  if (!Number.isFinite(value)) {
    throw new Error(`nflverse snap-count row has no readable ${column} (got ${JSON.stringify(raw)}).`);
  }
  return value;
}

/**
 * Which offence each projected player was in, week by week.
 *
 * Narrowed to the positions the engine projects, matching `mapParticipation`: an edge for a player
 * who is never projected is a row nothing reads. Identity is the same id join, so a player the
 * universe cannot place is absent rather than guessed at — and absent is visible, because
 * `mapParticipation` reports the same people as unresolved from the same file.
 */
export function mapPlayerTeams(
  snapCounts: readonly CsvRow[],
  universe: PlayerUniverse,
  lagHours = NFLVERSE_CONFIG.publicationLagHours,
): readonly PlayerWeekTeam[] {
  const scored = snapCounts.filter(
    (row) =>
      row.game_type === NFLVERSE_CONFIG.seasonType &&
      (NFLVERSE_CONFIG.scoredPositions as readonly string[]).includes(row.position ?? ""),
  );
  const refs = scored.map((row) => ({ kind: "pfr" as const, id: row.pfr_player_id ?? "", name: row.player ?? "" }));
  const { resolved } = universe.resolveAll(refs);

  const edges: PlayerWeekTeam[] = [];
  for (const [index, row] of scored.entries()) {
    const playerId = resolved.get(refs[index]!.id);
    if (playerId === undefined) continue;
    edges.push({
      season: numeric(row, "season"),
      week: numeric(row, "week"),
      playerId,
      team: row.team ?? "",
      asOf: gameDayAsOf(row.pfr_game_id ?? "", lagHours),
    });
  }
  return edges;
}

/** One team's starting five for one week, and when that became knowable. */
interface WeeklyLine {
  readonly week: number;
  readonly starters: readonly string[];
  readonly asOf: Date;
}

/**
 * Each team's five most-used linemen per week, taken by snaps played.
 *
 * By SNAPS rather than by any start indicator, because the file carries no start indicator — and
 * snaps are the better measure anyway: a lineman who left in the first quarter did not really
 * start, and one who came in and played sixty snaps did, whatever the pre-game sheet said.
 */
function weeklyLines(snapCounts: readonly CsvRow[], lagHours: number): ReadonlyMap<string, readonly WeeklyLine[]> {
  const byTeamWeek = new Map<string, { snaps: { id: string; snaps: number }[]; asOf: Date; team: string; week: number }>();
  for (const row of snapCounts) {
    if (row.game_type !== NFLVERSE_CONFIG.seasonType) continue;
    if (!LINE_POSITIONS.has(row.position ?? "")) continue;
    const week = numeric(row, "week");
    const team = row.team ?? "";
    const key = `${team}|${week}`;
    const entry =
      byTeamWeek.get(key) ??
      byTeamWeek.set(key, { snaps: [], asOf: gameDayAsOf(row.pfr_game_id ?? "", lagHours), team, week }).get(key)!;
    entry.snaps.push({ id: row.pfr_player_id ?? row.player ?? "", snaps: numeric(row, "offense_snaps") });
  }

  const byTeam = new Map<string, WeeklyLine[]>();
  for (const entry of byTeamWeek.values()) {
    const starters = [...entry.snaps]
      .sort((a, b) => b.snaps - a.snaps || a.id.localeCompare(b.id))
      .slice(0, LINE_STARTERS)
      .map((lineman) => lineman.id);
    (byTeam.get(entry.team) ?? byTeam.set(entry.team, []).get(entry.team)!).push({
      week: entry.week,
      starters,
      asOf: entry.asOf,
    });
  }
  for (const lines of byTeam.values()) lines.sort((a, b) => a.week - b.week);
  return byTeam;
}

/**
 * Continuity as team-week observations, stamped when the week that produced them finished.
 *
 * Week 1 emits no `sameStarters` row: there is no previous week to compare against, and a zero
 * there would read as "five changes", which is the most alarming value the metric has. Absent is
 * the honest answer and the store preserves the difference.
 */
export function lineContinuityObservations(
  snapCounts: readonly CsvRow[],
  season: number,
  lagHours = NFLVERSE_CONFIG.publicationLagHours,
): readonly TeamWeekObservation[] {
  const rows: TeamWeekObservation[] = [];
  for (const [team, weeks] of weeklyLines(snapCounts, lagHours)) {
    const seen = new Set<string>();
    let previous: readonly string[] | null = null;
    for (const line of weeks) {
      for (const starter of line.starters) seen.add(starter);
      const stamp = { season, week: line.week, team, source: CONTINUITY_SOURCE, asOf: line.asOf } as const;
      if (previous !== null) {
        const carried = line.starters.filter((starter) => previous!.includes(starter)).length;
        rows.push({ ...stamp, metric: CONTINUITY_METRICS.sameStarters, value: carried });
      }
      rows.push({ ...stamp, metric: CONTINUITY_METRICS.startersUsed, value: seen.size });
      previous = line.starters;
    }
  }
  return rows.sort((a, b) => a.week - b.week || a.team.localeCompare(b.team) || a.metric.localeCompare(b.metric));
}
