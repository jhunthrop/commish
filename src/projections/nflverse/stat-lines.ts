import { STAT_FIELDS, type StatLine } from "@/domain/player";
import type { PlayerWeekObservation } from "../store";
import { NFLVERSE_CONFIG } from "./config";
import { crosswalkKey, type Crosswalk, type UnresolvedPlayer } from "./crosswalk";
import type { CsvRow } from "./csv";
import { NFLVERSE_SOURCE } from "./map";

/**
 * THE ACTUALS — what a player really did, which is the other half of every measurement the harness
 * makes. A projection with nothing to be scored against is not a projection, it is an opinion.
 *
 * These are `StatLine`s (`src/domain/player.ts`), the SAME type a projection is. The engine spec's
 * first decision is that a projection IS a predicted `StatLine`, composed into points through each
 * league's own scoring rules by `computeFantasyPoints` — so predictions and outcomes must be the
 * same shape or the comparison is between two different things. There is no parallel component
 * type here and there must never be one.
 *
 * These do not come from `player_stat_lines`, which is the live product's table and carries no
 * season and no `as_of`. A backtest that read the actuals from an unstamped table would be reading
 * corrected, final, end-of-season numbers into a mid-season replay, which is the leak in its
 * purest form.
 */

/** A `StatLine` plus the season it belongs to and the moment it became knowable. */
export interface SeasonStatLine {
  readonly season: number;
  /** `line.week` carries the week; `line.playerId` carries OUR id, already crosswalked. */
  readonly line: StatLine;
  readonly asOf: Date;
}

export interface MapStatLinesInput {
  readonly playerWeek: readonly CsvRow[];
  /** From `weekAsOfFromSnapCounts` — the weekly stats file carries no date of its own. */
  readonly weekAsOf: ReadonlyMap<number, Date>;
  readonly crosswalk: Crosswalk;
}

export interface MapStatLinesResult {
  readonly statLines: readonly SeasonStatLine[];
  readonly unresolved: readonly UnresolvedPlayer[];
  readonly resolutionRate: number | null;
}

/**
 * nflverse's column name for each `StatLine` field this mapper fills, or `null` for the fields it
 * deliberately leaves at zero.
 *
 * The defensive three (`sacks`, `defensiveInterceptions`, `defensiveTouchdowns`) are TEAM defence
 * stats in this product's scoring — our `players` table carries one synthetic `DEF` per NFL team —
 * while nflverse's `def_*` columns are per-PERSON, so a linebacker's two sacks would land on a
 * linebacker nobody can start. They are not the same quantity and mapping one onto the other would
 * be wrong rather than merely incomplete. The kicking two are absent for the plainer reason that
 * Phase 1 projects `QB/RB/WR/TE` only.
 *
 * Written as a total map over `STAT_FIELDS` rather than a partial one, so adding a stat field to
 * the domain fails to compile here instead of silently arriving as zero.
 */
const NFLVERSE_COLUMN: Readonly<Record<(typeof STAT_FIELDS)[number], readonly string[]>> = {
  passingYards: ["passing_yards"],
  passingTouchdowns: ["passing_tds"],
  interceptions: ["passing_interceptions"],
  rushingYards: ["rushing_yards"],
  rushingTouchdowns: ["rushing_tds"],
  receivingYards: ["receiving_yards"],
  receivingTouchdowns: ["receiving_tds"],
  receptions: ["receptions"],
  // One field, three upstream columns: nflverse records where the ball came loose, and a league's
  // rules charge the same points however it did.
  fumblesLost: ["sack_fumbles_lost", "rushing_fumbles_lost", "receiving_fumbles_lost"],
  fieldGoalsMade: [],
  extraPointsMade: [],
  sacks: [],
  defensiveInterceptions: [],
  defensiveTouchdowns: [],
};

/** nflverse leaves a stat blank rather than writing 0; blank means none, and none means zero here. */
function statValue(row: CsvRow, columns: readonly string[]): number {
  let total = 0;
  for (const column of columns) {
    const raw = row[column];
    if (raw === undefined || raw.trim() === "") continue;
    const value = Number(raw);
    if (!Number.isFinite(value)) {
      throw new Error(`nflverse weekly stats row has an unreadable ${column} (got ${JSON.stringify(raw)}).`);
    }
    total += value;
  }
  return total;
}

export function mapStatLines({ playerWeek, weekAsOf, crosswalk }: MapStatLinesInput): MapStatLinesResult {
  const scored = playerWeek.filter(
    (row) =>
      row.season_type === NFLVERSE_CONFIG.seasonType &&
      (NFLVERSE_CONFIG.scoredPositions as readonly string[]).includes(row.position ?? ""),
  );
  const candidates = scored.map((row) => ({
    name: row.player_display_name ?? "",
    position: row.position ?? "",
    team: row.team ?? "",
  }));
  const { resolved, unresolved, resolutionRate } = crosswalk.resolveAll(candidates);

  const statLines: SeasonStatLine[] = [];
  for (const [index, row] of scored.entries()) {
    const playerId = resolved.get(crosswalkKey(candidates[index]!));
    if (playerId === undefined) continue;
    const week = Number(row.week);
    const asOf = weekAsOf.get(week);
    // Throws rather than defaulting to a stamp of its own: a fact whose as-of we had to invent is
    // exactly the fact that later turns out to have leaked, and the caller (which holds the snap
    // counts this map is built from) can always supply a real one.
    if (asOf === undefined) {
      throw new Error(`No as-of is known for ${row.season} week ${week}; the week's snap counts are missing.`);
    }
    statLines.push({
      season: Number(row.season),
      asOf,
      line: {
        playerId,
        week,
        ...(Object.fromEntries(
          STAT_FIELDS.map((field) => [field, statValue(row, NFLVERSE_COLUMN[field])]),
        ) as Omit<StatLine, "playerId" | "week">),
      },
    });
  }
  return { statLines, unresolved, resolutionRate };
}

/** `passingYards` → `passing_yards`. The store's metric names are snake_case throughout. */
function metricName(field: string): string {
  return field.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

/**
 * Flattens actuals into store rows — every stat field, including the zeros.
 *
 * Zeros are written here, unlike the participation mapper's `routes_run`, and the difference is
 * real: nflverse publishing a blank `receiving_yards` for a quarterback is a positive statement
 * that he gained none, whereas routes run is simply not published at all. One is knowledge, the
 * other is absence, and the store must be able to tell them apart.
 */
export function statLineObservations(rows: readonly SeasonStatLine[]): readonly PlayerWeekObservation[] {
  return rows.flatMap(({ season, line, asOf }) =>
    STAT_FIELDS.map((field) => ({
      season,
      week: line.week,
      playerId: line.playerId,
      source: NFLVERSE_SOURCE.playerWeek,
      metric: metricName(field),
      value: line[field],
      asOf,
    })),
  );
}
