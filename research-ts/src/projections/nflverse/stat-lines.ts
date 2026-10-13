import { STAT_FIELDS, type StatLine } from "@research-ts/domain/player";
import { statMetricName, type SeasonStatLine } from "../lines";
import type { PlayerWeekObservation } from "../store";
import { NFLVERSE_CONFIG } from "./config";
import type { CsvRow } from "./csv";
import { NFLVERSE_SOURCE } from "./map";
import { isProjectedCandidate, type PlayerRef, type PlayerUniverse, type UnresolvedRef } from "./players";

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
 * own upstream release, not a laws-harness tuning knob.
 *
 * THE REAL REASON, CORRECTED (fix round, M2): an earlier version of this note claimed the choice
 * "avoids a real import cycle" — that was overclaimed. `laws/config.ts` has no imports of its own
 * today, so `derived-stat-lines.ts` importing it would not create a cycle in the literal sense (A
 * imports B imports A). The actual reason is a LAYERING INVERSION: every dependency between `laws/`
 * and `nflverse/` in this codebase runs one way, `laws/*` depending on `nflverse/*` (`populations.ts`
 * imports `nflverse/pbp.ts`, `nflverse/coaches.ts`, `nflverse/schedule.ts`, and now
 * `nflverse/derived-stat-lines.ts` itself). If this list lived in `laws/config.ts`,
 * `derived-stat-lines.ts` — an nflverse ingestion module — would need to import FROM `laws/`, the one
 * direction nothing else in the codebase goes. That is a convention this codebase keeps on purpose
 * (an ingestion adapter should not need to know the harness built on top of it exists), not an
 * accident of the module graph avoiding an accidental cycle.
 *
 * ONE EXPORTED HOME (controller ruling P1): `measure-laws.ts` imports this constant rather than
 * keeping its own copy, and `derived-stat-lines.ts`'s admission wrapper reads the same list — so the
 * seasons the laws harness treats as a hole and the seasons the derivation exists to fill can never
 * drift apart.
 *
 * 2025 ADDED (live-board Task 1). Checked live against the nflverse release on 2026-09-01:
 * `stats_player_week_2025.csv` is still a 404 (re-checked from the 2026-08-28 research note in
 * `docs/research/2026-08-28-live-season.md`, which found the same thing four days earlier), while
 * `play_by_play_2025.csv` and `snap_counts_2025.csv` are both published. Unlike 2019 — a season with
 * a published year on both sides of it — 2025 is the CURRENT season and has no published twin of its
 * own to validate against directly; `MEASURE_SEASONS` (`laws/config.ts`) ends its predictor window at
 * 2024, so admitting 2025 here changes nothing any drift guard measures until a future round moves
 * that window. `scripts/projection-backfill.ts`'s gap-season branch derives 2025 exactly as it
 * derives 2019, gated by the SAME `MINIMUM_AGREEMENT` bar measured against the SAME fixed control
 * season (2018) — that bar proves the DERIVATION METHOD is trustworthy, not that any one gap season's
 * own numbers are; for a season with no published twin, `derivedSeasonSanityReport`
 * (`derived-stat-lines.ts`) is what the backfill prints instead of a fabricated agreement number.
 * 2003-2012 AUDITED AND NOT ADDED (discovery-expansion Task 1). The history extension asked whether
 * those ten seasons needed the derivation the way 2019 and 2025 do. They do not: a per-season `HEAD`
 * against the release on 2026-09-01 found `stats_player_week_YYYY.csv` published, 200, for every
 * season 2003 through 2012, with the identical column set 2024 carries. Published beats derived per
 * season, so all ten are ingested from the published feed and this list does not grow. What those
 * seasons lack is the OTHER file: `snap_counts_2011.csv` and older are 404s and
 * `snap_counts_2012.csv` is published with zero data rows, which is `SNAP_COUNT_ASSET_FLOOR`
 * (`map.ts`) and a different hole with a different branch — see `ingest.ts`'s own top-of-file note
 * on why the two are not folded together.
 */
export const STAT_LINE_GAPS: readonly number[] = [2019, 2025];

/**
 * THE LIVE-ADMISSION SEAM — which `STAT_LINE_GAPS` seasons a PRODUCT-FACING live board (the live-board
 * plan's Task 4) is allowed to admit derived rows for. Named and documented here, beside
 * `STAT_LINE_GAPS`.
 *
 * ITS ONE READER is `preseason/source.ts`'s `admitsDerivedPriorSeason`, which every read in
 * `loadPreseason` that consumes `season - 1` asks — the law facts, the discovery facts, the model's
 * outcome history and its opportunity counts alike. (An earlier version of this docblock said
 * "consumed nowhere yet"; that was true when the shape was decided and false the moment Task 4
 * landed. The final fix round then widened the reader from the law facts alone to the whole
 * prior-season read, which is what makes "one answer per board" true rather than aspirational.)
 *
 * NOT THE SAME SET AS `STAT_LINE_GAPS`, ON PURPOSE. `STAT_LINE_GAPS` answers "does nflverse publish a
 * weekly stats file for this season" and exists to keep the laws harness's historical BACKTEST
 * measurement whole — `laws/populations.ts`'s `admitDerived: true` reads every gap season in that list
 * indiscriminately, 2019 included, because a backtest is allowed to read any season it has validated
 * derivation for. A live board is a different kind of reader: it renders derived numbers to a real
 * manager, for the season a league is actually playing right now. 2019 has no business reaching that
 * surface — it is eleven-plus-year-old history whose only job is filling a hole in a historical
 * measurement, never something a manager opens a player screen and sees a "live" number for. Reusing
 * `STAT_LINE_GAPS` as the live gate would silently let 2019 through the day someone re-ran a
 * `2015..2019` backfill and forgot the distinction existed.
 *
 * THE SHAPE, DECIDED HERE FOR TASK 4: an explicit allowlist, not a boolean flag threaded through
 * `statLinesAsOfForMeasurement`/`seasonScoring`. A live board's own moment (`BoardMoment`, Task 2) is
 * expected to call a seam that checks `LIVE_ADMITTED_DERIVED_SEASONS.includes(season)` before ever
 * reading `DERIVED_STAT_LINE_SOURCE` for a season, the same shape `laws/populations.ts`'s
 * `admitDerived: boolean` already established for the backtest reader — except keyed per season
 * rather than per caller, because "safe for a live board" and "safe for the laws harness" are
 * different questions with different answers for the same season list. Growing this list (a future
 * season nflverse again fails to publish, mid-season) is a one-line addition here, reviewed on its own
 * merits, never an automatic consequence of a season landing in `STAT_LINE_GAPS`.
 */
export const LIVE_ADMITTED_DERIVED_SEASONS: readonly number[] = [2025];

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
  // ONE NARROWING, and the universe owns it — see `isProjectedCandidate` for the 4,828 skill
  // player-weeks the old file-spelling gate was dropping before the universe was ever consulted.
  // Row and ref are collected together so their indices cannot drift apart.
  const scored: CsvRow[] = [];
  const refs: PlayerRef[] = [];
  for (const row of playerWeek) {
    if (row.season_type !== NFLVERSE_CONFIG.seasonType) continue;
    const ref: PlayerRef = { kind: "gsis", id: row.player_id ?? "", name: row.player_display_name ?? "" };
    if (!isProjectedCandidate(universe, ref, row.position)) continue;
    scored.push(row);
    refs.push(ref);
  }
  const { resolved, unresolved, resolutionRate } = universe.resolveAll(refs);

  const statLines: SeasonStatLine[] = [];
  for (const [index, row] of scored.entries()) {
    const playerId = resolved.get(refs[index]!.id);
    // Unresolved people are NOT silently skipped — they are on `unresolved`, named and counted.
    // There is no second position check after this one: `isProjectedCandidate` already asked the
    // universe about everyone the universe knows, and everyone who resolved is by definition one of
    // them.
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
