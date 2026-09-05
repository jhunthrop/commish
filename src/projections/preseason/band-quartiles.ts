/**
 * THE EVERYDAY BAND (founder, 2026-09-04: "why are our ranges so big?"). The stored season band
 * is an honest p10-p90, and honesty made it wide: the tails are stocked with ordinary injury
 * seasons and ordinary smash seasons, and the backtest says even this width UNDER-covers real
 * outcomes (61-66% landed inside a band that claims 80%). The width stays. What changes is the
 * telling: the board shows the p25-p75 "most seasons" band as the readable number, with the full
 * p10-p90 behind it as the tail whisker.
 *
 * DERIVED, NOT REFIT: `game-variance.ts`'s band composes a normal tail around the median, so the
 * quartiles are exact functions of the SAME stored distribution — `sigma = (p90 - p10) / (2 x
 * z90)` and `p25/p75 = median -/+ z75 x sigma`, with z90 = 1.2816 and z75 = 0.6745 the standard
 * normal quantiles. No new fit, no new storage, no number this module invents: a different
 * quantile of the distribution the calibration round measured and backtested.
 *
 * Guards: a degenerate band (floor = ceiling, a distribution the store pinned to a point)
 * returns the median for both quartiles; inputs that violate floor <= median <= ceiling throw,
 * because a band that disagrees with its own median is corrupt data, not a display question.
 *
 * COPIED FROM `origin/main` (2026-09-04, read via `git show`, never merged into this branch —
 * this implementation task's own hard rule is "never merge, never push"). Verbatim, so a later
 * merge of this branch reconciles as a no-op on this file rather than a conflict.
 */

const Z_90 = 1.2816;
const Z_75 = 0.6745;

export interface SeasonQuartiles {
  readonly p25: number;
  readonly p75: number;
}

export function quartilesFromSeasonBand(median: number, floorP10: number, ceilingP90: number): SeasonQuartiles {
  if (!(floorP10 <= median && median <= ceilingP90)) {
    throw new Error(`A season band must bracket its median; got p10 ${floorP10}, median ${median}, p90 ${ceilingP90}.`);
  }
  if (ceilingP90 === floorP10) return { p25: median, p75: median };
  const sigma = (ceilingP90 - floorP10) / (2 * Z_90);
  return { p25: median - Z_75 * sigma, p75: median + Z_75 * sigma };
}
