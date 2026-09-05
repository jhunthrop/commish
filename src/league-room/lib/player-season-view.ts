import type { SeasonWeek, SourceValue } from "@/components/ui";
import type { Position } from "@/domain/player";
import type { PlayerSeasonBody } from "@/league-service/player";

/**
 * A position in the words a manager would use, PLURAL — the shape a population takes in a
 * sentence ("Top 8% of running backs this season"). Extracted from the player page when the
 * bottom-sheet peek became this view's second consumer (founder, 2026-08-30: the name opens a
 * drawer wherever it appears).
 */
export const POSITION_PLURAL: Readonly<Record<Position, string>> = {
  QB: "quarterbacks",
  RB: "running backs",
  WR: "receivers",
  TE: "tight ends",
  K: "kickers",
  DEF: "defenses",
};

/** The source strip's five cells; precision rulings live with each cell. See the player page's
 *  original docblock for the full account of which sources reach this season. */
export function sourcesFor(body: PlayerSeasonBody): readonly SourceValue[] {
  const { player, positionRank, expertRank, modelRank, pointsPerGame, pointsPerGamePercentile } = body;
  return [
    { label: player.position, value: positionRank === null ? null : String(positionRank) },
    // "ADP" (Task 5, 2026-09-04 — was "Market"): this cell sits among three RANKS
    // (position, experts, model) and a plain draft-position number labelled "Market" read as a
    // fourth rank rather than the average draft position it actually is.
    { label: "ADP", value: player.adp === null ? null : player.adp.toFixed(1) },
    { label: "Experts", value: expertRank === null ? null : String(expertRank) },
    { label: "Model", value: modelRank === null ? null : String(modelRank) },
    {
      label: "PPG",
      value: pointsPerGame === null ? null : pointsPerGame.toFixed(1),
      comparison:
        pointsPerGamePercentile === null
          ? undefined
          : { percentile: pointsPerGamePercentile, population: `${POSITION_PLURAL[player.position]} this season` },
    },
  ];
}

/** Each played week, judged against every week played at his position this season. */
export function weeksFor(body: PlayerSeasonBody): readonly SeasonWeek[] {
  const population = `${POSITION_PLURAL[body.player.position]} in a week this season`;
  return body.weeks.map((week) => ({
    week: week.week,
    points: week.points,
    comparison: week.percentile === null ? undefined : { percentile: week.percentile, population },
  }));
}
