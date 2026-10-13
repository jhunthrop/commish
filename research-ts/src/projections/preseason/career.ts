import type { Position, StatLine } from "@research-ts/domain/player";
import { STAT_FIELDS } from "@research-ts/domain/player";

/**
 * CAREER STAGE — the axis on which this board is wrong in the same direction on four seasons.
 *
 * THE MEASUREMENT THAT PRODUCED IT, from `docs/research/2026-08-28-starter-band.md`. Projected
 * points per game against what a man actually scored per game, by seasons in the league, on 2021,
 * 2022, 2023 and 2024:
 *
 *   | season in the league | 2021  | 2022  | 2023  | 2024  |
 *   |---|---|---|---|---|
 *   | 1 (rookie)           | 0.86  | 0.85  | 0.73  | 0.87  |
 *   | 2                    | 0.92  | 1.03  | 0.91  | 0.97  |
 *   | 3                    | 1.10  | 1.10  | 1.23  | 1.10  |
 *   | 4 to 6               | 1.05  | 1.14  | 1.23  | 1.13  |
 *   | 7 and up             | 1.16  | 1.16  | 1.25  | 1.13  |
 *
 * Monotone increasing on every one of the four, with no exceptions and no crossings: the board
 * under-projects young players and over-projects old ones, by about thirty per cent end to end. The
 * market's own residual says the same thing from the other side — a rank comparison against average
 * draft position puts us between nine and thirty ranks too LOW on players of 24 and under and
 * between two and twenty ranks too HIGH on players of 29 and over, on all four seasons.
 *
 * WHY THE LAYERS BELOW CANNOT SEE IT, which is the test model v3 set for a feature and the one
 * red-zone share and target depth failed. Every rate and every share this engine emits is a
 * shrinkage of a player's OWN past toward a population mean. That is the right estimator for a
 * stationary quantity and football is not stationary in a career: a second-year receiver's rookie
 * tape understates the player he now is, and a thirty-two-year-old back's three good seasons
 * overstate the player he now is. The shrinkage is symmetric and the truth is not, so the error is
 * signed, and it is signed the same way for everybody at the same stage. No amount of a player's own
 * history can correct it, because his own history is the thing that is stale.
 *
 * ONE MULTIPLIER, NORMALISED WITHIN THE POSITION, exactly as the depth chart is and for the same
 * reason. A league-wide multiplier on every rookie would move all of them together and could not
 * improve a ranking; what earns its place is the REORDERING of a rookie against the fourth-year
 * player two rows above him. So each cell is divided by its position's own overall correction, and
 * the position's total projected points is preserved to the last decimal.
 *
 * WHAT IT IS NOT. It is not an age curve — age and experience are correlated and different, and the
 * quantity that moves here is time in the league rather than time alive. It is not a claim about
 * ageing at all: a large part of the veteran cell is survivorship in the OTHER direction, in that a
 * man with seven seasons of usage history has a long record precisely because he was good, and the
 * shrinkage trusts that record at the moment it stops being true.
 *
 * WHAT IT MEASURED, on the two held-out seasons, fitted on 2021-22 only. Three of four measures are
 * positive on both, and the fourth is a no-op on one of them:
 *
 *   |                        | 2023            | 2024            |
 *   |---|---|---|
 *   | starter band           | 0.2339 → 0.2485 | 0.2290 → 0.2685 |
 *   | market (ADP) pop.      | 0.4697 → 0.4759 | 0.3992 → 0.4186 |
 *   | consensus (ECR) pop.   | 0.6489 → 0.6659 | 0.7594 → 0.7598 |
 *   | whole board, pooled    | 0.7146 → 0.7263 | 0.7724 → 0.7723 |
 *
 * THE POOLED 2024 FIGURE IS −0.0001, and it belongs in this docblock rather than only in the write-
 * up, because this is what an engineer reads before trusting the multiplier. It ships on the gate
 * model v3 set for the news pass — which shipped OFF for costing the pooled figure on both seasons
 * — since this is a band-level gain on the players a manager actually drafts that costs the pooled
 * figure nothing. A later change that moves the pooled number down is not free to cite this one as
 * precedent: the argument here is "no cost", not "an acceptable cost".
 */

/**
 * The bands the correction is estimated in.
 *
 * Bands rather than a fitted slope, for `availability.ts`' reason: the shape is not a line. The step
 * from a first season to a second is the largest in the table and the steps after the third are
 * almost flat, and a straight line through that fits neither end. Five cells over four positions is
 * twenty, each estimated from enough player-seasons on the fit years to be a measurement.
 */
export const EXPERIENCE_BANDS = ["year1", "year2", "year3", "year4to6", "year7plus"] as const;
export type ExperienceBand = (typeof EXPERIENCE_BANDS)[number];

/**
 * Which band a player is in, from the season and the year he entered the league.
 *
 * `null` where the roster release carries no entry year, and that is a refusal rather than a
 * default: guessing a man into a band would apply a correction fitted on players we know the stage
 * of to a player we do not, and `careerMultiplier` returns exactly one for him.
 */
export function experienceBandFor(season: number, entryYear: number | null): ExperienceBand | null {
  if (entryYear === null || !Number.isInteger(entryYear)) return null;
  const seasons = season - entryYear + 1;
  if (seasons < 1) return null;
  if (seasons === 1) return "year1";
  if (seasons === 2) return "year2";
  if (seasons === 3) return "year3";
  if (seasons <= 6) return "year4to6";
  return "year7plus";
}

export interface CareerPriors {
  /**
   * How much a player's projected production must be scaled at each stage, per position.
   *
   * NORMALISED so the position's own overall correction is one — see the module docblock. A cell of
   * exactly one is a cell the fit found nothing in, which is a claim and not a placeholder.
   */
  readonly byExperience: Readonly<Record<Position, Readonly<Record<ExperienceBand, number>>>>;
  /**
   * The most the curve may move a projection, either way, as a multiplier.
   *
   * Tighter than the depth chart's, and deliberately. A depth chart is a club stating who starts;
   * this is a population average asserted over an individual, which is a much weaker claim about any
   * one man. The bound is what stops a thin cell turning a rookie into a starter, and
   * `preseason-fit.ts` prints every cell so a reader can see whether it binds.
   */
  readonly bound: number;
}

/** The bounded correction for one cell. Exported so a test and the fit report read the same number. */
export function careerMultiplier(position: Position, band: ExperienceBand | null, priors: CareerPriors): number {
  if (band === null) return 1;
  const raw = priors.byExperience[position]?.[band];
  if (raw === undefined || !(raw > 0) || !Number.isFinite(raw)) return 1;
  return Math.min(1 + priors.bound, Math.max(1 / (1 + priors.bound), raw));
}

/**
 * A per-game line scaled by its player's career stage.
 *
 * APPLIED TO THE COMPOSED LINE RATHER THAN TO OPPORTUNITY, which is the opposite of where the depth
 * chart and the news pass apply, and the difference is the claim being made. Those two say a man is
 * on the field more or less than the model thought, so they belong on share; this one says a
 * second-year receiver is a better player than his rookie season, which is a statement about
 * opportunity AND efficiency together and cannot honestly be assigned to either. Scaling the line it
 * was measured on is the only placement that does not assert a mechanism the measurement does not
 * support.
 *
 * It runs AFTER availability has read the snap share, so the curve never changes how many games a
 * man is expected to play. That is the point: the measurement is about production per game, the
 * availability model is fitted on games, and letting one move the other would double-count a career
 * stage that both tables already read.
 */
export function applyCareerStage(line: StatLine, position: Position, band: ExperienceBand | null, priors: CareerPriors): StatLine {
  const multiplier = careerMultiplier(position, band, priors);
  if (multiplier === 1) return line;
  return {
    ...line,
    ...(Object.fromEntries(STAT_FIELDS.map((field) => [field, line[field] * multiplier])) as Omit<StatLine, "playerId" | "week">),
  };
}

/**
 * A curve that does nothing, for the fit to build its `before` arm with.
 *
 * The career table is fitted against the board's own projection with this feature OFF, so the fit
 * needs a priors object before there is a fitted one. Every cell is exactly one, which is the null
 * hypothesis the fit then has to beat cell by cell.
 */
export const NEUTRAL_CAREER_PRIORS: CareerPriors = {
  byExperience: Object.fromEntries(
    (["QB", "RB", "WR", "TE", "K", "DEF"] as const).map((position) => [
      position,
      Object.fromEntries(EXPERIENCE_BANDS.map((band) => [band, 1])),
    ]),
  ) as CareerPriors["byExperience"],
  bound: 0.35,
};
