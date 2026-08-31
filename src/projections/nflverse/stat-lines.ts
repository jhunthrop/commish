import { STAT_FIELDS, type StatLine } from "@/domain/player";
import { statMetricName, type SeasonStatLine } from "../lines";
import type { PlayerWeekObservation } from "../store";
import { NFLVERSE_CONFIG } from "./config";
import type { CsvRow } from "./csv";
import { NFLVERSE_SOURCE } from "./map";
import { projectedPosition, type PlayerRef, type PlayerUniverse, type UnresolvedRef } from "./players";

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

/** `SeasonStatLine` (`../lines`) is the shape both the writer here and the store's reader use —
 *  one definition, so a mapper and a backtest can never disagree about what an outcome looks like. */
export type { SeasonStatLine };

/**
 * Seasons inside the laws harness's measurement window whose PUBLISHED weekly stats file nflverse
 * never released — `stats_player_week_2019.csv` is a deterministic 404, not a transient failure.
 *
 * NAMED HERE, beside the mapper it describes, rather than in `laws/config.ts` (the harness's own
 * fixed-constants file, and the brief's other sanctioned home): this is a fact about THIS mapper's
 * own upstream release, not a laws-harness tuning knob, and keeping it here avoids a real import
 * cycle. `derived-stat-lines.ts` (which fills exactly these seasons from play-by-play) already has a
 * one-way runtime dependency on `../lines` for `statLinesAsOf`/`STAT_LINE_SOURCE`; if this list lived
 * in `laws/config.ts` instead, `derived-stat-lines.ts`'s admission wrapper would need to import
 * `laws/config.ts` too — pulling the laws harness's own directory into an nflverse ingestion module,
 * a layering inversion nowhere else in this codebase makes (`laws/*` depends on `nflverse/*`, never
 * the reverse). Living here, `derived-stat-lines.ts` only ever reaches sideways within `nflverse/`.
 *
 * ONE EXPORTED HOME (controller ruling P1): `measure-laws.ts` imports this constant rather than
 * keeping its own copy, and `derived-stat-lines.ts`'s admission wrapper reads the same list — so the
 * seasons the laws harness treats as a hole and the seasons the derivation exists to fill can never
 * drift apart.
 */
export const STAT_LINE_GAPS: readonly number[] = [2019];

export interface MapStatLinesInput {
  readonly playerWeek: readonly CsvRow[];
  /** From `weekAsOfFromSnapCounts` — the weekly stats file carries no date of its own. */
  readonly weekAsOf: ReadonlyMap<number, Date>;
  /** The historical player universe — `players.ts`. The weekly file carries `player_id` (gsis). */
  readonly universe: PlayerUniverse;
}

export interface MapStatLinesResult {
  readonly statLines: readonly SeasonStatLine[];
  readonly unresolved: readonly UnresolvedRef[];
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

export function mapStatLines({ playerWeek, weekAsOf, universe }: MapStatLinesInput): MapStatLinesResult {
  const scored = playerWeek.filter(
    (row) =>
      row.season_type === NFLVERSE_CONFIG.seasonType &&
      (NFLVERSE_CONFIG.scoredPositions as readonly string[]).includes(row.position ?? ""),
  );
  const refs: readonly PlayerRef[] = scored.map((row) => ({
    kind: "gsis" as const,
    id: row.player_id ?? "",
    name: row.player_display_name ?? "",
  }));
  const { resolved, unresolved, resolutionRate } = universe.resolveAll(refs);

  const statLines: SeasonStatLine[] = [];
  for (const [index, row] of scored.entries()) {
    const playerId = resolved.get(refs[index]!.id);
    if (playerId === undefined) continue;
    // The universe's position governs, exactly as in `mapParticipation`: an outcome stored for a
    // player the backtest cannot score is a row nothing will ever read.
    if (projectedPosition(universe.byGsisId(playerId)!.position) === null) continue;
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
      metric: statMetricName(field),
      value: line[field],
      asOf,
    })),
  );
}
