import { STAT_FIELDS, type StatLine } from "@research/domain/player";
import type { ReadonlyDb } from "@research/db/client";
import { NFLVERSE_SOURCE } from "./nflverse/map";
import { observationsAsOf, type ObservationQuery } from "./store";

/**
 * READING A `StatLine` BACK OUT OF THE POINT-IN-TIME STORE.
 *
 * The engine's first design decision is that a projection IS a predicted `StatLine`
 * (`src/domain/player.ts`), composed into points through each league's own rules by
 * `computeFantasyPoints`. That only pays off if the OUTCOMES are the same type, so this is where
 * the store's narrow rows become the wide shape both halves of a comparison share.
 *
 * It deliberately does NOT read `player_stat_lines`, the live product's table, even though that
 * table holds the same numbers in the same shape. That table carries no season and no `as_of`: a
 * backtest reading actuals from it would be reading final, corrected, end-of-season figures into a
 * mid-season replay. That is leakage in its purest form, and it is available one import away, which
 * is exactly why this note is here.
 */

/** The source stamp an actual outcome carries. Features live under other sources. */
export const STAT_LINE_SOURCE: string = NFLVERSE_SOURCE.playerWeek;

/**
 * `receivingYards` → `receiving_yards`. Exported so the writer (`nflverse/stat-lines.ts`) and this
 * reader cannot drift: a metric written under one spelling and read under another does not error,
 * it silently returns zeros, and a whole season of receiving yards would quietly become nothing.
 */
export function statMetricName(field: string): string {
  return field.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

/** A `StatLine` with the season it belongs to and the moment it became knowable. */
export interface SeasonStatLine {
  readonly season: number;
  readonly line: StatLine;
  /** The latest `as_of` among the components — a corrected line is dated by its correction. */
  readonly asOf: Date;
}

const FIELD_BY_METRIC = new Map(STAT_FIELDS.map((field) => [statMetricName(field), field]));

/** A `StatLine` of all zeros, which every observation then overwrites. */
function emptyLine(playerId: string, week: number): StatLine {
  return {
    playerId,
    week,
    ...(Object.fromEntries(STAT_FIELDS.map((field) => [field, 0])) as Omit<StatLine, "playerId" | "week">),
  };
}

/**
 * Every player's outcome for a week (or a span of them), as it was known at `asOf`.
 *
 * A stat nobody observed reads as zero, NOT as absent — unlike the feature layer's careful
 * distinction, and for a good reason: the weekly file writes all fourteen fields for every player
 * it carries, so a missing metric on a player who HAS a line means the feed positively recorded
 * nothing there. A player with no line at all simply does not appear, which is the "absent" case,
 * and it stays distinguishable.
 *
 * `source` defaults to `STAT_LINE_SOURCE` — every caller except one leaves it there and gets
 * exactly the published nflverse line, unchanged. The one exception is
 * `nflverse/derived-stat-lines.ts`'s `statLinesAsOfForMeasurement`, which passes
 * `DERIVED_STAT_LINE_SOURCE` to read the pbp-derived fallback for a gap season — the only reason
 * this parameter exists at all, so a product surface reaching for a different source has to go out
 * of its way to do it rather than stumbling into it.
 */
export async function statLinesAsOf(
  db: ReadonlyDb,
  query: Omit<ObservationQuery, "source">,
  source: string = STAT_LINE_SOURCE,
): Promise<readonly SeasonStatLine[]> {
  const observations = await observationsAsOf(db, { ...query, source });

  // Insertion order is the store's own `(week, playerId, …)` ordering, which a Map preserves — so
  // the result is deterministic and a `ScoreCard` computed from it is reproducible.
  const lines = new Map<string, { season: number; line: StatLine; asOf: Date }>();
  for (const observation of observations) {
    const field = FIELD_BY_METRIC.get(observation.metric);
    // Participation metrics share this source (`targets`, `routes_run`) and are not stat fields.
    // They belong to the feature layer, and an outcome is not a feature.
    if (field === undefined) continue;
    const key = `${observation.week}|${observation.playerId}`;
    const existing = lines.get(key);
    if (existing === undefined) {
      lines.set(key, {
        season: observation.season,
        asOf: observation.asOf,
        line: { ...emptyLine(observation.playerId, observation.week), [field]: observation.value },
      });
      continue;
    }
    lines.set(key, {
      season: existing.season,
      asOf: observation.asOf > existing.asOf ? observation.asOf : existing.asOf,
      line: { ...existing.line, [field]: observation.value },
    });
  }
  return [...lines.values()];
}
